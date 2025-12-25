import Foundation

/// Protocol for persistent storage operations used by ConnectionManager.
/// Provides abstraction over storage implementation for testability.
protocol PersistentStorage {
    func data(forKey key: String) -> Data?
    func set(_ value: Any?, forKey key: String)
    func bool(forKey key: String) -> Bool
    func object(forKey key: String) -> Any?
    func removeObject(forKey key: String)
}

/// UserDefaults implementation of PersistentStorage.
/// Stores connection data and preferences in standard UserDefaults.
final class UserDefaultsStorage: PersistentStorage {
    private let userDefaults: UserDefaults

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
    }

    func data(forKey key: String) -> Data? {
        self.userDefaults.data(forKey: key)
    }

    func set(_ value: Any?, forKey key: String) {
        self.userDefaults.set(value, forKey: key)
    }

    func bool(forKey key: String) -> Bool {
        self.userDefaults.bool(forKey: key)
    }

    func object(forKey key: String) -> Any? {
        self.userDefaults.object(forKey: key)
    }

    func removeObject(forKey key: String) {
        self.userDefaults.removeObject(forKey: key)
    }
}

/// In-memory mock implementation for testing.
/// Provides isolated storage for unit tests without persisting data.
final class MockStorage: PersistentStorage {
    private var storage: [String: Any] = [:]

    func data(forKey key: String) -> Data? {
        self.storage[key] as? Data
    }

    func set(_ value: Any?, forKey key: String) {
        if let value {
            self.storage[key] = value
        } else {
            self.storage.removeValue(forKey: key)
        }
    }

    func bool(forKey key: String) -> Bool {
        self.storage[key] as? Bool ?? false
    }

    func object(forKey key: String) -> Any? {
        self.storage[key]
    }

    func removeObject(forKey key: String) {
        self.storage.removeValue(forKey: key)
    }

    /// Reset all stored data for test isolation
    func reset() {
        self.storage.removeAll()
    }

    /// Test helper to inspect stored keys
    var allKeys: Set<String> {
        Set(self.storage.keys)
    }

    /// Test helper to check if key exists
    func hasValue(forKey key: String) -> Bool {
        self.storage[key] != nil
    }
}
