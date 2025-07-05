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
    let metadata: [String: String]

    var displayName: String {
        // Remove .local suffix if present
        name.hasSuffix(".local") ? String(name.dropLast(6)) : name
    }
    
    /// Creates a new DiscoveredServer with a generated UUID
    init(name: String, host: String, port: Int, metadata: [String: String]) {
        self.id = UUID()
        self.name = name
        self.host = host
        self.port = port
        self.metadata = metadata
    }
    
    /// Creates a copy of a DiscoveredServer with updated values but same UUID
    init(from server: DiscoveredServer, host: String? = nil, port: Int? = nil) {
        self.id = server.id
        self.name = server.name
        self.host = host ?? server.host
        self.port = port ?? server.port
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
        guard !isDiscovering else {
            logger.debug("Already discovering servers")
            return
        }

        logger.info("Starting Bonjour discovery for _vibetunnel._tcp services")

        // Clear existing servers
        discoveredServers.removeAll()

        // Create browser for VibeTunnel services
        let parameters = NWParameters()
        parameters.includePeerToPeer = true

        browser = NWBrowser(for: .bonjour(type: "_vibetunnel._tcp", domain: nil), using: parameters)

        browser?.browseResultsChangedHandler = { [weak self] results, _ in
            Task { @MainActor [weak self] in
                self?.handleBrowseResults(results)
            }
        }

        browser?.stateUpdateHandler = { [weak self] state in
            Task { @MainActor [weak self] in
                guard let self else { return }

                switch state {
                case .ready:
                    logger.debug("Browser is ready")
                    self.isDiscovering = true
                case .failed(let error):
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

        browser?.start(queue: queue)
    }

    func stopDiscovery() {
        guard isDiscovering else { return }

        logger.info("Stopping Bonjour discovery")
        browser?.cancel()
        browser = nil
        isDiscovering = false
        
        // Cancel all active connections
        for (_, connection) in activeConnections {
            connection.cancel()
        }
        activeConnections.removeAll()
    }

    private func handleBrowseResults(_ results: Set<NWBrowser.Result>) {
        logger.debug("Found \(results.count) Bonjour services")

        // Create a map of existing servers by name for efficient lookup
        var existingServersByName: [String: DiscoveredServer] = [:]
        for server in discoveredServers {
            existingServersByName[server.name] = server
        }
        
        // Track which servers are still present
        var currentServerNames = Set<String>()
        var newServers: [DiscoveredServer] = []

        // Process results
        for result in results {
            switch result.endpoint {
            case .service(let name, let type, let domain, _):
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
                        metadata: metadata
                    )
                    newServers.append(newServer)
                    
                    // Start resolving the new server
                    resolveService(newServer)
                }
            default:
                break
            }
        }
        
        // Cancel connections for servers that are no longer present
        for server in discoveredServers where !currentServerNames.contains(server.name) {
            if let connection = activeConnections[server.id] {
                connection.cancel()
                activeConnections.removeValue(forKey: server.id)
            }
        }

        // Update discovered servers with the new list
        discoveredServers = newServers
    }

    private func resolveService(_ server: DiscoveredServer) {
        // Capture the server ID to avoid race conditions
        let serverId = server.id
        let serverName = server.name
        
        // Don't resolve if already resolved
        if !server.host.isEmpty && server.port > 0 {
            logger.debug("Server \(serverName) already resolved")
            return
        }
        
        // Check if we already have an active connection for this server
        if activeConnections[serverId] != nil {
            logger.debug("Already resolving server \(serverName)")
            return
        }

        // Create a connection to resolve the service
        let parameters = NWParameters.tcp
        let endpoint = NWEndpoint.service(
            name: serverName,
            type: "_vibetunnel._tcp",
            domain: "local",
            interface: nil
        )

        let connection = NWConnection(to: endpoint, using: parameters)
        
        // Store the connection to track it
        activeConnections[serverId] = connection

        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                // Extract resolved endpoint information
                if case .hostPort(let host, let port) = connection.currentPath?.remoteEndpoint {
                    Task { @MainActor [weak self] in
                        guard let self else { return }

                        let hostString: String = switch host {
                        case .ipv4(let address):
                            "\(address)"
                        case .ipv6(let address):
                            "\(address)"
                        case .name(let name, _):
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
                                port: Int(port.rawValue)
                            )
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

            case .failed(let error):
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

        connection.start(queue: queue)
    }
}

// MARK: - Discovery Sheet View

/// Sheet view for discovering VibeTunnel servers on the local network.
/// Displays found servers and allows selection for connection.
struct ServerDiscoverySheet: View {
    @Binding var selectedHost: String
    @Binding var selectedPort: String
    @Binding var selectedName: String?
    
    @Environment(\.dismiss) private var dismiss
    @State private var discoveryService = BonjourDiscoveryService.shared

    var body: some View {
        NavigationStack {
            VStack {
                if discoveryService.isDiscovering && discoveryService.discoveredServers.isEmpty {
                    VStack(spacing: 20) {
                        ProgressView()
                            .scaleEffect(1.5)
                        Text("Searching for VibeTunnel servers...")
                            .foregroundColor(Theme.Colors.terminalGray)
                    }
                    .frame(maxHeight: .infinity)
                } else if discoveryService.discoveredServers.isEmpty {
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
                    List(discoveryService.discoveredServers) { server in
                        Button {
                            selectedHost = server.host
                            selectedPort = String(server.port)
                            selectedName = server.displayName
                            dismiss()
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
                        dismiss()
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        if discoveryService.isDiscovering {
                            discoveryService.stopDiscovery()
                        } else {
                            discoveryService.startDiscovery()
                        }
                    } label: {
                        Image(systemName: discoveryService.isDiscovering ? "stop.circle" : "arrow.clockwise")
                    }
                }
            }
        }
        .onAppear {
            discoveryService.startDiscovery()
        }
        .onDisappear {
            discoveryService.stopDiscovery()
        }
    }
}
