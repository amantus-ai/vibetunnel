import Foundation

/// Configuration for StatusBarMenuManager setup.
///
/// This struct bundles all the service dependencies required to initialize
/// the status bar menu manager. It ensures all necessary services are provided
/// during initialization, following the dependency injection pattern.
struct StatusBarMenuConfiguration {
    /// Monitors active terminal sessions.
    ///
    /// Tracks the lifecycle of terminal sessions, providing real-time
    /// updates about session state and metadata.
    let sessionMonitor: SessionMonitor

    /// Manages the VibeTunnel web server.
    ///
    /// Handles starting, stopping, and monitoring the embedded or
    /// development web server that serves the terminal interface.
    let serverManager: ServerManager

    /// Provides ngrok tunnel functionality.
    ///
    /// Manages ngrok tunnels for exposing local terminal sessions
    /// to the internet with secure HTTPS endpoints.
    let ngrokService: NgrokService

    /// Provides Tailscale network functionality.
    ///
    /// Manages Tailscale integration for secure peer-to-peer
    /// networking without exposing sessions to the public internet.
    let tailscaleService: TailscaleService

    /// Launches terminal applications.
    ///
    /// Handles opening new terminal windows or tabs in the user's
    /// preferred terminal application (Terminal.app, iTerm2, etc.).
    let terminalLauncher: TerminalLauncher

    /// Monitors Git repository states.
    ///
    /// Provides real-time information about Git repositories,
    /// including branch status, uncommitted changes, and sync state.
    let gitRepositoryMonitor: GitRepositoryMonitor

    /// Discovers Git repositories on the system.
    ///
    /// Scans and indexes Git repositories for quick access
    /// and provides repository suggestions in the UI.
    let repositoryDiscovery: RepositoryDiscoveryService

    /// Manages application configuration.
    ///
    /// Handles reading and writing configuration settings,
    /// including user preferences and system settings.
    let configManager: ConfigManager

    /// Manages Git worktrees.
    ///
    /// Provides functionality for creating, listing, and managing
    /// Git worktrees for parallel development workflows.
    let worktreeService: WorktreeService
}
