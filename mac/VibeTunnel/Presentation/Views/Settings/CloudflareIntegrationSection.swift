import SwiftUI
import os.log

/// CloudflareIntegrationSection displays Cloudflare tunnel status and management controls
/// Following the same pattern as TailscaleIntegrationSection
struct CloudflareIntegrationSection: View {
    let cloudflareService: CloudflareService
    let serverPort: String
    let accessMode: DashboardAccessMode

    @State private var statusCheckTimer: Timer?
    @State private var toggleTimeoutTimer: Timer?
    @State private var isTogglingTunnel = false
    @State private var tunnelEnabled = false

    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "CloudflareIntegrationSection")
    
    // MARK: - Constants
    private let statusCheckInterval: TimeInterval = 10.0 // seconds
    private let startTimeoutInterval: TimeInterval = 15.0 // seconds
    private let stopTimeoutInterval: TimeInterval = 10.0 // seconds

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                // Status display
                HStack {
                    if cloudflareService.isInstalled {
                        if cloudflareService.isRunning {
                            // Green dot: cloudflared is installed and tunnel is running
                            Image(systemName: "circle.fill")
                                .foregroundColor(.green)
                                .font(.system(size: 10))
                            Text("Cloudflare tunnel is running")
                                .font(.callout)
                        } else {
                            // Orange dot: cloudflared is installed but tunnel not running
                            Image(systemName: "circle.fill")
                                .foregroundColor(.orange)
                                .font(.system(size: 10))
                            Text("cloudflared is installed")
                                .font(.callout)
                        }
                    } else {
                        // Yellow dot: cloudflared is not installed
                        Image(systemName: "circle.fill")
                            .foregroundColor(.yellow)
                            .font(.system(size: 10))
                        Text("cloudflared is not installed")
                            .font(.callout)
                    }

                    Spacer()
                }

                // Show additional content based on state
                if !cloudflareService.isInstalled {
                    // Show installation links when not installed
                    HStack(spacing: 12) {
                        Button(action: {
                            cloudflareService.openHomebrewInstall()
                        }, label: {
                            Text("Homebrew")
                        })
                        .buttonStyle(.link)
                        .controlSize(.small)

                        Button(action: {
                            cloudflareService.openDownloadPage()
                        }, label: {
                            Text("Direct Download")
                        })
                        .buttonStyle(.link)
                        .controlSize(.small)

                        Button(action: {
                            cloudflareService.openSetupGuide()
                        }, label: {
                            Text("Setup Guide")
                        })
                        .buttonStyle(.link)
                        .controlSize(.small)
                    }
                } else {
                    // Show tunnel controls when cloudflared is installed
                    VStack(alignment: .leading, spacing: 8) {
                        // Tunnel toggle
                        HStack {
                            Toggle("Enable Quick Tunnel", isOn: $tunnelEnabled)
                                .disabled(isTogglingTunnel)
                                .onChange(of: tunnelEnabled) { _, newValue in
                                    if newValue {
                                        startTunnel()
                                    } else {
                                        stopTunnel()
                                    }
                                }

                            if isTogglingTunnel {
                                ProgressView()
                                    .scaleEffect(0.7)
                            } else if cloudflareService.isRunning {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                                Text("Connected")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }

                        // Public URL display
                        if let publicUrl = cloudflareService.publicUrl, !publicUrl.isEmpty {
                            PublicURLView(url: publicUrl)
                        }

                        // Error display
                        if let error = cloudflareService.statusError, !error.isEmpty {
                            ErrorView(error: error)
                        }
                    }
                }
            }
        } header: {
            Text("Cloudflare Integration")
                .font(.headline)
        } footer: {
            Text(
                "Cloudflare Quick Tunnels provide free, secure public access to your terminal sessions from any device. No account required."
            )
            .font(.caption)
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
        }
        .task {
            // Reset any stuck toggling state first
            if isTogglingTunnel {
                logger.warning("CloudflareIntegrationSection: Found stuck isTogglingTunnel state, resetting")
                isTogglingTunnel = false
            }
            
            // Check status when view appears
            logger.info("CloudflareIntegrationSection: Starting initial status check, isTogglingTunnel: \(isTogglingTunnel)")
            await cloudflareService.checkCloudflaredStatus()
            await syncUIWithService()
            
            // Set up timer for automatic updates
            statusCheckTimer = Timer.scheduledTimer(withTimeInterval: statusCheckInterval, repeats: true) { _ in
                Task { @MainActor in
                    logger.debug("CloudflareIntegrationSection: Running periodic status check, isTogglingTunnel: \(isTogglingTunnel)")
                    // Only check if we're not currently toggling
                    if !isTogglingTunnel {
                        await cloudflareService.checkCloudflaredStatus()
                        await syncUIWithService()
                    } else {
                        logger.debug("CloudflareIntegrationSection: Skipping periodic check while toggling")
                    }
                }
            }
        }
        .onDisappear {
            // Clean up timers when view disappears
            statusCheckTimer?.invalidate()
            statusCheckTimer = nil
            toggleTimeoutTimer?.invalidate()
            toggleTimeoutTimer = nil
            logger.info("CloudflareIntegrationSection: Stopped timers")
        }
    }

    // MARK: - Private Methods

    private func syncUIWithService() async {
        await MainActor.run {
            let wasEnabled = tunnelEnabled
            let oldUrl = cloudflareService.publicUrl
            
            tunnelEnabled = cloudflareService.isRunning
            
            if wasEnabled != tunnelEnabled {
                logger.info("CloudflareIntegrationSection: Tunnel enabled changed: \(wasEnabled) -> \(tunnelEnabled)")
            }
            
            if oldUrl != cloudflareService.publicUrl {
                logger.info("CloudflareIntegrationSection: URL changed: \(oldUrl ?? "nil") -> \(cloudflareService.publicUrl ?? "nil")")
            }
            
            logger.info("CloudflareIntegrationSection: Synced UI - isRunning: \(cloudflareService.isRunning), publicUrl: \(cloudflareService.publicUrl ?? "nil")")
        }
    }

    private func startTunnel() {
        guard !isTogglingTunnel else { 
            logger.warning("Already toggling tunnel, ignoring start request")
            return 
        }
        
        isTogglingTunnel = true
        logger.info("Starting Cloudflare Quick Tunnel on port \(serverPort)")
        
        // Set up timeout to force reset if stuck
        toggleTimeoutTimer?.invalidate()
        toggleTimeoutTimer = Timer.scheduledTimer(withTimeInterval: startTimeoutInterval, repeats: false) { _ in
            Task { @MainActor in
                if isTogglingTunnel {
                    logger.error("CloudflareIntegrationSection: Tunnel start timed out, force resetting isTogglingTunnel")
                    isTogglingTunnel = false
                    tunnelEnabled = false
                }
            }
        }

        Task {
            defer {
                // Always reset toggling state and cancel timeout
                Task { @MainActor in
                    toggleTimeoutTimer?.invalidate()
                    toggleTimeoutTimer = nil
                    isTogglingTunnel = false
                    logger.info("CloudflareIntegrationSection: Reset isTogglingTunnel = false")
                }
            }
            
            do {
                let port = Int(serverPort) ?? 4020
                logger.info("Calling startQuickTunnel with port \(port)")
                try await cloudflareService.startQuickTunnel(port: port)
                logger.info("Cloudflare tunnel started successfully, URL: \(cloudflareService.publicUrl ?? "nil")")
                
                // Sync UI with service state
                await syncUIWithService()
                
            } catch {
                logger.error("Failed to start Cloudflare tunnel: \(error)")
                
                // Reset toggle on failure
                await MainActor.run {
                    tunnelEnabled = false
                }
            }
        }
    }

    private func stopTunnel() {
        guard !isTogglingTunnel else { 
            logger.warning("Already toggling tunnel, ignoring stop request")
            return 
        }
        
        isTogglingTunnel = true
        logger.info("Stopping Cloudflare Quick Tunnel")
        
        // Set up timeout to force reset if stuck
        toggleTimeoutTimer?.invalidate()
        toggleTimeoutTimer = Timer.scheduledTimer(withTimeInterval: stopTimeoutInterval, repeats: false) { _ in
            Task { @MainActor in
                if isTogglingTunnel {
                    logger.error("CloudflareIntegrationSection: Tunnel stop timed out, force resetting isTogglingTunnel")
                    isTogglingTunnel = false
                }
            }
        }

        Task {
            defer {
                // Always reset toggling state and cancel timeout
                Task { @MainActor in
                    toggleTimeoutTimer?.invalidate()
                    toggleTimeoutTimer = nil
                    isTogglingTunnel = false
                    logger.info("CloudflareIntegrationSection: Reset isTogglingTunnel = false after stop")
                }
            }
            
            await cloudflareService.stopQuickTunnel()
            logger.info("Cloudflare tunnel stopped")
            
            // Sync UI with service state
            await syncUIWithService()
        }
    }
}

// MARK: - Reusable Components

/// Displays a public URL with copy functionality
private struct PublicURLView: View {
    let url: String

    @State private var showCopiedFeedback = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Public URL:")
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                Spacer()
                
                Button(action: {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(url, forType: .string)
                    withAnimation {
                        showCopiedFeedback = true
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        withAnimation {
                            showCopiedFeedback = false
                        }
                    }
                }, label: {
                    Image(systemName: showCopiedFeedback ? "checkmark" : "doc.on.doc")
                        .foregroundColor(showCopiedFeedback ? .green : .accentColor)
                })
                .buttonStyle(.borderless)
                .help("Copy URL")
            }
            
            HStack {
                Text(url)
                    .font(.caption)
                    .foregroundColor(.blue)
                    .textSelection(.enabled)
                    .lineLimit(1)
                    .truncationMode(.middle)
                
                Spacer()
                
                Button(action: {
                    if let nsUrl = URL(string: url) {
                        NSWorkspace.shared.open(nsUrl)
                    }
                }, label: {
                    Image(systemName: "arrow.up.right.square")
                        .foregroundColor(.accentColor)
                })
                .buttonStyle(.borderless)
                .help("Open in Browser")
            }
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 8)
        .background(Color.gray.opacity(0.1))
        .cornerRadius(6)
    }
}

/// Displays error messages with warning icon
private struct ErrorView: View {
    let error: String

    var body: some View {
        HStack {
            Image(systemName: "exclamationmark.triangle")
                .foregroundColor(.red)
            Text(error)
                .font(.caption)
                .foregroundColor(.red)
                .lineLimit(2)
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 8)
        .background(Color.red.opacity(0.1))
        .cornerRadius(6)
    }
}

// MARK: - Previews

#Preview("Cloudflare Integration - Not Installed") {
    CloudflareIntegrationSection(
        cloudflareService: CloudflareService.shared,
        serverPort: "4020",
        accessMode: .network
    )
    .frame(width: 500)
    .formStyle(.grouped)
}

#Preview("Cloudflare Integration - Installed") {
    CloudflareIntegrationSection(
        cloudflareService: CloudflareService.shared,
        serverPort: "4020",
        accessMode: .network
    )
    .frame(width: 500)
    .formStyle(.grouped)
}