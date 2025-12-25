import Foundation

/// Errors specific to authentication operations
enum AuthenticationError: LocalizedError {
    case credentialsNotFound
    case invalidCredentials
    case tokenExpired
    case serverError(String)

    var errorDescription: String? {
        switch self {
        case .credentialsNotFound:
            "No stored credentials found"
        case .invalidCredentials:
            "Invalid username or password"
        case .tokenExpired:
            "Authentication token has expired"
        case let .serverError(message):
            "Server error: \(message)"
        }
    }
}

/// Authentication service for managing JWT token-based authentication.
/// Handles login, token storage, and authentication state management.
@MainActor
final class AuthenticationService: ObservableObject {
    private let logger = Logger(category: "AuthenticationService")

    // MARK: - Published Properties

    @Published private(set) var isAuthenticated = false
    @Published private(set) var currentUser: String?
    @Published private(set) var authMethod: AuthMethod?
    @Published private(set) var authToken: String?

    // MARK: - Types

    /// Supported authentication methods.
    /// Defines the different ways users can authenticate with the server.
    enum AuthMethod: String, Codable {
        case password
        case sshKey = "ssh-key"
        case noAuth = "no-auth"
    }

    /// Server authentication configuration.
    /// Describes which authentication methods are enabled on the server.
    struct AuthConfig: Codable {
        let noAuth: Bool
        let enableSSHKeys: Bool
        let disallowUserPassword: Bool
    }

    /// Authentication response from the server.
    /// Contains authentication result and optional token/error information.
    struct AuthResponse: Codable {
        let success: Bool
        let token: String?
        let userId: String?
        let authMethod: String?
        let error: String?
    }

    /// User authentication data stored locally.
    /// Persists user information and login metadata.
    struct UserData: Codable {
        let userId: String
        let authMethod: String
        let loginTime: Date
    }

    // MARK: - Properties

    private let apiClient: APIClient
    private let serverConfig: ServerConfig
    private let keychainService: KeychainServiceProtocol

    private let tokenKey: String
    private let userDataKey: String

    // MARK: - Initialization

    init(
        apiClient: APIClient,
        serverConfig: ServerConfig,
        keychainService: KeychainServiceProtocol = KeychainService())
    {
        self.apiClient = apiClient
        self.serverConfig = serverConfig
        self.keychainService = keychainService
        self.tokenKey = "auth_token_\(serverConfig.id)"
        self.userDataKey = "user_data_\(serverConfig.id)"

        // Check for existing authentication
        Task {
            await self.checkExistingAuth()
        }
    }

    // MARK: - Public Methods

    /// Get the current system username
    func getCurrentUsername() async throws -> String {
        let url = self.serverConfig.apiURL(path: "/api/auth/current-user")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        let (data, _) = try await URLSession.shared.data(for: request)

        struct CurrentUserResponse: Codable {
            let userId: String
        }

        let response = try JSONDecoder().decode(CurrentUserResponse.self, from: data)
        return response.userId
    }

    /// Get authentication configuration from server
    func getAuthConfig() async throws -> AuthConfig {
        let url = self.serverConfig.apiURL(path: "/api/auth/config")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(AuthConfig.self, from: data)
    }

    /// Authenticate with password
    func authenticateWithPassword(username: String, password: String) async throws {
        let url = self.serverConfig.apiURL(path: "/api/auth/password")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = ["userId": username, "password": password]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)

        if httpResponse.statusCode == 200, authResponse.success, let token = authResponse.token {
            // Store token and user data
            try self.keychainService.savePassword(token, for: self.tokenKey)

            let userData = UserData(
                userId: username,
                authMethod: authResponse.authMethod ?? "password",
                loginTime: Date())
            let userDataJson = try JSONEncoder().encode(userData)
            guard let userDataString = String(data: userDataJson, encoding: .utf8) else {
                self.logger.error("Failed to convert user data to UTF-8 string")
                throw APIError.dataEncodingFailed
            }
            try self.keychainService.savePassword(userDataString, for: self.userDataKey)

            // Update state
            self.authToken = token
            self.currentUser = username
            self.authMethod = AuthMethod(rawValue: authResponse.authMethod ?? "password")
            self.isAuthenticated = true

            self.logger.info("Successfully authenticated user: \(username)")
        } else {
            throw APIError.authenticationFailed(authResponse.error ?? "Authentication failed")
        }
    }

    /// Verify if current token is still valid
    func verifyToken() async -> Bool {
        guard let token = authToken else { return false }

        let url = self.serverConfig.apiURL(path: "/api/auth/verify")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            if let httpResponse = response as? HTTPURLResponse {
                return httpResponse.statusCode == 200
            }
        } catch {
            self.logger.error("Token verification failed: \(error)")
        }

        return false
    }

    /// Logout and clear authentication
    func logout() async {
        // Call logout endpoint if authenticated
        if let token = authToken {
            let url = self.serverConfig.apiURL(path: "/api/auth/logout")
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

            do {
                _ = try await URLSession.shared.data(for: request)
            } catch {
                self.logger.error("Logout request failed: \(error)")
            }
        }

        // Clear stored credentials
        try? self.keychainService.deletePassword(for: self.tokenKey)
        try? self.keychainService.deletePassword(for: self.userDataKey)

        // Clear state
        self.authToken = nil
        self.currentUser = nil
        self.authMethod = nil
        self.isAuthenticated = false
    }

    /// Get authentication header for API requests
    func getAuthHeader() -> [String: String] {
        guard let token = authToken else { return [:] }
        return ["Authorization": "Bearer \(token)"]
    }

    /// Get token for query parameters (used for WebSocket auth)
    func getTokenForQuery() -> String? {
        self.authToken
    }

    /// Attempt automatic login using stored credentials for a server profile
    func attemptAutoLogin(profile: ServerProfile) async throws {
        self.logger
            .debug(
                "attemptAutoLogin called for profile: \(profile.name) (id: \(profile.id)), isAuthenticated: \(self.isAuthenticated)")
        self.logger.debug("Profile requiresAuth: \(profile.requiresAuth), username: \(profile.username ?? "nil")")

        // Check if we already have valid authentication
        if self.isAuthenticated {
            let tokenValid = await verifyToken()
            if tokenValid {
                self.logger.info("Already authenticated with valid token for user: \(self.currentUser ?? "unknown")")
                return
            } else {
                self.logger.warning("Token verification failed, will attempt fresh login")
            }
        }

        // Check if profile requires authentication
        if !profile.requiresAuth {
            self.logger
                .debug(
                    "Profile does not require authentication, but server requires it - treating as credentials not found")
            throw AuthenticationError.credentialsNotFound
        }

        // Get stored password from keychain
        do {
            let password = try keychainService.getPassword(for: profile.id)
            self.logger.debug("Successfully retrieved password from keychain for profile: \(profile.name)")
            self.logger.debug("Password length: \(password.count) characters")

            // Get username from profile or use default
            guard let username = profile.username else {
                self.logger.error("No username configured for profile: \(profile.name)")
                throw AuthenticationError.credentialsNotFound
            }

            self.logger.debug("Attempting authentication with username: \(username)")

            // Attempt authentication with stored credentials
            do {
                try await self.authenticateWithPassword(username: username, password: password)
                self.logger.info("Auto-login successful for user: \(username)")
            } catch {
                self.logger.error("Auto-login failed for user: \(username), error: \(error)")
                if let apiError = error as? APIError {
                    switch apiError {
                    case .serverError(401, _):
                        throw AuthenticationError.invalidCredentials
                    case let .serverError(code, message):
                        throw AuthenticationError.serverError(message ?? "HTTP \(code)")
                    default:
                        throw AuthenticationError.serverError(apiError.localizedDescription)
                    }
                }
                throw AuthenticationError.invalidCredentials
            }
        } catch {
            self.logger
                .error(
                    "Failed to retrieve password from keychain for profile: \(profile.name), error: \(error)")
            self.logger.debug("Looking for keychain item with account: server-\(profile.id)")
            if let keychainErr = error as? KeychainService.KeychainError {
                switch keychainErr {
                case .itemNotFound:
                    self.logger.debug("Keychain item not found for profile id: \(profile.id)")
                default:
                    self.logger.error("Keychain error: \(keychainErr)")
                }
            }
            throw AuthenticationError.credentialsNotFound
        }
    }

    // MARK: - Private Methods

    private func checkExistingAuth() async {
        // Try to load existing token
        if let token = try? keychainService.loadPassword(for: tokenKey),
           let userDataJson = try? keychainService.loadPassword(for: userDataKey),
           let userDataData = userDataJson.data(using: .utf8),
           let userData = try? JSONDecoder().decode(UserData.self, from: userDataData)
        {
            // Check if token is less than 24 hours old
            let tokenAge = Date().timeIntervalSince(userData.loginTime)
            if tokenAge < 24 * 60 * 60 { // 24 hours
                self.authToken = token
                self.currentUser = userData.userId
                self.authMethod = AuthMethod(rawValue: userData.authMethod)

                // Verify token is still valid
                if await self.verifyToken() {
                    self.isAuthenticated = true
                    self.logger.info("Restored authentication for user: \(userData.userId)")
                } else {
                    // Token invalid, clear it
                    await self.logout()
                }
            } else {
                // Token too old, clear it
                await self.logout()
            }
        }
    }
}

// MARK: - API Error Extension

extension APIError {
    static func authenticationFailed(_ message: String) -> APIError {
        APIError.serverError(500, message)
    }

    static var dataEncodingFailed: APIError {
        APIError.serverError(500, "Failed to encode authentication data")
    }
}
