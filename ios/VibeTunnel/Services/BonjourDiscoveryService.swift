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

/// Represents a discovered VibeTunnel server
struct DiscoveredServer: Identifiable, Equatable {
    let id = UUID()
    let name: String
    let host: String
    let port: Int
    let metadata: [String: String]
    
    var displayName: String {
        // Remove .local suffix if present
        name.hasSuffix(".local") ? String(name.dropLast(6)) : name
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
    }
    
    private func handleBrowseResults(_ results: Set<NWBrowser.Result>) {
        logger.debug("Found \(results.count) Bonjour services")
        
        // Convert results to discovered servers
        let servers = results.compactMap { result -> DiscoveredServer? in
            switch result.endpoint {
            case .service(let name, let type, let domain, _):
                logger.debug("Found service: \(name) of type \(type) in domain \(domain)")
                
                // Extract metadata if available
                var metadata: [String: String] = [:]
                if case .bonjour = result.metadata {
                    // Note: Full metadata extraction requires resolving the service
                    metadata["type"] = type
                    metadata["domain"] = domain
                }
                
                // We need to resolve the service to get host and port
                // For now, we'll store what we have
                return DiscoveredServer(
                    name: name,
                    host: "", // Will be resolved
                    port: 0,  // Will be resolved
                    metadata: metadata
                )
            default:
                return nil
            }
        }
        
        // Update discovered servers
        discoveredServers = servers
        
        // Resolve each server to get host and port
        for server in servers {
            resolveService(server)
        }
    }
    
    private func resolveService(_ server: DiscoveredServer) {
        // Capture the server ID to avoid race conditions
        let serverId = server.id
        let serverName = server.name
        
        // Create a connection to resolve the service
        let parameters = NWParameters.tcp
        let endpoint = NWEndpoint.service(
            name: serverName,
            type: "_vibetunnel._tcp",
            domain: "local",
            interface: nil
        )
        
        let connection = NWConnection(to: endpoint, using: parameters)
        
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                // Extract resolved endpoint information
                if case .hostPort(let host, let port) = connection.currentPath?.remoteEndpoint {
                    Task { @MainActor [weak self] in
                        guard let self else { return }
                        
                        let hostString: String
                        switch host {
                        case .ipv4(let address):
                            hostString = "\(address)"
                        case .ipv6(let address):
                            hostString = "\(address)"
                        case .name(let name, _):
                            hostString = name
                        @unknown default:
                            hostString = ""
                        }
                        
                        // Remove network interface suffix (e.g., %en0) from IP addresses
                        let cleanHost = hostString.components(separatedBy: "%").first ?? hostString
                        
                        // Find and update the server by ID to avoid race conditions
                        if let index = self.discoveredServers.firstIndex(where: { $0.id == serverId }) {
                            let originalServer = self.discoveredServers[index]
                            let updatedServer = DiscoveredServer(
                                name: originalServer.name,
                                host: cleanHost,
                                port: Int(port.rawValue),
                                metadata: originalServer.metadata
                            )
                            self.discoveredServers[index] = updatedServer
                            
                            logger.info("Resolved \(serverName) to \(cleanHost):\(port.rawValue)")
                        } else {
                            logger.debug("Server \(serverName) no longer in discovered list")
                        }
                    }
                }
                connection.cancel()
                
            case .failed(let error):
                logger.error("Failed to resolve service \(serverName): \(error)")
                connection.cancel()
                
            default:
                break
            }
        }
        
        connection.start(queue: queue)
    }
}

// MARK: - Discovery Sheet View

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