import Foundation
@testable import VibeTunnel

/// Mock implementation for testing ConnectionManager functionality
@MainActor
class MockConnectionManager {
    var disconnectCallCount = 0
    
    func disconnect() async {
        disconnectCallCount += 1
    }
}