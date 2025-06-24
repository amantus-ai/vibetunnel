import Foundation
import SwiftUI
import os.log

@Observable
@MainActor
final class SessionManager {
    var sessions: [Session] = []
    var isLoading = false
    var error: Error?
    var searchText = ""
    var showExitedSessions = true
    var showNewSessionSheet = false
    var autoRefreshEnabled = true
    
    // Connection settings from ConnectionManager
    var serverURL: URL?
    var authHeader: String?
    
    private var refreshTimer: Timer?
    private let refreshInterval: TimeInterval = 3.0
    
    var filteredSessions: [Session] {
        sessions.filter { session in
            (showExitedSessions || session.isRunning) &&
            (searchText.isEmpty || 
             session.displayName.localizedCaseInsensitiveContains(searchText) ||
             session.command.localizedCaseInsensitiveContains(searchText))
        }
    }
    
    var runningSessions: [Session] {
        sessions.filter { $0.isRunning }
    }
    
    var exitedSessions: [Session] {
        sessions.filter { !$0.isRunning }
    }
    
    var sessionCounts: (running: Int, exited: Int) {
        let running = sessions.filter { $0.isRunning }.count
        let exited = sessions.filter { !$0.isRunning }.count
        return (running, exited)
    }
    
    nonisolated init() {}
    
    @MainActor
    func startRefreshing() {
        Task {
            await loadSessions()
        }
        
        refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: refreshInterval, repeats: true) { _ in
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                if self.autoRefreshEnabled {
                    await self.loadSessions()
                }
            }
        }
    }
    
    func stopRefreshing() {
        refreshTimer?.invalidate()
        refreshTimer = nil
        sessions = []
    }
    
    @MainActor
    func loadSessions() async {
        guard let serverURL, !isLoading else { return }
        
        do {
            let previousSessions = self.sessions
            let sessions = try await APIClient.shared.fetchSessions(
                serverURL: serverURL,
                authHeader: authHeader
            )
            
            // Check for newly exited sessions
            for newSession in sessions {
                if let previousSession = previousSessions.first(where: { $0.id == newSession.id }) {
                    // Session transitioned from running to exited
                    if previousSession.isRunning && !newSession.isRunning {
                        await NotificationManager.shared.notifySessionCompleted(newSession)
                    }
                }
            }
            
            // Update sessions while preserving selection state
            self.sessions = sessions.sorted { lhs, rhs in
                // Running sessions first, then by creation date
                if lhs.isRunning != rhs.isRunning {
                    return lhs.isRunning
                }
                return lhs.createdAt > rhs.createdAt
            }
            
            error = nil
        } catch let loadError {
            self.error = loadError
            
            // Log the error with details
            Logger.logError(Logger.session, "Failed to load sessions", error: loadError)
            
            // Present error based on type
            if let urlError = loadError as? URLError {
                switch urlError.code {
                case .notConnectedToInternet:
                    ErrorPresenter.shared.showWarning("No Internet Connection", 
                                                     message: "Please check your network connection and try again.")
                case .cannotFindHost, .cannotConnectToHost:
                    ErrorPresenter.shared.showWarning("Cannot Connect to Server", 
                                                     message: "Unable to reach the server at \(serverURL.absoluteString). Please verify the server is running.")
                case .badServerResponse:
                    ErrorPresenter.shared.showError("Invalid Server Response", 
                                                   message: "The server returned an invalid response. This might indicate a version mismatch.",
                                                   error: loadError)
                default:
                    ErrorPresenter.shared.showError("Failed to Load Sessions", 
                                                   message: "Unable to retrieve the session list from the server.",
                                                   error: loadError)
                }
            } else if loadError is DecodingError {
                // This is likely what's happening based on the error message in the screenshot
                ErrorPresenter.shared.showError("Data Format Error", 
                                               message: "The server returned data in an unexpected format. This might indicate a version mismatch between the client and server.",
                                               error: loadError)
            } else {
                ErrorPresenter.shared.showError("Failed to Load Sessions", 
                                               message: loadError.localizedDescription,
                                               error: loadError)
            }
        }
    }
    
    @MainActor
    func createSession(command: String, workingDirectory: String, name: String?, spawnInNativeTerminal: Bool = false) async throws -> Session? {
        guard let serverURL else { throw APIError.noServerURL }
        
        let response = try await APIClient.shared.createSession(
            serverURL: serverURL,
            authHeader: authHeader,
            command: command,
            workingDirectory: workingDirectory,
            name: name,
            spawnInNativeTerminal: spawnInNativeTerminal
        )
        
        // If spawned in native terminal, no session to track
        if response.spawnedInNativeTerminal == true {
            return nil
        }
        
        // Refresh sessions to get the new one
        await loadSessions()
        
        // Return the newly created session
        return sessions.first { $0.id == response.sessionId }
    }
    
    @MainActor
    func killSession(_ session: Session) async throws {
        guard let serverURL else { throw APIError.noServerURL }
        
        try await APIClient.shared.killSession(
            serverURL: serverURL,
            authHeader: authHeader,
            sessionId: session.id
        )
        
        await loadSessions()
        Logger.session.info("Session killed: \(session.id)")
        StatusBarManager.shared.showSuccess("Session terminated")
    }
    
    @MainActor
    func killAllSessions() async {
        guard let serverURL else { return }
        
        let authHeader = self.authHeader
        let sessions = self.runningSessions
        
        await withTaskGroup(of: Void.self) { group in
            for session in sessions {
                group.addTask {
                    try? await APIClient.shared.killSession(
                        serverURL: serverURL,
                        authHeader: authHeader,
                        sessionId: session.id
                    )
                }
            }
        }
        
        let count = sessions.count
        await loadSessions()
        Logger.session.info("All sessions killed: \(count) sessions terminated")
        StatusBarManager.shared.showSuccess("\(count) sessions terminated")
    }
    
    @MainActor
    func cleanupExitedSessions() async {
        guard let serverURL else { return }
        
        do {
            try await APIClient.shared.cleanupExitedSessions(
                serverURL: serverURL,
                authHeader: authHeader
            )
            await loadSessions()
            Logger.session.info("Cleaned up exited sessions")
            StatusBarManager.shared.showSuccess("Exited sessions cleaned up")
        } catch {
            self.error = error
            Logger.logError(Logger.session, "Failed to cleanup sessions", error: error)
            ErrorPresenter.shared.showError("Cleanup Failed", 
                                           message: "Unable to remove exited sessions from the server.",
                                           error: error)
        }
    }
}

enum APIError: LocalizedError {
    case noServerURL
    case invalidResponse
    case decodingError
    case httpError(statusCode: Int)
    case sessionNotFound(String)
    case inputTooLarge
    case timeout
    case noConnection
    case networkError(Error)
    case authenticationFailed
    case authenticationRequired
    case notConnected
    
    var errorDescription: String? {
        switch self {
        case .noServerURL:
            return "No server URL configured"
        case .invalidResponse:
            return "Invalid server response"
        case .decodingError:
            return "Failed to decode server response"
        case .httpError(let statusCode):
            return "HTTP error \(statusCode)"
        case .sessionNotFound(let sessionId):
            return "Session \(sessionId) not found"
        case .inputTooLarge:
            return "Input text is too large (max 10KB)"
        case .timeout:
            return "Request timed out"
        case .noConnection:
            return "No internet connection"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .authenticationFailed:
            return "Authentication failed"
        case .authenticationRequired:
            return "Authentication required"
        case .notConnected:
            return "Not connected to server"
        }
    }
    
    var recoverySuggestion: String? {
        switch self {
        case .noServerURL:
            return "Connect to a VibeTunnel server first"
        case .sessionNotFound:
            return "The session may have exited or been killed"
        case .inputTooLarge:
            return "Try sending smaller chunks of text"
        case .timeout:
            return "Check your connection and try again"
        case .noConnection:
            return "Check your internet connection"
        case .authenticationFailed:
            return "Check your credentials and try again"
        case .authenticationRequired:
            return "Please log in to access this server"
        case .notConnected:
            return "Connect to a server first"
        default:
            return nil
        }
    }
}
