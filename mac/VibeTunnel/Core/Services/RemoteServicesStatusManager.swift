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
    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "RemoteServicesStatus")

    struct TailscaleStatus: Equatable, Sendable {
        let isInstalled: Bool
        let isRunning: Bool
        let hostname: String?
    }

    struct CloudflareStatus: Equatable, Sendable {
        let isInstalled: Bool
        let isRunning: Bool
        let publicUrl: String?
        let error: String?
    }

    // Service references
    private let ngrokService = NgrokService.shared
    private let tailscaleService = TailscaleService.shared
    private let cloudflareService = CloudflareService.shared

    // Status storage
    private(set) var ngrokStatus: NgrokTunnelStatus?
    private(set) var tailscaleStatus: TailscaleStatus?
    private(set) var cloudflareStatus: CloudflareStatus?

    private init() {}

    /// Start monitoring all remote services
    func startMonitoring() {
        guard self.statusCheckTimer == nil else { return }

        self.logger.info("Starting remote services monitoring")

        // Perform initial check
        Task {
            await self.checkAllServices()
        }

        // Set up periodic checks
        self.statusCheckTimer = Timer
            .scheduledTimer(withTimeInterval: self.checkInterval, repeats: true) { [weak self] _ in
                Task { @MainActor [weak self] in
                    await self?.checkAllServices()
                }
            }
    }

    /// Stop monitoring remote services
    func stopMonitoring() {
        self.logger.info("Stopping remote services monitoring")
        self.statusCheckTimer?.invalidate()
        self.statusCheckTimer = nil
    }

    /// Check all services and update their status
    private func checkAllServices() async {
        self.logger.debug("Checking all remote services status")

        // Check services in parallel
        async let ngrokCheck = self.ngrokService.getStatus()
        async let tailscaleCheck = self.checkTailscaleStatus()
        async let cloudflareCheck: Void = self.cloudflareService.checkCloudflaredStatus()

        // Update status
        self.ngrokStatus = await ngrokCheck
        self.tailscaleStatus = await tailscaleCheck

        // Wait for cloudflare check to complete
        await cloudflareCheck

        // Get cloudflare status
        self.cloudflareStatus = CloudflareStatus(
            isInstalled: self.cloudflareService.isInstalled,
            isRunning: self.cloudflareService.isRunning,
            publicUrl: self.cloudflareService.publicUrl,
            error: self.cloudflareService.statusError)
    }

    /// Check Tailscale status
    private func checkTailscaleStatus() async -> TailscaleStatus {
        await self.tailscaleService.checkTailscaleStatus()
        return TailscaleStatus(
            isInstalled: self.tailscaleService.isInstalled,
            isRunning: self.tailscaleService.isRunning,
            hostname: self.tailscaleService.tailscaleHostname)
    }
}
