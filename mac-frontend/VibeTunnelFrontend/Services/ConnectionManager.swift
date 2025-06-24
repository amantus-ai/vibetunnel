import Foundation
import SwiftUI
import os

@Observable
final class ConnectionManager: @unchecked Sendable {
    static let shared = ConnectionManager()
    
    private let userDefaultsKey = "SavedServerConfig"
    
    var serverURL: URL?
    var authHeader: String?
    var isConnecting = false
    var error: ConnectionError?
    var requiresAuthentication = false
    var showAuthSheet = false
    private var wasConnected = false
    
    var isConnected: Bool {
        serverURL != nil
    }
    
    var serverConfig: ServerConfig? {
        guard let serverURL else { return nil }
        return ServerConfig(url: serverURL, authHeader: authHeader)
    }
    
    init() {
        // loadSavedConnection will be called from the app
    }
    
    @MainActor
    func connect(to url: URL, authHeader: String? = nil) async throws {
        isConnecting = true
        error = nil
        requiresAuthentication = false
        
        defer { isConnecting = false }
        
        // Validate URL
        guard url.scheme == "http" || url.scheme == "https" else {
            let error = ConnectionError.invalidURL
            self.error = error
            throw error
        }
        
        // Store the URL temporarily for auth check
        self.serverURL = url
        
        // Check if authentication is required
        do {
            // First, check auth configuration
            var noAuthMode = false
            do {
                let authConfig = try await AuthService.shared.getAuthConfig(serverURL: url)
                noAuthMode = authConfig.noAuthForLocalhost ?? false
                Logger.network.info("Auth config - noAuthForLocalhost: \(noAuthMode)")
            } catch {
                // If auth config fails, fall back to auth check
                Logger.network.warning("Failed to get auth config, falling back to auth check: \(error)")
            }
            
            // If no-auth mode for localhost, skip auth
            if noAuthMode && (url.host() == "localhost" || url.host() == "127.0.0.1") {
                Logger.network.info("No-auth mode enabled for localhost, skipping authentication")
                requiresAuthentication = false
            } else {
                let authRequired = try await AuthService.shared.checkAuthRequired(serverURL: url)
                
                if authRequired && authHeader == nil && AuthService.shared.authToken == nil {
                    // Need authentication - show auth sheet
                    requiresAuthentication = true
                    showAuthSheet = true
                    return
                }
            }
            
            // Use existing auth header or get from AuthService
            let finalAuthHeader = authHeader ?? AuthService.shared.getAuthHeader()
            
            // Test connection with timeout
            let testURL = url.appendingPathComponent("api/sessions")
            var request = URLRequest(url: testURL)
            request.timeoutInterval = 10.0
            
            if let finalAuthHeader {
                request.setValue(finalAuthHeader, forHTTPHeaderField: "Authorization")
            }
            
            let (_, response) = try await URLSession.shared.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse else {
                throw ConnectionError.invalidResponse
            }
            
            guard httpResponse.statusCode == 200 else {
                if httpResponse.statusCode == 401 {
                    // Authentication failed - show auth sheet
                    requiresAuthentication = true
                    showAuthSheet = true
                    return
                } else if httpResponse.statusCode == 404 {
                    throw ConnectionError.notFound
                } else if httpResponse.statusCode >= 500 {
                    throw ConnectionError.serverError(statusCode: httpResponse.statusCode)
                }
                throw ConnectionError.httpError(statusCode: httpResponse.statusCode)
            }
            
            // Connection successful
            self.authHeader = finalAuthHeader
            saveConnection()
            
            // Configure buffer subscription service
            BufferSubscriptionService.shared.configure(serverURL: url, authHeader: finalAuthHeader)
            
            // Update status bar and send notification
            Logger.network.info("Successfully connected to server: \(url.absoluteString)")
            StatusBarManager.shared.updateConnectionStatus(connected: true, serverURL: url)
            StatusBarManager.shared.showSuccess("Connected to \(url.host ?? "server")")
            
            // Send connection notification
            await NotificationManager.shared.notifyConnectionStatus(
                connected: true,
                serverURL: url
            )
            
            wasConnected = true
            
        } catch let error as ConnectionError {
            self.error = error
            handleConnectionError(error)
            throw error
        } catch let error as URLError {
            let connectionError: ConnectionError
            switch error.code {
            case .timedOut:
                connectionError = .timeout
            case .notConnectedToInternet:
                connectionError = .noInternet
            case .cannotFindHost, .dnsLookupFailed:
                connectionError = .hostNotFound
            default:
                connectionError = .networkError(error)
            }
            self.error = connectionError
            handleConnectionError(connectionError)
            throw connectionError
        } catch {
            let connectionError = ConnectionError.networkError(error)
            self.error = connectionError
            handleConnectionError(connectionError)
            throw connectionError
        }
    }
    
    @MainActor
    func disconnect() {
        let previousURL = serverURL
        serverURL = nil
        authHeader = nil
        error = nil
        requiresAuthentication = false
        showAuthSheet = false
        clearSavedConnection()
        
        // Clear auth
        AuthService.shared.logout()
        
        // Disconnect buffer subscription service
        BufferSubscriptionService.shared.disconnect()
        
        // Update status bar
        Logger.network.info("Disconnected from server")
        StatusBarManager.shared.updateConnectionStatus(connected: false)
        StatusBarManager.shared.showMessage("Disconnected")
        
        // Send disconnection notification if was previously connected
        if wasConnected {
            Task {
                await NotificationManager.shared.notifyConnectionStatus(
                    connected: false,
                    serverURL: previousURL
                )
            }
        }
        
        wasConnected = false
    }
    
    @MainActor
    func completeAuthenticatedConnection() async {
        guard let url = serverURL else { return }
        
        showAuthSheet = false
        requiresAuthentication = false
        
        // Retry connection with auth
        do {
            try await connect(to: url)
        } catch {
            // Error already handled in connect
        }
    }
    
    @MainActor
    func loadSavedConnection() {
        guard let data = UserDefaults.standard.data(forKey: userDefaultsKey),
              let config = try? JSONDecoder().decode(ServerConfig.self, from: data) else {
            return
        }
        
        serverURL = config.url
        authHeader = config.authHeader
        
        // Update status bar to show saved connection
        if let url = serverURL {
            StatusBarManager.shared.updateConnectionStatus(connected: true, serverURL: url)
            wasConnected = true
            
            // Configure buffer subscription service for saved connection
            BufferSubscriptionService.shared.configure(serverURL: url, authHeader: authHeader)
        }
    }
    
    private func saveConnection() {
        guard let serverConfig else { return }
        
        if let data = try? JSONEncoder().encode(serverConfig) {
            UserDefaults.standard.set(data, forKey: userDefaultsKey)
        }
    }
    
    private func clearSavedConnection() {
        UserDefaults.standard.removeObject(forKey: userDefaultsKey)
    }
    
    @MainActor
    private func handleConnectionError(_ error: ConnectionError) {
        Logger.logError(Logger.network, "Connection failed", error: error)
        StatusBarManager.shared.updateConnectionStatus(connected: false)
        
        // Show error using ErrorPresenter for critical errors
        switch error {
        case .timeout:
            StatusBarManager.shared.showError("Connection timed out")
        case .noInternet:
            StatusBarManager.shared.showError("No internet connection")
        case .hostNotFound:
            StatusBarManager.shared.showError("Server not found")
        case .unauthorized:
            ErrorPresenter.shared.showCriticalError(
                "Authentication Failed",
                message: error.errorDescription ?? "Authentication required",
                error: error
            )
        case .serverError:
            ErrorPresenter.shared.showError(
                "Server Error",
                message: error.errorDescription ?? "Server returned an error",
                error: error
            )
        default:
            StatusBarManager.shared.showError(error.errorDescription ?? "Connection failed")
        }
        
        // Send notification if app is in background and was previously connected
        if wasConnected && !NSApplication.shared.isActive {
            Task {
                await NotificationManager.shared.showNotification(
                    title: "Connection Lost",
                    body: error.errorDescription ?? "Failed to connect to VibeTunnel server"
                )
            }
        }
    }
}

enum ConnectionError: LocalizedError {
    case invalidURL
    case invalidResponse
    case unauthorized
    case notFound
    case serverError(statusCode: Int)
    case httpError(statusCode: Int)
    case networkError(Error)
    case timeout
    case noInternet
    case hostNotFound
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid server URL. Please use http:// or https://"
        case .invalidResponse:
            return "Invalid server response"
        case .unauthorized:
            return "Authentication required"
        case .notFound:
            return "VibeTunnel server not found at this URL"
        case .serverError(let code):
            return "Server error (HTTP \(code))"
        case .httpError(let code):
            return "HTTP error \(code)"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .timeout:
            return "Connection timed out"
        case .noInternet:
            return "No internet connection"
        case .hostNotFound:
            return "Server host not found"
        }
    }
    
    var recoverySuggestion: String? {
        switch self {
        case .invalidURL:
            return "Make sure the URL starts with http:// or https://"
        case .unauthorized:
            return "Check your authentication credentials"
        case .notFound:
            return "Verify the server URL and that VibeTunnel is running"
        case .timeout:
            return "Check your internet connection and try again"
        case .noInternet:
            return "Connect to the internet and try again"
        case .hostNotFound:
            return "Verify the server address is correct"
        default:
            return nil
        }
    }
}