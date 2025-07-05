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
        case .serverError(let message):
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
        case password = "password"
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
        keychainService: KeychainServiceProtocol = KeychainService()
    ) {
        self.apiClient = apiClient
        self.serverConfig = serverConfig
        self.keychainService = keychainService
        self.tokenKey = "auth_token_\(serverConfig.id)"
        self.userDataKey = "user_data_\(serverConfig.id)"

        // Check for existing authentication
        Task {
            await checkExistingAuth()
        }
    }

    // MARK: - Public Methods

    /// Get the current system username
    func getCurrentUsername() async throws -> String {
        let url = serverConfig.apiURL(path: "/api/auth/current-user")
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
        let url = serverConfig.apiURL(path: "/api/auth/config")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(AuthConfig.self, from: data)
    }

    /// Authenticate with password
    func authenticateWithPassword(username: String, password: String) async throws {
        let url = serverConfig.apiURL(path: "/api/auth/password")
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
            try keychainService.savePassword(token, for: tokenKey)

            let userData = UserData(
                userId: username,
                authMethod: authResponse.authMethod ?? "password",
                loginTime: Date()
            )
            let userDataJson = try JSONEncoder().encode(userData)
            guard let userDataString = String(data: userDataJson, encoding: .utf8) else {
                logger.error("Failed to convert user data to UTF-8 string")
                throw APIError.dataEncodingFailed
            }
            try keychainService.savePassword(userDataString, for: userDataKey)

            // Update state
            self.authToken = token
            self.currentUser = username
            self.authMethod = AuthMethod(rawValue: authResponse.authMethod ?? "password")
            self.isAuthenticated = true

            logger.info("Successfully authenticated user: \(username)")
        } else {
            throw APIError.authenticationFailed(authResponse.error ?? "Authentication failed")
        }
    }

    /// Verify if current token is still valid
    func verifyToken() async -> Bool {
        guard let token = authToken else { return false }

        let url = serverConfig.apiURL(path: "/api/auth/verify")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            if let httpResponse = response as? HTTPURLResponse {
                return httpResponse.statusCode == 200
            }
        } catch {
            logger.error("Token verification failed: \(error)")
        }

        return false
    }

    /// Logout and clear authentication
    func logout() async {
        // Call logout endpoint if authenticated
        if let token = authToken {
            let url = serverConfig.apiURL(path: "/api/auth/logout")
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

            do {
                _ = try await URLSession.shared.data(for: request)
            } catch {
                logger.error("Logout request failed: \(error)")
            }
        }

        // Clear stored credentials
        try? keychainService.deletePassword(for: tokenKey)
        try? keychainService.deletePassword(for: userDataKey)

        // Clear state
        authToken = nil
        currentUser = nil
        authMethod = nil
        isAuthenticated = false
    }

    /// Get authentication header for API requests
    func getAuthHeader() -> [String: String] {
        guard let token = authToken else { return [:] }
        return ["Authorization": "Bearer \(token)"]
    }

    /// Get token for query parameters (used for SSE)
    func getTokenForQuery() -> String? {
        authToken
    }

    /// Attempt automatic login using stored credentials for a server profile
    func attemptAutoLogin(profile: ServerProfile) async throws {
        logger
            .debug(
                "attemptAutoLogin called for profile: \(profile.name) (id: \(profile.id)), isAuthenticated: \(isAuthenticated)"
            )
        logger.debug("Profile requiresAuth: \(profile.requiresAuth), username: \(profile.username ?? "nil")")

        // Check if we already have valid authentication
        if isAuthenticated {
            let tokenValid = await verifyToken()
            if tokenValid {
                logger.info("Already authenticated with valid token for user: \(currentUser ?? "unknown")")
                return
            } else {
                logger.warning("Token verification failed, will attempt fresh login")
            }
        }

        // Check if profile requires authentication
        if !profile.requiresAuth {
            logger
                .debug(
                    "Profile does not require authentication, but server requires it - treating as credentials not found"
                )
            throw AuthenticationError.credentialsNotFound
        }

        // Get stored password from keychain
        do {
            let password = try keychainService.getPassword(for: profile.id)
            logger.debug("Successfully retrieved password from keychain for profile: \(profile.name)")
            logger.debug("Password length: \(password.count) characters")

            // Get username from profile or use default
            guard let username = profile.username else {
                logger.error("No username configured for profile: \(profile.name)")
                throw AuthenticationError.credentialsNotFound
            }

            logger.debug("Attempting authentication with username: \(username)")

            // Attempt authentication with stored credentials
            do {
                try await authenticateWithPassword(username: username, password: password)
                logger.info("Auto-login successful for user: \(username)")
            } catch {
                logger.error("Auto-login failed for user: \(username), error: \(error)")
                if let apiError = error as? APIError {
                    switch apiError {
                    case .serverError(401, _):
                        throw AuthenticationError.invalidCredentials
                    case .serverError(let code, let message):
                        throw AuthenticationError.serverError(message ?? "HTTP \(code)")
                    default:
                        throw AuthenticationError.serverError(apiError.localizedDescription)
                    }
                }
                throw AuthenticationError.invalidCredentials
            }
        } catch {
            logger
                .error(
                    "Failed to retrieve password from keychain for profile: \(profile.name), error: \(error)"
                )
            logger.debug("Looking for keychain item with account: server-\(profile.id)")
            if let keychainErr = error as? KeychainService.KeychainError {
                switch keychainErr {
                case .itemNotFound:
                    logger.debug("Keychain item not found for profile id: \(profile.id)")
                default:
                    logger.error("Keychain error: \(keychainErr)")
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
                if await verifyToken() {
                    self.isAuthenticated = true
                    logger.info("Restored authentication for user: \(userData.userId)")
                } else {
                    // Token invalid, clear it
                    await logout()
                }
            } else {
                // Token too old, clear it
                await logout()
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
