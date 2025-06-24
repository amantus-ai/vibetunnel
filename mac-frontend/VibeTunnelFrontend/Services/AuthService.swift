import Foundation
import SwiftUI
import Security

@Observable
class AuthService: @unchecked Sendable {
    static let shared = AuthService()
    
    private(set) var currentUser: User?
    private(set) var authToken: String?
    private(set) var isAuthenticated = false
    
    private let session = URLSession.shared
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()
    
    // Keychain constants
    private let serviceName = "com.vibetunnel.mac"
    private let tokenKey = "authToken"
    private let userKey = "currentUser"
    
    private init() {
        decoder.dateDecodingStrategy = .iso8601
        encoder.dateEncodingStrategy = .iso8601
        
        // Load saved auth from keychain
        loadSavedAuth()
    }
    
    func checkAuthRequired(serverURL: URL) async throws -> Bool {
        let url = serverURL.appendingPathComponent("api/auth/check")
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        
        let (_, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        
        // 401 means auth required, 200 means no auth
        return httpResponse.statusCode == 401
    }
    
    func getAuthConfig(serverURL: URL) async throws -> AuthConfig {
        let url = serverURL.appendingPathComponent("api/auth/config")
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        
        return try decoder.decode(AuthConfig.self, from: data)
    }
    
    func getCurrentSystemUser(serverURL: URL) async throws -> String {
        let url = serverURL.appendingPathComponent("api/auth/current-user")
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        
        let userInfo = try decoder.decode([String: String].self, from: data)
        guard let userId = userInfo["userId"] else {
            throw APIError.decodingError
        }
        return userId
    }
    
    func getUserAvatar(serverURL: URL, userId: String) async throws -> Data? {
        let url = serverURL.appendingPathComponent("api/auth/avatar/\(userId)")
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        
        if let authHeader = getAuthHeader() {
            request.setValue(authHeader, forHTTPHeaderField: "Authorization")
        }
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            return nil
        }
        
        let avatarResponse = try decoder.decode([String: String?].self, from: data)
        guard let avatarString = avatarResponse["avatar"],
              let avatar = avatarString,
              avatar.hasPrefix("data:") else {
            return nil
        }
        
        // Extract base64 data from data URL
        let components = avatar.split(separator: ",", maxSplits: 1)
        guard components.count == 2,
              let base64Data = Data(base64Encoded: String(components[1])) else {
            return nil
        }
        
        return base64Data
    }
    
    func createChallenge(serverURL: URL, userId: String) async throws -> AuthChallenge {
        let url = serverURL.appendingPathComponent("api/auth/challenge")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        
        let body = ["userId": userId]
        request.httpBody = try encoder.encode(body)
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        
        return try decoder.decode(AuthChallenge.self, from: data)
    }
    
    func verifyToken(serverURL: URL) async throws -> Bool {
        let url = serverURL.appendingPathComponent("api/auth/verify")
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        
        guard let authHeader = getAuthHeader() else {
            return false
        }
        request.setValue(authHeader, forHTTPHeaderField: "Authorization")
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            return false
        }
        
        let result = try decoder.decode([String: Bool].self, from: data)
        return result["valid"] ?? false
    }
    
    func login(serverURL: URL, method: AuthMethod, credentials: String) async throws {
        switch method {
        case .password:
            try await loginWithPassword(serverURL: serverURL, userId: currentUser?.username ?? "", password: credentials)
        case .sshKey:
            // SSH key login would need the key data and signing logic
            // For now, throw an error as this needs more implementation
            throw APIError.authenticationFailed
        case .none:
            // No-auth mode
            self.isAuthenticated = true
        }
    }
    
    func loginWithPassword(serverURL: URL, userId: String, password: String) async throws {
        let url = serverURL.appendingPathComponent("api/auth/password")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        
        let body = ["userId": userId, "password": password]
        request.httpBody = try encoder.encode(body)
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.authenticationFailed
        }
        
        struct PasswordAuthResponse: Codable {
            let success: Bool
            let token: String?
            let userId: String?
            let authMethod: String?
            let error: String?
        }
        
        let authResult = try decoder.decode(PasswordAuthResponse.self, from: data)
        
        guard authResult.success,
              let token = authResult.token,
              let userId = authResult.userId else {
            throw APIError.authenticationFailed
        }
        
        // Create user object
        self.authToken = token
        self.currentUser = User(
            username: userId,
            avatarUrl: nil,
            createdAt: Date()
        )
        self.isAuthenticated = true
        
        // Save to keychain
        saveAuthToKeychain()
    }
    
    func logout() {
        // Call server logout endpoint
        Task {
            if let serverURL = ConnectionManager.shared.serverURL,
               let authHeader = getAuthHeader() {
                let url = serverURL.appendingPathComponent("api/auth/logout")
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue(authHeader, forHTTPHeaderField: "Authorization")
                
                _ = try? await session.data(for: request)
            }
        }
        
        authToken = nil
        currentUser = nil
        isAuthenticated = false
        clearKeychain()
    }
    
    func getAuthHeader() -> String? {
        guard let token = authToken else { return nil }
        return "Bearer \(token)"
    }
    
    // SSH Key Management
    func fetchSSHKeys() async throws -> [SSHKey] {
        guard let serverURL = ConnectionManager.shared.serverURL else {
            throw APIError.notConnected
        }
        
        let url = serverURL.appendingPathComponent("api/auth/ssh-keys")
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        
        if let authHeader = getAuthHeader() {
            request.setValue(authHeader, forHTTPHeaderField: "Authorization")
        }
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        
        return try decoder.decode([SSHKey].self, from: data)
    }
    
    func addSSHKey(privateKey: String, passphrase: String?, saveToKeychain: Bool) async throws -> SSHKey {
        guard let serverURL = ConnectionManager.shared.serverURL else {
            throw APIError.notConnected
        }
        
        let url = serverURL.appendingPathComponent("api/auth/ssh-keys")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        
        if let authHeader = getAuthHeader() {
            request.setValue(authHeader, forHTTPHeaderField: "Authorization")
        }
        
        let body: [String: Any] = [
            "privateKey": privateKey,
            "passphrase": passphrase ?? "",
            "saveToKeychain": saveToKeychain
        ]
        
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 || httpResponse.statusCode == 201 else {
            throw APIError.invalidResponse
        }
        
        return try decoder.decode(SSHKey.self, from: data)
    }
    
    func removeSSHKey(id: String) async throws {
        guard let serverURL = ConnectionManager.shared.serverURL else {
            throw APIError.notConnected
        }
        
        let url = serverURL.appendingPathComponent("api/auth/ssh-keys/\(id)")
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        
        if let authHeader = getAuthHeader() {
            request.setValue(authHeader, forHTTPHeaderField: "Authorization")
        }
        
        let (_, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 || httpResponse.statusCode == 204 else {
            throw APIError.invalidResponse
        }
    }
    
    // MARK: - Keychain Management
    
    private func saveAuthToKeychain() {
        guard let token = authToken else { return }
        
        // Save token
        let tokenData = token.data(using: .utf8)!
        let tokenQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: tokenKey,
            kSecValueData as String: tokenData
        ]
        
        SecItemDelete(tokenQuery as CFDictionary)
        SecItemAdd(tokenQuery as CFDictionary, nil)
        
        // Save user
        if let user = currentUser,
           let userData = try? encoder.encode(user) {
            let userQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: serviceName,
                kSecAttrAccount as String: userKey,
                kSecValueData as String: userData
            ]
            
            SecItemDelete(userQuery as CFDictionary)
            SecItemAdd(userQuery as CFDictionary, nil)
        }
    }
    
    private func loadSavedAuth() {
        // Load token
        let tokenQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: tokenKey,
            kSecReturnData as String: true
        ]
        
        var result: AnyObject?
        if SecItemCopyMatching(tokenQuery as CFDictionary, &result) == errSecSuccess,
           let data = result as? Data,
           let token = String(data: data, encoding: .utf8) {
            self.authToken = token
            self.isAuthenticated = true
        }
        
        // Load user
        let userQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: userKey,
            kSecReturnData as String: true
        ]
        
        if SecItemCopyMatching(userQuery as CFDictionary, &result) == errSecSuccess,
           let data = result as? Data,
           let user = try? decoder.decode(User.self, from: data) {
            self.currentUser = user
        }
    }
    
    private func clearKeychain() {
        let tokenQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: tokenKey
        ]
        SecItemDelete(tokenQuery as CFDictionary)
        
        let userQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: userKey
        ]
        SecItemDelete(userQuery as CFDictionary)
    }
}