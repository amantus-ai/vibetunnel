import SwiftUI

// MARK: - Environment Keys

private struct ServerManagerKey: EnvironmentKey {
    static let defaultValue: ServerManager? = nil
}

private struct NgrokServiceKey: EnvironmentKey {
    static let defaultValue: NgrokService? = nil
}

private struct SystemPermissionManagerKey: EnvironmentKey {
    static let defaultValue: SystemPermissionManager? = nil
}

private struct TerminalLauncherKey: EnvironmentKey {
    static let defaultValue: TerminalLauncher? = nil
}

// MARK: - Environment Values Extensions

extension EnvironmentValues {
    var serverManager: ServerManager? {
        get { self[ServerManagerKey.self] }
        set { self[ServerManagerKey.self] = newValue }
    }

    var ngrokService: NgrokService? {
        get { self[NgrokServiceKey.self] }
        set { self[NgrokServiceKey.self] = newValue }
    }

    var systemPermissionManager: SystemPermissionManager? {
        get { self[SystemPermissionManagerKey.self] }
        set { self[SystemPermissionManagerKey.self] = newValue }
    }

    var terminalLauncher: TerminalLauncher? {
        get { self[TerminalLauncherKey.self] }
        set { self[TerminalLauncherKey.self] = newValue }
    }
}

// MARK: - View Extensions

extension View {
    /// Injects all VibeTunnel services into the environment
    @MainActor
    func withVibeTunnelServices(
        serverManager: ServerManager? = nil,
        ngrokService: NgrokService? = nil,
        systemPermissionManager: SystemPermissionManager? = nil,
        terminalLauncher: TerminalLauncher? = nil
    )
        -> some View
    {
        self
            .environment(\.serverManager, serverManager ?? ServerManager.shared)
            .environment(\.ngrokService, ngrokService ?? NgrokService.shared)
            .environment(
                \.systemPermissionManager,
                systemPermissionManager ?? SystemPermissionManager.shared
            )
            .environment(\.terminalLauncher, terminalLauncher ?? TerminalLauncher.shared)
    }
}
