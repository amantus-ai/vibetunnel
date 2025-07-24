import Foundation
import os
import ServiceManagement

/// Protocol defining the interface for managing launch at login functionality.
@MainActor
public protocol StartupControlling: Sendable {
    func setLaunchAtLogin(enabled: Bool)
    var isLaunchAtLoginEnabled: Bool { get }
}

/// Default implementation of startup management using ServiceManagement framework.
///
/// This struct handles:
/// - Enabling/disabling launch at login
/// - Checking current launch at login status
/// - Integration with macOS ServiceManagement APIs
@MainActor
public struct StartupManager: StartupControlling {
    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "startup")

    public init() {}

    public func setLaunchAtLogin(enabled: Bool) {
        do {
            if enabled {
                try SMAppService.mainApp.register()
                logger.info("Successfully registered for launch at login.")
            } else {
                try SMAppService.mainApp.unregister()
                logger.info("Successfully unregistered for launch at login.")
            }
        } catch {
            logger
                .error(
                    "Failed to \(enabled ? "register" : "unregister") for launch at login: \(error.localizedDescription)"
                )
        }
    }

    public var isLaunchAtLoginEnabled: Bool {
        SMAppService.mainApp.status == .enabled
    }
}
