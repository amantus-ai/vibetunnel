import Foundation

/// Configuration for StatusBarMenuManager setup
struct StatusBarMenuConfiguration {
    let sessionMonitor: SessionMonitor
    let serverManager: ServerManager
    let ngrokService: NgrokService
    let tailscaleService: TailscaleService
    let terminalLauncher: TerminalLauncher
    let gitRepositoryMonitor: GitRepositoryMonitor
    let repositoryDiscovery: RepositoryDiscoveryService
    let configManager: ConfigManager
    let worktreeService: WorktreeService
}
