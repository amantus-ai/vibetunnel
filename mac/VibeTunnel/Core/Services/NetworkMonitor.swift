import Foundation
import Network
import OSLog

/// Monitors network connectivity and provides notifications about network status changes.
///
/// This service wraps Apple's Network framework to provide a simplified interface
/// for monitoring network reachability and connectivity status.
@MainActor
@Observable
final class NetworkMonitor {
    // MARK: - Properties

    /// Shared instance for network monitoring
    static let shared = NetworkMonitor()

    /// Current network connection status
    private(set) var isConnected = true

    /// Whether the current connection is expensive (e.g., cellular)
    private(set) var isExpensive = false

    /// Whether the current connection is constrained (e.g., Low Data Mode)
    private(set) var isConstrained = false

    /// The type of interface used for the current connection
    private(set) var connectionType: NWInterface.InterfaceType?

    // MARK: - Private Properties

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "sh.vibetunnel.NetworkMonitor")
    private let logger = Logger(subsystem: BundleIdentifiers.main, category: "NetworkMonitor")

    // MARK: - Initialization

    private init() {
        setupMonitor()
    }

    // MARK: - Public Methods

    /// Starts monitoring network connectivity
    func startMonitoring() {
        monitor.start(queue: queue)
        logger.info("Network monitoring started")
    }

    /// Stops monitoring network connectivity
    func stopMonitoring() {
        monitor.cancel()
        logger.info("Network monitoring stopped")
    }

    // MARK: - Private Methods

    private func setupMonitor() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.updateNetworkStatus(path)
            }
        }
    }

    @MainActor
    private func updateNetworkStatus(_ path: NWPath) {
        let wasConnected = isConnected

        isConnected = path.status == .satisfied
        isExpensive = path.isExpensive
        isConstrained = path.isConstrained

        // Determine connection type
        if path.usesInterfaceType(.wifi) {
            connectionType = .wifi
        } else if path.usesInterfaceType(.cellular) {
            connectionType = .cellular
        } else if path.usesInterfaceType(.wiredEthernet) {
            connectionType = .wiredEthernet
        } else {
            connectionType = nil
        }

        // Log status changes
        if wasConnected != isConnected {
            if isConnected {
                logger.info("Network connected via \(self.connectionTypeString)")
            } else {
                logger.warning("Network disconnected")
            }
        }

        // Post notification for interested observers
        NotificationCenter.default.post(
            name: .networkStatusChanged,
            object: self,
            userInfo: ["isConnected": isConnected]
        )
    }

    /// Human-readable description of the connection type
    var connectionTypeString: String {
        switch connectionType {
        case .wifi:
            return "Wi-Fi"
        case .cellular:
            return "Cellular"
        case .wiredEthernet:
            return "Ethernet"
        case .loopback:
            return "Loopback"
        case .other:
            return "Other"
        case nil:
            return "Unknown"
        @unknown default:
            return "Unknown"
        }
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let networkStatusChanged = Notification.Name("sh.vibetunnel.networkStatusChanged")
}
