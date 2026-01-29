import Foundation
@testable import ShellOps

/// Mock implementation for testing ConnectionManager functionality
@MainActor
class MockConnectionManager {
    var disconnectCallCount = 0

    func disconnect() async {
        self.disconnectCallCount += 1
    }
}
