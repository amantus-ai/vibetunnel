import SwiftUI

// MARK: - Environment Values Extensions

extension EnvironmentValues {
    @Entry var serverManager: ServerManager?

    @Entry var ngrokService: NgrokService?

    @Entry var systemPermissionManager: SystemPermissionManager?

    @Entry var terminalLauncher: TerminalLauncher?

    @Entry var tailscaleService: TailscaleService?

    @Entry var cloudflareService: CloudflareService?

    @Entry var pinggyService: PinggyService?

    @Entry var pangolinService: PangolinService?
}

// MARK: - View Extensions

extension View {
    /// Injects all VibeTunnel services into the environment
    @MainActor
    func withVibeTunnelServices(
        serverManager: ServerManager? = nil,
        ngrokService: NgrokService? = nil,
        systemPermissionManager: SystemPermissionManager? = nil,
        terminalLauncher: TerminalLauncher? = nil,
        tailscaleService: TailscaleService? = nil,
        cloudflareService: CloudflareService? = nil,
        pinggyService: PinggyService? = nil,
        pangolinService: PangolinService? = nil)
        -> some View
    {
        self
            .environment(\.serverManager, serverManager ?? ServerManager.shared)
            .environment(\.ngrokService, ngrokService ?? NgrokService.shared)
            .environment(
                \.systemPermissionManager,
                systemPermissionManager ?? SystemPermissionManager.shared)
            .environment(\.terminalLauncher, terminalLauncher ?? TerminalLauncher.shared)
            .environment(\.tailscaleService, tailscaleService ?? TailscaleService.shared)
            .environment(\.cloudflareService, cloudflareService ?? CloudflareService.shared)
            .environment(\.pinggyService, pinggyService ?? PinggyService.shared)
            .environment(\.pangolinService, pangolinService ?? PangolinService.shared)
    }
}
