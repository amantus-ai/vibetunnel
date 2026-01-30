import Foundation
import Network
import SwiftUI

private let logger = Logger(category: "BonjourDiscovery")

/// Protocol for Bonjour service discovery
@MainActor
protocol BonjourDiscoveryProtocol {
    var discoveredServers: [DiscoveredServer] { get }
    var isDiscovering: Bool { get }
    func startDiscovery()
    func stopDiscovery()
}

/// Represents a discovered VibeTunnel server.
/// Contains server information including name, host, port, and metadata.
struct DiscoveredServer: Identifiable, Equatable {
    let id: UUID
    let name: String
    let host: String
    let port: Int
    let type: String
    let domain: String
    let metadata: [String: String]

    var displayName: String {
        // Remove .local suffix if present
        self.name.hasSuffix(".local") ? String(self.name.dropLast(6)) : self.name
    }

    /// Creates a new DiscoveredServer with a generated UUID
    init(
        name: String,
        host: String,
        port: Int,
        type: String = "_vibetunnel._tcp",
        domain: String = "local",
        metadata: [String: String]
    ) {
        self.id = UUID()
        self.name = name
        self.host = host
        self.port = port
        self.type = type
        self.domain = domain
        self.metadata = metadata
    }

    /// Creates a copy of a DiscoveredServer with updated values but same UUID
    init(from server: Self, host: String? = nil, port: Int? = nil) {
        self.id = server.id
        self.name = server.name
        self.host = host ?? server.host
        self.port = port ?? server.port
        self.type = server.type
        self.domain = server.domain
        self.metadata = server.metadata
    }
}

/// Service for discovering VibeTunnel servers on the local network using Bonjour/mDNS
@MainActor
@Observable
final class BonjourDiscoveryService: BonjourDiscoveryProtocol {
    static let shared = BonjourDiscoveryService()

    private(set) var discoveredServers: [DiscoveredServer] = []
    private(set) var isDiscovering = false

    private var browser: NWBrowser?
    private let queue = DispatchQueue(label: "BonjourDiscovery")
    private var activeConnections: [UUID: NWConnection] = [:]

    private init() {}

    func startDiscovery() {
        guard !self.isDiscovering else {
            logger.debug("Already discovering servers")
            return
        }

        logger.info("Starting Bonjour discovery for _vibetunnel._tcp services")

        // Clear existing servers
        self.discoveredServers.removeAll()

        // Create browser for VibeTunnel services
        let parameters = NWParameters()
        parameters.includePeerToPeer = true

        self.browser = NWBrowser(for: .bonjour(type: "_vibetunnel._tcp", domain: nil), using: parameters)

        self.browser?.browseResultsChangedHandler = { [weak self] results, _ in
            Task { @MainActor [weak self] in
                self?.handleBrowseResults(results)
            }
        }

        self.browser?.stateUpdateHandler = { [weak self] state in
            Task { @MainActor [weak self] in
                guard let self else { return }

                switch state {
                case .ready:
                    logger.debug("Browser is ready")
                    self.isDiscovering = true
                case let .failed(error):
                    logger.error("Browser failed with error: \(error)")
                    self.isDiscovering = false
                case .cancelled:
                    logger.debug("Browser cancelled")
                    self.isDiscovering = false
                default:
                    break
                }
            }
        }

        self.browser?.start(queue: self.queue)
    }

    func stopDiscovery() {
        guard self.isDiscovering else { return }

        logger.info("Stopping Bonjour discovery")
        self.browser?.cancel()
        self.browser = nil
        self.isDiscovering = false

        // Cancel all active connections
        for (_, connection) in self.activeConnections {
            connection.cancel()
        }
        self.activeConnections.removeAll()
    }

    private func handleBrowseResults(_ results: Set<NWBrowser.Result>) {
        logger.debug("Found \(results.count) Bonjour services")

        // Create a map of existing servers by name for efficient lookup
        var existingServersByName: [String: DiscoveredServer] = [:]
        for server in self.discoveredServers {
            existingServersByName[server.name] = server
        }

        // Track which servers are still present
        var currentServerNames = Set<String>()
        var newServers: [DiscoveredServer] = []

        // Process results
        for result in results {
            switch result.endpoint {
            case let .service(name, type, domain, _):
                logger.debug("Found service: \(name) of type \(type) in domain \(domain)")
                currentServerNames.insert(name)

                // Extract metadata if available
                var metadata: [String: String] = [:]
                if case .bonjour = result.metadata {
                    // Note: Full metadata extraction requires resolving the service
                    metadata["type"] = type
                    metadata["domain"] = domain
                }

                // Check if we already have this server
                if let existingServer = existingServersByName[name] {
                    // Keep the existing server with its UUID and resolved data
                    newServers.append(existingServer)
                } else {
                    // Create new server instance
                    let newServer = DiscoveredServer(
                        name: name,
                        host: "", // Will be resolved
                        port: 0, // Will be resolved
                        type: type,
                        domain: domain,
                        metadata: metadata)
                    newServers.append(newServer)

                    // Start resolving the new server
                    self.resolveService(newServer)
                }
            default:
                break
            }
        }

        // Cancel connections for servers that are no longer present
        for server in self.discoveredServers where !currentServerNames.contains(server.name) {
            if let connection = activeConnections[server.id] {
                connection.cancel()
                activeConnections.removeValue(forKey: server.id)
            }
        }

        // Update discovered servers with the new list
        self.discoveredServers = newServers
    }

    private func resolveService(_ server: DiscoveredServer) {
        // Capture the server ID to avoid race conditions
        let serverId = server.id
        let serverName = server.name

        // Don't resolve if already resolved
        if !server.host.isEmpty, server.port > 0 {
            logger.debug("Server \(serverName) already resolved")
            return
        }

        // Check if we already have an active connection for this server
        if self.activeConnections[serverId] != nil {
            logger.debug("Already resolving server \(serverName)")
            return
        }

        // Create a connection to resolve the service
        let parameters = NWParameters.tcp
        let domain = server.domain.isEmpty ? "local" : server.domain
        let endpoint = NWEndpoint.service(
            name: serverName,
            type: server.type,
            domain: domain,
            interface: nil)

        let connection = NWConnection(to: endpoint, using: parameters)

        // Store the connection to track it
        self.activeConnections[serverId] = connection

        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                // Extract resolved endpoint information
                if case let .hostPort(host, port) = connection.currentPath?.remoteEndpoint {
                    Task { @MainActor [weak self] in
                        guard let self else { return }

                        let hostString: String = switch host {
                        case let .ipv4(address):
                            "\(address)"
                        case let .ipv6(address):
                            "\(address)"
                        case let .name(name, _):
                            name
                        @unknown default:
                            ""
                        }

                        // Remove network interface suffix (e.g., %en0) from IP addresses
                        let cleanHost = hostString.components(separatedBy: "%").first ?? hostString

                        // Find and update the server by ID to avoid race conditions
                        if let index = self.discoveredServers.firstIndex(where: { $0.id == serverId }) {
                            let originalServer = self.discoveredServers[index]
                            // Use the copy initializer to preserve the UUID
                            let updatedServer = DiscoveredServer(
                                from: originalServer,
                                host: cleanHost,
                                port: Int(port.rawValue))
                            self.discoveredServers[index] = updatedServer

                            logger.info("Resolved \(serverName) to \(cleanHost):\(port.rawValue)")
                        } else {
                            logger.debug("Server \(serverName) no longer in discovered list")
                        }

                        // Remove the connection from active connections
                        self.activeConnections.removeValue(forKey: serverId)
                    }
                }
                connection.cancel()

            case let .failed(error):
                logger.error("Failed to resolve service \(serverName): \(error)")
                Task { @MainActor [weak self] in
                    self?.activeConnections.removeValue(forKey: serverId)
                }
                connection.cancel()

            case .cancelled:
                Task { @MainActor [weak self] in
                    self?.activeConnections.removeValue(forKey: serverId)
                }

            default:
                break
            }
        }

        connection.start(queue: self.queue)
    }
}

// MARK: - Discovery Sheet View

/// Sheet view for discovering VibeTunnel servers on the local network.
/// Displays found servers and allows selection for connection.
struct ServerDiscoverySheet: View {
    @Binding var selectedHost: String
    @Binding var selectedPort: String
    @Binding var selectedName: String?

    @Environment(\.dismiss)
    private var dismiss
    @State private var discoveryService = BonjourDiscoveryService.shared

    var body: some View {
        NavigationStack {
            VStack {
                if self.discoveryService.isDiscovering, self.discoveryService.discoveredServers.isEmpty {
                    VStack(spacing: 20) {
                        ProgressView()
                            .scaleEffect(1.5)
                        Text("Searching for VibeTunnel servers...")
                            .foregroundColor(Theme.Colors.terminalGray)
                    }
                    .frame(maxHeight: .infinity)
                } else if self.discoveryService.discoveredServers.isEmpty {
                    VStack(spacing: 20) {
                        Image(systemName: "wifi.slash")
                            .font(.system(size: 60))
                            .foregroundColor(Theme.Colors.terminalGray)
                        Text("No servers found")
                            .font(.title2)
                        Text("Make sure VibeTunnel is running on your Mac\nand both devices are on the same network")
                            .multilineTextAlignment(.center)
                            .foregroundColor(Theme.Colors.terminalGray)
                    }
                    .frame(maxHeight: .infinity)
                } else {
                    List(self.discoveryService.discoveredServers) { server in
                        Button {
                            self.selectedHost = server.host
                            self.selectedPort = String(server.port)
                            self.selectedName = server.displayName
                            self.dismiss()
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(server.displayName)
                                        .font(.headline)
                                        .foregroundColor(Theme.Colors.secondaryAccent)
                                    if !server.host.isEmpty {
                                        Text("\(server.host):\(server.port)")
                                            .font(.caption)
                                            .foregroundColor(Theme.Colors.terminalGray)
                                    } else {
                                        Text("Resolving...")
                                            .font(.caption)
                                            .foregroundColor(Theme.Colors.terminalGray)
                                    }
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .foregroundColor(Theme.Colors.terminalGray)
                            }
                            .padding(.vertical, 4)
                        }
                        .disabled(server.host.isEmpty)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Discover Servers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        self.dismiss()
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        if self.discoveryService.isDiscovering {
                            self.discoveryService.stopDiscovery()
                        } else {
                            self.discoveryService.startDiscovery()
                        }
                    } label: {
                        Image(systemName: self.discoveryService.isDiscovering ? "stop.circle" : "arrow.clockwise")
                    }
                }
            }
        }
        .onAppear {
            self.discoveryService.startDiscovery()
        }
        .onDisappear {
            self.discoveryService.stopDiscovery()
        }
    }
}
