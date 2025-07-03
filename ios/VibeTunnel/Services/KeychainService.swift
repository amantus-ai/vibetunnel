import Foundation
import Security

/// Service for securely storing credentials in the iOS Keychain
class KeychainService: KeychainServiceProtocol {
    private let serviceName = "com.vibetunnel.ios"

    enum KeychainError: Error {
        case unexpectedData
        case unexpectedPasswordData
        case unhandledError(status: OSStatus)
        case itemNotFound
    }

    /// Save a password for a server profile
    func savePassword(_ password: String, for profileId: UUID) throws {
        let account = "server-\(profileId.uuidString)"
        guard let passwordData = password.data(using: .utf8) else {
            throw KeychainError.unexpectedPasswordData
        }

        // Check if password already exists
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: account
        ]

        let status = SecItemCopyMatching(query as CFDictionary, nil)

        if status == errSecItemNotFound {
            // Add new password
            let attributes: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: serviceName,
                kSecAttrAccount as String: account,
                kSecValueData as String: passwordData,
                kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            ]

            let addStatus = SecItemAdd(attributes as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw KeychainError.unhandledError(status: addStatus)
            }
        } else if status == errSecSuccess {
            // Update existing password
            let attributes: [String: Any] = [
                kSecValueData as String: passwordData
            ]

            let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
            guard updateStatus == errSecSuccess else {
                throw KeychainError.unhandledError(status: updateStatus)
            }
        } else {
            throw KeychainError.unhandledError(status: status)
        }
    }

    /// Retrieve a password for a server profile
    func getPassword(for profileId: UUID) throws -> String {
        let account = "server-\(profileId.uuidString)"

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: account,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess else {
            if status == errSecItemNotFound {
                throw KeychainError.itemNotFound
            }
            throw KeychainError.unhandledError(status: status)
        }

        guard let data = result as? Data,
              let password = String(data: data, encoding: .utf8)
        else {
            throw KeychainError.unexpectedData
        }

        return password
    }

    /// Delete a password for a server profile
    func deletePassword(for profileId: UUID) throws {
        let account = "server-\(profileId.uuidString)"

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: account
        ]

        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unhandledError(status: status)
        }
    }

    /// Delete all passwords for the app
    func deleteAllPasswords() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName
        ]

        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unhandledError(status: status)
        }
    }

    // MARK: - Generic Key-Value Storage

    /// Save a password/token with a generic key
    func savePassword(_ password: String, for key: String) throws {
        guard let passwordData = password.data(using: .utf8) else {
            throw KeychainError.unexpectedPasswordData
        }

        // Check if password already exists
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key
        ]

        let status = SecItemCopyMatching(query as CFDictionary, nil)

        if status == errSecItemNotFound {
            // Add new password
            let attributes: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: serviceName,
                kSecAttrAccount as String: key,
                kSecValueData as String: passwordData,
                kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            ]

            let addStatus = SecItemAdd(attributes as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw KeychainError.unhandledError(status: addStatus)
            }
        } else if status == errSecSuccess {
            // Update existing password
            let attributes: [String: Any] = [
                kSecValueData as String: passwordData
            ]

            let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
            guard updateStatus == errSecSuccess else {
                throw KeychainError.unhandledError(status: updateStatus)
            }
        } else {
            throw KeychainError.unhandledError(status: status)
        }
    }

    /// Load a password/token with a generic key
    func loadPassword(for key: String) throws -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess else {
            if status == errSecItemNotFound {
                throw KeychainError.itemNotFound
            }
            throw KeychainError.unhandledError(status: status)
        }

        guard let data = result as? Data,
              let password = String(data: data, encoding: .utf8)
        else {
            throw KeychainError.unexpectedData
        }

        return password
    }

    /// Delete a password/token with a generic key
    func deletePassword(for key: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key
        ]

        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unhandledError(status: status)
        }
    }
}

