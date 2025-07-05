import Foundation

/// Protocol defining the interface for keychain operations.
/// Provides secure storage for passwords, tokens, and other sensitive data.
protocol KeychainServiceProtocol {
    // MARK: - Server Profile Password Management

    /// Save a password for a server profile
    /// - Parameters:
    ///   - password: The password to store securely
    ///   - profileId: Unique identifier for the server profile
    /// - Throws: KeychainError if the operation fails
    func savePassword(_ password: String, for profileId: UUID) throws

    /// Retrieve a password for a server profile
    /// - Parameter profileId: Unique identifier for the server profile
    /// - Returns: The stored password
    /// - Throws: KeychainError if the password is not found or operation fails
    func getPassword(for profileId: UUID) throws -> String

    /// Delete a password for a server profile
    /// - Parameter profileId: Unique identifier for the server profile
    /// - Throws: KeychainError if the operation fails
    func deletePassword(for profileId: UUID) throws

    /// Delete all passwords for the app
    /// - Throws: KeychainError if the operation fails
    func deleteAllPasswords() throws

    // MARK: - Generic Key-Value Storage

    /// Save a password/token with a generic key
    /// - Parameters:
    ///   - password: The password/token to store securely
    ///   - key: The key to associate with the stored value
    /// - Throws: KeychainError if the operation fails
    func savePassword(_ password: String, for key: String) throws

    /// Load a password/token with a generic key
    /// - Parameter key: The key associated with the stored value
    /// - Returns: The stored password/token
    /// - Throws: KeychainError if the value is not found or operation fails
    func loadPassword(for key: String) throws -> String

    /// Delete a password/token with a generic key
    /// - Parameter key: The key associated with the stored value
    /// - Throws: KeychainError if the operation fails
    func deletePassword(for key: String) throws
}
