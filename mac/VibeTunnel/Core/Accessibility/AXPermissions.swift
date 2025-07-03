import ApplicationServices
import AppKit
import Foundation
import OSLog

/// Utilities for managing macOS accessibility permissions.
/// Provides convenient methods for checking and requesting accessibility permissions.
public enum AXPermissions {
    private static let logger = Logger(
        subsystem: "sh.vibetunnel.vibetunnel",
        category: "AXPermissions"
    )
    
    /// Checks if the app currently has accessibility permissions without prompting.
    public static var hasPermissions: Bool {
        AXIsProcessTrusted()
    }
    
    /// Requests accessibility permissions, showing the system prompt if needed.
    /// - Returns: `true` if permissions are granted, `false` otherwise
    @MainActor
    public static func requestPermissions() -> Bool {
        // Skip permission dialog in test environment
        if isTestEnvironment {
            logger.debug("Skipping permission request in test environment")
            return false
        }
        
        // Use direct API without options to avoid concurrency issues
        let trusted = AXIsProcessTrusted()
        if !trusted {
            // Open accessibility preferences to prompt user
            openAccessibilityPreferences()
        }
        
        logger.info("Accessibility permissions checked, trusted: \(trusted)")
        return trusted
    }
    
    /// Determines if the app is running in a test environment
    private static var isTestEnvironment: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil ||
        ProcessInfo.processInfo.arguments.contains("--test-mode") ||
        NSClassFromString("XCTest") != nil
    }
    
    /// Determines if the app is running in a sandboxed environment
    public static var isSandboxed: Bool {
        ProcessInfo.processInfo.environment["APP_SANDBOX_CONTAINER_ID"] != nil
    }
    
    /// Opens System Preferences to the Security & Privacy > Accessibility pane
    @MainActor
    public static func openAccessibilityPreferences() {
        logger.info("Opening Accessibility preferences")
        
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }
    
    /// Monitors accessibility permission changes asynchronously
    /// - Parameter interval: The polling interval in seconds (default: 1.0)
    /// - Returns: An AsyncStream that emits permission status changes
    public static func permissionChanges(interval: TimeInterval = 1.0) -> AsyncStream<Bool> {
        AsyncStream { continuation in
            let initialState = hasPermissions
            continuation.yield(initialState)
            
            // Timer holder to avoid capture issues
            final class TimerHolder: @unchecked Sendable {
                var timer: Timer?
                var lastState: Bool
                
                init(initialState: Bool) {
                    self.lastState = initialState
                }
                
                deinit {
                    timer?.invalidate()
                }
            }
            
            let holder = TimerHolder(initialState: initialState)
            
            holder.timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { _ in
                let currentState = hasPermissions
                if currentState != holder.lastState {
                    holder.lastState = currentState
                    continuation.yield(currentState)
                    logger.info("Accessibility permission changed to: \(currentState)")
                }
            }
            
            continuation.onTermination = { @Sendable _ in
                DispatchQueue.main.async {
                    holder.timer?.invalidate()
                    holder.timer = nil
                }
            }
        }
    }
    
    /// Requests permissions asynchronously
    /// - Returns: `true` if permissions are granted, `false` otherwise
    @MainActor
    public static func requestPermissionsAsync() async -> Bool {
        return requestPermissions()
    }
}

// MARK: - Convenience Extensions

public extension AXPermissions {
    /// Ensures accessibility permissions are granted, prompting if necessary
    /// - Parameter onDenied: Closure to execute if permissions are denied
    /// - Returns: `true` if permissions are granted, `false` otherwise
    @MainActor
    static func ensurePermissions(onDenied: (() -> Void)? = nil) -> Bool {
        if hasPermissions {
            return true
        }
        
        let granted = requestPermissions()
        if !granted {
            logger.warning("Accessibility permissions denied")
            onDenied?()
        }
        
        return granted
    }
    
    /// Checks permissions and shows an alert if not granted
    @MainActor
    static func checkPermissionsWithAlert() -> Bool {
        if hasPermissions {
            return true
        }
        
        let alert = NSAlert()
        alert.messageText = "Accessibility Permission Required"
        alert.informativeText = "VibeTunnel needs accessibility permissions to interact with terminal windows. Please grant access in System Preferences."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Open System Preferences")
        alert.addButton(withTitle: "Cancel")
        
        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            openAccessibilityPreferences()
        }
        
        return false
    }
}