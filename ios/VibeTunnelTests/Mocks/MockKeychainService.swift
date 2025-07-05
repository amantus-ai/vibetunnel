import Foundation
@testable import VibeTunnel

/// Mock implementation of KeychainServiceProtocol for testing
/// Provides in-memory storage with test isolation features
class MockKeychainService: KeychainServiceProtocol {
    // MARK: - Storage

    /// In-memory storage for passwords keyed by account identifier
    private static let storageQueue = DispatchQueue(label: "MockKeychainService.storage")
    private nonisolated(unsafe) static var _storage: [String: String] = [:]
    private nonisolated(unsafe) static var _testIdentifier: String = ""

    private static var storage: [String: String] {
        get {
            storageQueue.sync { _storage }
        }
        set {
            storageQueue.sync { _storage = newValue }
        }
    }

    /// Test identifier for isolation between test cases
    private static var testIdentifier: String {
        get {
            storageQueue.sync { _testIdentifier }
        }
        set {
            storageQueue.sync { _testIdentifier = newValue }
        }
    }

    // MARK: - Test Isolation

    /// Set a unique test identifier to isolate storage between tests
    /// - Parameter identifier: Unique identifier for the test
    static func setTestIdentifier(_ identifier: String) {
        testIdentifier = identifier
    }

    /// Reset all stored data and test identifier
    static func reset() {
        storageQueue.sync {
            _storage.removeAll()
            _testIdentifier = ""
        }
    }

    /// Get the current number of stored items (for testing)
    static var storedItemCount: Int {
        storageQueue.sync { _storage.count }
    }

    /// Get all stored keys (for debugging)
    static var allStoredKeys: [String] {
        storageQueue.sync { Array(_storage.keys) }
    }

    // MARK: - Private Helpers

    /// Generate a storage key with test isolation
    private static func storageKey(for account: String) -> String {
        testIdentifier.isEmpty ? account : "\(testIdentifier):\(account)"
    }

    // MARK: - Server Profile Password Management

    /// Save a password for a server profile
    /// - Parameters:
    ///   - password: The password to store securely
    ///   - profileId: Unique identifier for the server profile
    /// - Throws: KeychainError if the operation fails
    func savePassword(_ password: String, for profileId: UUID) throws {
        try Self.savePassword(password, for: profileId)
    }

    /// Retrieve a password for a server profile
    /// - Parameter profileId: Unique identifier for the server profile
    /// - Returns: The stored password
    /// - Throws: KeychainError if the password is not found or operation fails
    func getPassword(for profileId: UUID) throws -> String {
        try Self.getPassword(for: profileId)
    }

    /// Delete a password for a server profile
    /// - Parameter profileId: Unique identifier for the server profile
    /// - Throws: KeychainError if the operation fails
    func deletePassword(for profileId: UUID) throws {
        try Self.deletePassword(for: profileId)
    }

    /// Delete all passwords for the app
    /// - Throws: KeychainError if the operation fails
    func deleteAllPasswords() throws {
        try Self.deleteAllPasswords()
    }

    // MARK: - Generic Key-Value Storage

    /// Save a password/token with a generic key
    /// - Parameters:
    ///   - password: The password/token to store securely
    ///   - key: The key to associate with the stored value
    /// - Throws: KeychainError if the operation fails
    func savePassword(_ password: String, for key: String) throws {
        try Self.savePassword(password, for: key)
    }

    /// Load a password/token with a generic key
    /// - Parameter key: The key associated with the stored value
    /// - Returns: The stored password/token
    /// - Throws: KeychainError if the value is not found or operation fails
    func loadPassword(for key: String) throws -> String {
        try Self.loadPassword(for: key)
    }

    /// Delete a password/token with a generic key
    /// - Parameter key: The key associated with the stored value
    /// - Throws: KeychainError if the operation fails
    func deletePassword(for key: String) throws {
        try Self.deletePassword(for: key)
    }

    // MARK: - Static Methods (Test Infrastructure)

    /// Save a password for a server profile (static version for tests)
    static func savePassword(_ password: String, for profileId: UUID) throws {
        let account = "server-\(profileId.uuidString)"
        let key = storageKey(for: account)
        storageQueue.sync {
            _storage[key] = password
        }
    }

    /// Retrieve a password for a server profile (static version for tests)
    static func getPassword(for profileId: UUID) throws -> String {
        let account = "server-\(profileId.uuidString)"
        let key = storageKey(for: account)

        return try storageQueue.sync {
            guard let password = _storage[key] else {
                throw KeychainService.KeychainError.itemNotFound
            }
            return password
        }
    }

    /// Delete a password for a server profile (static version for tests)
    static func deletePassword(for profileId: UUID) throws {
        let account = "server-\(profileId.uuidString)"
        let key = storageKey(for: account)
        _ = storageQueue.sync {
            _storage.removeValue(forKey: key)
        }
    }

    /// Delete all passwords for the app (static version for tests)
    static func deleteAllPasswords() throws {
        storageQueue.sync {
            let currentTestIdentifier = _testIdentifier
            if currentTestIdentifier.isEmpty {
                // If no test identifier, clear all
                _storage.removeAll()
            } else {
                // Only clear items for this test identifier
                let prefix = "\(currentTestIdentifier):"
                let keysToRemove = _storage.keys.filter { $0.hasPrefix(prefix) }
                for key in keysToRemove {
                    _storage.removeValue(forKey: key)
                }
            }
        }
    }

    /// Save a password/token with a generic key (static version for tests)
    static func savePassword(_ password: String, for key: String) throws {
        let storageKey = storageKey(for: key)
        storageQueue.sync {
            _storage[storageKey] = password
        }
    }

    /// Load a password/token with a generic key (static version for tests)
    static func loadPassword(for key: String) throws -> String {
        let storageKey = storageKey(for: key)

        return try storageQueue.sync {
            guard let password = _storage[storageKey] else {
                throw KeychainService.KeychainError.itemNotFound
            }
            return password
        }
    }

    /// Delete a password/token with a generic key (static version for tests)
    static func deletePassword(for key: String) throws {
        let storageKey = storageKey(for: key)
        _ = storageQueue.sync {
            _storage.removeValue(forKey: storageKey)
        }
    }
}

// MARK: - Test Helpers

extension MockKeychainService {
    /// Check if a password exists for a given profile ID (static version for tests)
    static func hasPassword(for profileId: UUID) -> Bool {
        let account = "server-\(profileId.uuidString)"
        let key = storageKey(for: account)
        return storageQueue.sync { _storage[key] != nil }
    }

    /// Check if a password exists for a given key (static version for tests)
    static func hasPassword(for key: String) -> Bool {
        let storageKey = storageKey(for: key)
        return storageQueue.sync { _storage[storageKey] != nil }
    }

    /// Get all stored profile IDs (for testing) (static version for tests)
    static var allProfileIds: [UUID] {
        storageQueue.sync {
            let prefix = _testIdentifier.isEmpty ? "server-" : "\(_testIdentifier):server-"
            return _storage.keys.compactMap { key in
                guard key.hasPrefix(prefix) else { return nil }
                let uuidString = String(key.dropFirst(prefix.count))
                return UUID(uuidString: uuidString)
            }
        }
    }

    /// Simulate a keychain error for testing error handling (static version for tests)
    static func simulateError(_ shouldThrow: Bool = true) {
        // This could be extended to simulate specific errors
        // For now, we'll use a simple flag approach
        if shouldThrow {
            // Clear storage to simulate keychain unavailability
            storageQueue.sync {
                _storage.removeAll()
            }
        }
    }
}

// MARK: - Factory for Mock KeychainService

extension MockKeychainService {
    /// Factory method to create a mock keychain service instance
    /// This is the primary way to get a mock keychain service for injection
    static func create() -> KeychainServiceProtocol {
        MockKeychainService()
    }

    /// Factory method to create a mock keychain service instance with test identifier
    /// This allows for test isolation
    static func create(testIdentifier: String) -> KeychainServiceProtocol {
        MockKeychainService.setTestIdentifier(testIdentifier)
        return MockKeychainService()
    }
}
