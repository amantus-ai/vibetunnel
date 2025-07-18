import Foundation
import Observation
import os.log

/// Centralized manager for coordinating status checks of all remote services.
///
/// This manager prevents multiple views from independently polling the same services,
/// reducing network traffic and CPU usage. It provides a single source of truth for
/// service status updates across the application.
@MainActor
@Observable
final class RemoteServicesStatusManager {
    static let shared = RemoteServicesStatusManager()

    private var statusCheckTimer: Timer?
    private let checkInterval: TimeInterval = RemoteAccessConstants.statusCheckInterval
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "RemoteServicesStatus")

    // Service references
    private let ngrokService = NgrokService.shared
    private let tailscaleService = TailscaleService.shared
    private let cloudflareService = CloudflareService.shared

    // Status storage
    private(set) var ngrokStatus: NgrokTunnelStatus?
    private(set) var tailscaleStatus: (isInstalled: Bool, isRunning: Bool, hostname: String?)?
    private(set) var cloudflareStatus: (isInstalled: Bool, isRunning: Bool, publicUrl: String?, error: String?)?

    private init() {}

    /// Start monitoring all remote services
    func startMonitoring() {
        guard statusCheckTimer == nil else { return }

        logger.info("Starting remote services monitoring")

        // Perform initial check
        Task {
            await checkAllServices()
        }

        // Set up periodic checks
        statusCheckTimer = Timer.scheduledTimer(withTimeInterval: checkInterval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.checkAllServices()
            }
        }
    }

    /// Stop monitoring remote services
    func stopMonitoring() {
        logger.info("Stopping remote services monitoring")
        statusCheckTimer?.invalidate()
        statusCheckTimer = nil
    }

    /// Check all services and update their status
    private func checkAllServices() async {
        logger.debug("Checking all remote services status")

        // Check services in parallel
        async let ngrokCheck = ngrokService.getStatus()
        async let tailscaleCheck = checkTailscaleStatus()
        async let cloudflareCheck = cloudflareService.checkCloudflaredStatus()

        // Update status
        ngrokStatus = await ngrokCheck
        tailscaleStatus = await tailscaleCheck

        // Wait for cloudflare check to complete
        await cloudflareCheck

        // Get cloudflare status
        cloudflareStatus = (
            isInstalled: cloudflareService.isInstalled,
            isRunning: cloudflareService.isRunning,
            publicUrl: cloudflareService.publicUrl,
            error: cloudflareService.statusError
        )
    }

    /// Check Tailscale status
    private func checkTailscaleStatus() async -> (isInstalled: Bool, isRunning: Bool, hostname: String?) {
        await tailscaleService.checkTailscaleStatus()
        return (
            isInstalled: tailscaleService.isInstalled,
            isRunning: tailscaleService.isRunning,
            hostname: tailscaleService.tailscaleHostname
        )
    }
}
