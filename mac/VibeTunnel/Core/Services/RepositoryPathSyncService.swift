import Foundation
import OSLog
import Combine

/// Service that synchronizes repository base path changes to the server via Unix socket
@MainActor
final class RepositoryPathSyncService {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "RepositoryPathSync")
    
    // MARK: - Properties
    
    private var cancellables = Set<AnyCancellable>()
    private var lastSentPath: String?
    
    // MARK: - Initialization
    
    init() {
        logger.info("🚀 RepositoryPathSyncService initialized")
        setupObserver()
    }
    
    // MARK: - Private Methods
    
    private func setupObserver() {
        // Monitor UserDefaults changes for repository base path
        UserDefaults.standard.publisher(for: \.repositoryBasePath)
            .removeDuplicates()
            .dropFirst() // Skip initial value on startup
            .sink { [weak self] newPath in
                Task { @MainActor [weak self] in
                    await self?.handlePathChange(newPath)
                }
            }
            .store(in: &cancellables)
        
        logger.info("✅ Repository path observer configured")
    }
    
    private func handlePathChange(_ newPath: String?) async {
        let path = newPath ?? AppConstants.Defaults.repositoryBasePath
        
        // Skip if we've already sent this path
        guard path != lastSentPath else {
            logger.debug("Skipping duplicate path update: \(path)")
            return
        }
        
        logger.info("📁 Repository base path changed to: \(path)")
        
        // Get the shared Unix socket connection
        let socketManager = SharedUnixSocketManager.shared
        let connection = socketManager.getConnection()
        
        // Ensure we're connected
        guard connection.isConnected else {
            logger.warning("⚠️ Unix socket not connected, cannot send path update")
            return
        }
        
        // Create the repository path update message
        let message = ControlProtocol.repositoryPathUpdateRequest(path: path)
        
        do {
            // Send the message
            try await connection.send(message)
            lastSentPath = path
            logger.info("✅ Successfully sent repository path update to server")
        } catch {
            logger.error("❌ Failed to send repository path update: \(error)")
        }
    }
    
    /// Manually trigger a path sync (useful after initial connection)
    func syncCurrentPath() async {
        let path = AppConstants.stringValue(for: AppConstants.UserDefaultsKeys.repositoryBasePath)
        
        logger.info("🔄 Manually syncing repository path: \(path)")
        
        // Get the shared Unix socket connection
        let socketManager = SharedUnixSocketManager.shared
        let connection = socketManager.getConnection()
        
        // Ensure we're connected
        guard connection.isConnected else {
            logger.warning("⚠️ Unix socket not connected, cannot sync path")
            return
        }
        
        // Create the repository path update message
        let message = ControlProtocol.repositoryPathUpdateRequest(path: path)
        
        do {
            // Send the message
            try await connection.send(message)
            lastSentPath = path
            logger.info("✅ Successfully synced repository path to server")
        } catch {
            logger.error("❌ Failed to sync repository path: \(error)")
        }
    }
}

// MARK: - UserDefaults Extension

private extension UserDefaults {
    @objc dynamic var repositoryBasePath: String {
        get { string(forKey: AppConstants.UserDefaultsKeys.repositoryBasePath) ?? AppConstants.Defaults.repositoryBasePath }
        set { set(newValue, forKey: AppConstants.UserDefaultsKeys.repositoryBasePath) }
    }
}