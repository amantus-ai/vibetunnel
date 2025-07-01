import Foundation
import os.log

/// Service responsible for migrating preferences and cleaning up old com.amantus files
final class PreferenceMigrationService {
    private let logger = Logger(subsystem: "sh.vibetunnel", category: "PreferenceMigration")
    
    private let oldBundleIdentifier = "com.amantus.vibetunnel"
    private let currentBundleIdentifier = Bundle.main.bundleIdentifier ?? "sh.vibetunnel.vibetunnel"
    
    /// Performs one-time migration from old bundle identifier to new one
    func performMigrationIfNeeded() {
        // Check if migration has already been performed
        let migrationKey = "hasPerformedComAmantusMigration"
        guard !UserDefaults.standard.bool(forKey: migrationKey) else {
            logger.debug("Migration already performed, skipping")
            return
        }
        
        logger.info("Starting preference migration from \(self.oldBundleIdentifier) to \(self.currentBundleIdentifier)")
        
        // Migrate preferences
        migratePreferences()
        
        // Clean up old files
        cleanupOldFiles()
        
        // Mark migration as complete
        UserDefaults.standard.set(true, forKey: migrationKey)
        logger.info("Migration completed successfully")
    }
    
    private func migratePreferences() {
        // Get old preferences
        guard let oldDefaults = UserDefaults(suiteName: oldBundleIdentifier) else {
            logger.debug("No old preferences found to migrate")
            return
        }
        
        let currentDefaults = UserDefaults.standard
        var migratedCount = 0
        
        // Get all keys from old preferences
        if let oldPrefs = oldDefaults.dictionaryRepresentation() as? [String: Any] {
            for (key, value) in oldPrefs {
                // Skip system keys
                if key.hasPrefix("NS") || key.hasPrefix("Apple") {
                    continue
                }
                
                // Only migrate if the key doesn't already exist in new preferences
                if currentDefaults.object(forKey: key) == nil {
                    currentDefaults.set(value, forKey: key)
                    migratedCount += 1
                    logger.debug("Migrated preference: \(key)")
                }
            }
        }
        
        if migratedCount > 0 {
            currentDefaults.synchronize()
            logger.info("Migrated \(migratedCount) preferences")
        } else {
            logger.debug("No preferences needed migration")
        }
    }
    
    private func cleanupOldFiles() {
        let fileManager = FileManager.default
        let libraryURL = fileManager.urls(for: .libraryDirectory, in: .userDomainMask).first!
        
        // Define paths to clean up
        let pathsToClean = [
            libraryURL.appendingPathComponent("Preferences/\(oldBundleIdentifier).plist"),
            libraryURL.appendingPathComponent("Caches/\(oldBundleIdentifier)"),
            libraryURL.appendingPathComponent("Saved Application State/\(oldBundleIdentifier).savedState"),
            libraryURL.appendingPathComponent("Application Support/\(oldBundleIdentifier)")
        ]
        
        for path in pathsToClean {
            if fileManager.fileExists(atPath: path.path) {
                do {
                    try fileManager.removeItem(at: path)
                    logger.info("Removed old file/directory: \(path.lastPathComponent)")
                } catch {
                    logger.error("Failed to remove \(path.path): \(error.localizedDescription)")
                }
            }
        }
    }
}