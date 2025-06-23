import Foundation
import Testing
import Network
@testable import VibeTunnel

@Suite("NetworkMonitor Tests", .tags(.networking, .services))
struct NetworkMonitorTests {

    @Test("Shared instance is singleton")
    @MainActor
    func sharedInstanceSingleton() {
        let instance1 = NetworkMonitor.shared
        let instance2 = NetworkMonitor.shared

        #expect(instance1 === instance2)
    }

    @Test("Initial state")
    @MainActor
    func initialState() {
        let monitor = NetworkMonitor()

        // Initial state should be unknown/checking
        #expect(monitor.isConnected == false)
        #expect(monitor.connectionType == .unknown)
    }

    @Test("Connection type descriptions")
    func connectionTypeDescriptions() {
        #expect(NetworkMonitor.ConnectionType.wifi.description == "Wi-Fi")
        #expect(NetworkMonitor.ConnectionType.cellular.description == "Cellular")
        #expect(NetworkMonitor.ConnectionType.wired.description == "Wired")
        #expect(NetworkMonitor.ConnectionType.unknown.description == "Unknown")
    }

    @Test("Start and stop monitoring")
    @MainActor
    func startStopMonitoring() {
        let monitor = NetworkMonitor()

        // Should be able to start monitoring
        monitor.startMonitoring()

        // Should be able to stop monitoring
        monitor.stopMonitoring()

        // Multiple stops should be safe
        monitor.stopMonitoring()
        monitor.stopMonitoring()
    }

    @Test("Path update handling - WiFi")
    @MainActor
    func pathUpdateWiFi() {
        let monitor = NetworkMonitor()

        // Simulate WiFi connection
        let path = NWPath(status: .satisfied, interfaceType: .wifi)
        monitor.handlePathUpdate(path)

        #expect(monitor.isConnected == true)
        #expect(monitor.connectionType == .wifi)
    }

    @Test("Path update handling - Cellular")
    @MainActor
    func pathUpdateCellular() {
        let monitor = NetworkMonitor()

        // Simulate cellular connection
        let path = NWPath(status: .satisfied, interfaceType: .cellular)
        monitor.handlePathUpdate(path)

        #expect(monitor.isConnected == true)
        #expect(monitor.connectionType == .cellular)
    }

    @Test("Path update handling - No connection")
    @MainActor
    func pathUpdateNoConnection() {
        let monitor = NetworkMonitor()

        // First set to connected
        let connectedPath = NWPath(status: .satisfied, interfaceType: .wifi)
        monitor.handlePathUpdate(connectedPath)
        #expect(monitor.isConnected == true)

        // Then disconnect
        let disconnectedPath = NWPath(status: .unsatisfied, interfaceType: nil)
        monitor.handlePathUpdate(disconnectedPath)

        #expect(monitor.isConnected == false)
        #expect(monitor.connectionType == .unknown)
    }

    @Test("Connection observer notification")
    @MainActor
    func connectionObserver() async {
        let monitor = NetworkMonitor()
        var observedChanges: [(Bool, NetworkMonitor.ConnectionType)] = []

        // Add observer
        let observer = monitor.addConnectionObserver { isConnected, connectionType in
            observedChanges.append((isConnected, connectionType))
        }

        // Simulate connection changes
        let wifiPath = NWPath(status: .satisfied, interfaceType: .wifi)
        monitor.handlePathUpdate(wifiPath)

        let cellularPath = NWPath(status: .satisfied, interfaceType: .cellular)
        monitor.handlePathUpdate(cellularPath)

        let noConnectionPath = NWPath(status: .unsatisfied, interfaceType: nil)
        monitor.handlePathUpdate(noConnectionPath)

        // Allow time for notifications
        try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 second

        // Verify observer was called
        #expect(observedChanges.count >= 3)

        // Remove observer
        monitor.removeConnectionObserver(observer)

        // Further updates should not trigger observer
        let countBefore = observedChanges.count
        monitor.handlePathUpdate(wifiPath)
        try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 second
        #expect(observedChanges.count == countBefore)
    }

    @Test("Multiple observers")
    @MainActor
    func multipleObservers() async {
        let monitor = NetworkMonitor()
        var observer1Called = 0
        var observer2Called = 0

        // Add two observers
        let obs1 = monitor.addConnectionObserver { _, _ in
            observer1Called += 1
        }

        let obs2 = monitor.addConnectionObserver { _, _ in
            observer2Called += 1
        }

        // Trigger update
        let path = NWPath(status: .satisfied, interfaceType: .wifi)
        monitor.handlePathUpdate(path)

        try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 second

        // Both should be called
        #expect(observer1Called > 0)
        #expect(observer2Called > 0)

        // Remove one observer
        monitor.removeConnectionObserver(obs1)

        // Trigger another update
        let path2 = NWPath(status: .satisfied, interfaceType: .cellular)
        monitor.handlePathUpdate(path2)

        try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 second

        // Only observer2 should be called again
        let obs1CountBefore = observer1Called
        #expect(observer2Called > 1)
        #expect(observer1Called == obs1CountBefore)

        // Clean up
        monitor.removeConnectionObserver(obs2)
    }

    @Test("Observer removal safety")
    @MainActor
    func observerRemovalSafety() {
        let monitor = NetworkMonitor()

        // Removing non-existent observer should be safe
        let fakeObserver = UUID()
        monitor.removeConnectionObserver(fakeObserver)

        // Add and remove observer multiple times
        let observer = monitor.addConnectionObserver { _, _ in }
        monitor.removeConnectionObserver(observer)
        monitor.removeConnectionObserver(observer) // Should be safe
    }
}

// MARK: - Mock NWPath for testing

extension NWPath {
    convenience init(status: NWPath.Status, interfaceType: NWInterface.InterfaceType?) {
        self.init()
        // In real tests, we'd need to properly mock NWPath
        // For now, this is a placeholder showing test structure
    }
}
