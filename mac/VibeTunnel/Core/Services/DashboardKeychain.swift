import Foundation
import os
import Security

/// Service for managing dashboard password in keychain.
///
/// Provides secure storage and retrieval of the dashboard authentication
/// password using the macOS Keychain. Handles password generation,
/// updates, and deletion with proper error handling and logging.
@MainActor
final class DashboardKeychain {
    static let shared = DashboardKeychain()

    private let service = KeychainConstants.vibeTunnelService
    private let account = KeychainConstants.dashboardPassword
    private let logger = Logger(subsystem: BundleIdentifiers.main, category: "DashboardKeychain")

    private init() {}

    /// Get the dashboard password from keychain
    func getPassword() -> String? {
        #if DEBUG
            // In debug builds, skip keychain access to avoid authorization dialogs
            logger
                .info(
                    "Debug mode: Skipping keychain password retrieval. Password will only persist during current app session."
                )
            return nil
        #else
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
                kSecReturnData as String: true
            ]

            var result: AnyObject?
            let status = SecItemCopyMatching(query as CFDictionary, &result)

            guard status == errSecSuccess,
                  let data = result as? Data,
                  let password = String(data: data, encoding: .utf8)
            else {
                logger.debug("No password found in keychain")
                return nil
            }

            logger.debug("Password retrieved from keychain")
            return password
        #endif
    }

    /// Check if a password exists without retrieving it (won't trigger keychain prompt)
    func hasPassword() -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnAttributes as String: false,
            kSecReturnData as String: false
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        return status == errSecSuccess
    }

    /// Set the dashboard password in keychain
    func setPassword(_ password: String) -> Bool {
        guard !password.isEmpty else {
            logger.warning("Attempted to set empty password")
            return false
        }

        guard let data = password.data(using: .utf8) else {
            logger.warning("Failed to convert password to UTF-8 data")
            return false
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked
        ]

        // Try to update first
        var status = SecItemUpdate(
            query as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )

        if status == errSecItemNotFound {
            // Item doesn't exist, create it
            var addQuery = query
            addQuery[kSecValueData as String] = data
            status = SecItemAdd(addQuery as CFDictionary, nil)
        }

        let success = status == errSecSuccess
        logger.info("Password \(success ? "saved to" : "failed to save to") keychain")

        #if DEBUG
            if success {
                logger
                    .info(
                        "Debug mode: Password saved to keychain but will not persist across app restarts. The password will only be available during this session to avoid keychain authorization dialogs during development."
                    )
            }
        #endif

        return success
    }

    /// Delete the dashboard password from keychain
    func deletePassword() -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]

        let status = SecItemDelete(query as CFDictionary)
        let success = status == errSecSuccess || status == errSecItemNotFound
        logger.info("Password \(success ? "deleted from" : "failed to delete from") keychain")
        return success
    }
}
