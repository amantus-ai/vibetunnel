import Testing
import Foundation
@testable import VibeTunnelFrontend

@Suite("Connection Manager Tests")
struct ConnectionManagerTests {
    @Test("Initial state")
    func testInitialState() {
        let manager = ConnectionManager()
        
        #expect(manager.serverURL == nil)
        #expect(manager.authHeader == nil)
        #expect(manager.isConnected == false)
        #expect(manager.isConnecting == false)
        #expect(manager.error == nil)
    }
    
    @Test("Server config creation")
    func testServerConfig() {
        let manager = ConnectionManager()
        manager.serverURL = URL(string: "http://localhost:5173")!
        manager.authHeader = "Bearer token123"
        
        let config = manager.serverConfig
        #expect(config?.url.absoluteString == "http://localhost:5173")
        #expect(config?.authHeader == "Bearer token123")
    }
    
    @Test("Server config when not connected")
    func testServerConfigWhenNotConnected() {
        let manager = ConnectionManager()
        #expect(manager.serverConfig == nil)
    }
    
    @Test("Disconnect clears state")
    @MainActor
    func testDisconnect() {
        let manager = ConnectionManager()
        manager.serverURL = URL(string: "http://localhost:5173")!
        manager.authHeader = "Bearer token123"
        manager.error = ConnectionError.timeout
        
        manager.disconnect()
        
        #expect(manager.serverURL == nil)
        #expect(manager.authHeader == nil)
        #expect(manager.error == nil)
    }
    
    @Test("Connection error descriptions")
    func testErrorDescriptions() {
        #expect(ConnectionError.invalidURL.errorDescription == "Invalid server URL. Please use http:// or https://")
        #expect(ConnectionError.unauthorized.errorDescription == "Authentication required")
        #expect(ConnectionError.notFound.errorDescription == "VibeTunnel server not found at this URL")
        #expect(ConnectionError.timeout.errorDescription == "Connection timed out")
        #expect(ConnectionError.noInternet.errorDescription == "No internet connection")
        #expect(ConnectionError.hostNotFound.errorDescription == "Server host not found")
    }
    
    @Test("Connection error recovery suggestions")
    func testErrorRecoverySuggestions() {
        #expect(ConnectionError.invalidURL.recoverySuggestion == "Make sure the URL starts with http:// or https://")
        #expect(ConnectionError.unauthorized.recoverySuggestion == "Check your authentication credentials")
        #expect(ConnectionError.notFound.recoverySuggestion == "Verify the server URL and that VibeTunnel is running")
        #expect(ConnectionError.timeout.recoverySuggestion == "Check your internet connection and try again")
        #expect(ConnectionError.noInternet.recoverySuggestion == "Connect to the internet and try again")
        #expect(ConnectionError.hostNotFound.recoverySuggestion == "Verify the server address is correct")
    }
}