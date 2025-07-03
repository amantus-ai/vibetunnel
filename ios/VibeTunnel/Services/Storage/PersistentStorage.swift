import Foundation

/// Protocol for persistent storage operations used by ConnectionManager
protocol PersistentStorage {
    func data(forKey key: String) -> Data?
    func set(_ value: Any?, forKey key: String)
    func bool(forKey key: String) -> Bool
    func object(forKey key: String) -> Any?
    func removeObject(forKey key: String)
}

/// UserDefaults implementation of PersistentStorage
final class UserDefaultsStorage: PersistentStorage {
    private let userDefaults: UserDefaults
    
    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
    }
    
    func data(forKey key: String) -> Data? {
        userDefaults.data(forKey: key)
    }
    
    func set(_ value: Any?, forKey key: String) {
        userDefaults.set(value, forKey: key)
    }
    
    func bool(forKey key: String) -> Bool {
        userDefaults.bool(forKey: key)
    }
    
    func object(forKey key: String) -> Any? {
        userDefaults.object(forKey: key)
    }
    
    func removeObject(forKey key: String) {
        userDefaults.removeObject(forKey: key)
    }
}

/// In-memory mock implementation for testing
final class MockStorage: PersistentStorage {
    private var storage: [String: Any] = [:]
    
    func data(forKey key: String) -> Data? {
        storage[key] as? Data
    }
    
    func set(_ value: Any?, forKey key: String) {
        if let value = value {
            storage[key] = value
        } else {
            storage.removeValue(forKey: key)
        }
    }
    
    func bool(forKey key: String) -> Bool {
        storage[key] as? Bool ?? false
    }
    
    func object(forKey key: String) -> Any? {
        storage[key]
    }
    
    func removeObject(forKey key: String) {
        storage.removeValue(forKey: key)
    }
    
    /// Reset all stored data for test isolation
    func reset() {
        storage.removeAll()
    }
    
    /// Test helper to inspect stored keys
    var allKeys: Set<String> {
        Set(storage.keys)
    }
    
    /// Test helper to check if key exists
    func hasValue(forKey key: String) -> Bool {
        storage[key] != nil
    }
}
