import Foundation
import Network
import SwiftUI

private let logger = Logger(category: "NetworkMonitor")

/// Protocol for network monitoring to enable dependency injection in tests
@MainActor
protocol NetworkMonitoring {
    var isConnected: Bool { get }
}

/// Monitors network connectivity and provides offline/online state
@MainActor
@Observable
final class NetworkMonitor: NetworkMonitoring {
    static let shared = NetworkMonitor()

    private(set) var isConnected = true
    private(set) var connectionType = NWInterface.InterfaceType.other
    private(set) var isExpensive = false
    private(set) var isConstrained = false

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "NetworkMonitor")

    private init() {
        startMonitoring()
    }

    deinit {
        monitor.cancel()
    }

    private func startMonitoring() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor [weak self] in
                guard let self else { return }

                let wasConnected = self.isConnected
                self.isConnected = path.status == .satisfied
                self.isExpensive = path.isExpensive
                self.isConstrained = path.isConstrained

                // Update connection type
                if let interface = path.availableInterfaces.first {
                    self.connectionType = interface.type
                }

                // Log state changes
                if wasConnected != self.isConnected {
                    logger.info("Connection state changed: \(self.isConnected ? "Online" : "Offline")")

                    // Post notification for other parts of the app
                    NotificationCenter.default.post(
                        name: self.isConnected ? .networkBecameAvailable : .networkBecameUnavailable,
                        object: nil
                    )
                }
            }
        }

        monitor.start(queue: queue)
    }

    private func stopMonitoring() {
        monitor.cancel()
    }

    /// Check if a specific host is reachable
    func checkHostReachability(_ host: String) async -> Bool {
        // Try to resolve the host
        guard let url = URL(string: host),
              url.host != nil
        else {
            return false
        }

        actor ResponseTracker {
            private var hasResponded = false

            func checkAndRespond() -> Bool {
                if hasResponded {
                    return false
                }
                hasResponded = true
                return true
            }
        }

        return await withCheckedContinuation { continuation in
            let monitor = NWPathMonitor()
            let queue = DispatchQueue(label: "HostReachability")
            let tracker = ResponseTracker()

            monitor.pathUpdateHandler = { path in
                Task {
                    let shouldRespond = await tracker.checkAndRespond()
                    if shouldRespond {
                        let isReachable = path.status == .satisfied
                        monitor.cancel()
                        continuation.resume(returning: isReachable)
                    }
                }
            }

            monitor.start(queue: queue)

            // Timeout after 5 seconds
            queue.asyncAfter(deadline: .now() + 5) {
                Task {
                    let shouldRespond = await tracker.checkAndRespond()
                    if shouldRespond {
                        monitor.cancel()
                        continuation.resume(returning: false)
                    }
                }
            }
        }
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let networkBecameAvailable = Notification.Name("networkBecameAvailable")
    static let networkBecameUnavailable = Notification.Name("networkBecameUnavailable")
}

// MARK: - View Modifier for Offline Banner

struct OfflineBanner: ViewModifier {
    @State private var networkMonitor = NetworkMonitor.shared
    @State private var showBanner = false

    func body(content: Content) -> some View {
        ZStack(alignment: .top) {
            content

            if showBanner && !networkMonitor.isConnected {
                VStack(spacing: 0) {
                    HStack {
                        Image(systemName: "wifi.slash")
                            .foregroundColor(Theme.Colors.terminalBackground)

                        Text("No Internet Connection")
                            .foregroundColor(Theme.Colors.terminalBackground)
                            .font(.footnote.bold())

                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Theme.Colors.errorAccent)
                    .animation(.easeInOut(duration: 0.3), value: showBanner)
                    .transition(.move(edge: .top).combined(with: .opacity))

                    Spacer()
                }
                .ignoresSafeArea()
            }
        }
        .onAppear {
            showBanner = true
        }
        .onChange(of: networkMonitor.isConnected) { oldValue, newValue in
            if !oldValue && newValue {
                // Coming back online - hide banner after delay
                Task {
                    try? await Task.sleep(nanoseconds: 2_000_000_000) // 2 seconds
                    showBanner = false
                }
            } else if oldValue && !newValue {
                // Going offline - show banner immediately
                showBanner = true
            }
        }
    }
}

extension View {
    func offlineBanner() -> some View {
        modifier(OfflineBanner())
    }
}

// MARK: - Connection Status View

struct ConnectionStatusView: View {
    @State private var networkMonitor = NetworkMonitor.shared

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(networkMonitor.isConnected ? Theme.Colors.successAccent : Theme.Colors.errorAccent)
                .frame(width: 8, height: 8)

            Text(networkMonitor.isConnected ? "Online" : "Offline")
                .font(.caption)
                .foregroundColor(Theme.Colors.terminalGray)

            if networkMonitor.isConnected {
                switch networkMonitor.connectionType {
                case .wifi:
                    Image(systemName: "wifi")
                        .font(.caption)
                        .foregroundColor(Theme.Colors.terminalGray)
                case .cellular:
                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .font(.caption)
                        .foregroundColor(Theme.Colors.terminalGray)
                case .wiredEthernet:
                    Image(systemName: "cable.connector")
                        .font(.caption)
                        .foregroundColor(Theme.Colors.terminalGray)
                default:
                    EmptyView()
                }

                if networkMonitor.isExpensive {
                    Image(systemName: "dollarsign.circle")
                        .font(.caption)
                        .foregroundColor(Theme.Colors.warningAccent)
                        .help("Connection may incur charges")
                }

                if networkMonitor.isConstrained {
                    Image(systemName: "tortoise")
                        .font(.caption)
                        .foregroundColor(Theme.Colors.warningAccent)
                        .help("Low Data Mode is enabled")
                }
            }
        }
    }
}
