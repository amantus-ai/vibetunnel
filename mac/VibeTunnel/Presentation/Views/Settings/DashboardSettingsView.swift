import os.log
import SwiftUI

/// Dashboard settings tab for monitoring and status
struct DashboardSettingsView: View {
    @AppStorage(AppConstants.UserDefaultsKeys.serverPort)
    private var serverPort = "4020"
    @AppStorage(AppConstants.UserDefaultsKeys.dashboardAccessMode)
    private var accessModeString = DashboardAccessMode.network.rawValue

    @Environment(ServerManager.self)
    private var serverManager
    @Environment(SessionService.self)
    private var sessionService
    @Environment(NgrokService.self)
    private var ngrokService
    @Environment(TailscaleService.self)
    private var tailscaleService
    @Environment(CloudflareService.self)
    private var cloudflareService

    @State private var serverStatus: ServerStatus = .stopped
    @State private var activeSessions: [SessionInfo] = []
    @State private var ngrokStatus: NgrokTunnelStatus?
    @State private var tailscaleStatus: (isInstalled: Bool, isRunning: Bool, hostname: String?)?

    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "DashboardSettings")

    private var accessMode: DashboardAccessMode {
        DashboardAccessMode(rawValue: accessModeString) ?? .localhost
    }

    var body: some View {
        NavigationStack {
            Form {
                ServerStatusSection(
                    serverStatus: serverStatus,
                    serverPort: serverPort,
                    accessMode: accessMode,
                    serverManager: serverManager
                )

                ActiveSessionsSection(
                    activeSessions: activeSessions,
                    sessionService: sessionService
                )

                RemoteAccessStatusSection(
                    ngrokStatus: ngrokStatus,
                    tailscaleStatus: tailscaleStatus,
                    cloudflareService: cloudflareService,
                    serverPort: serverPort,
                    accessMode: accessMode
                )
            }
            .formStyle(.grouped)
            .frame(minWidth: 500, idealWidth: 600)
            .scrollContentBackground(.hidden)
            .navigationTitle("Dashboard")
            .task {
                await updateStatuses()
            }
            .onReceive(Timer.publish(every: 5, on: .main, in: .common).autoconnect()) { _ in
                Task {
                    await updateStatuses()
                }
            }
        }
    }

    // MARK: - Private Methods

    private func updateStatuses() async {
        // Update server status
        serverStatus = serverManager.isRunning ? .running : .stopped

        // Update active sessions
        activeSessions = sessionService.allSessions.values.compactMap { session in
            SessionInfo(
                id: session.sessionId,
                title: session.title ?? "Untitled",
                createdAt: session.createdAt,
                isActive: session.isActive
            )
        }.sorted { $0.createdAt > $1.createdAt }

        // Update ngrok status
        ngrokStatus = await ngrokService.getStatus()

        // Update Tailscale status
        await tailscaleService.checkTailscaleStatus()
        tailscaleStatus = (
            isInstalled: tailscaleService.isInstalled,
            isRunning: tailscaleService.isRunning,
            hostname: tailscaleService.tailscaleHostname
        )

        // Update Cloudflare status
        await cloudflareService.checkCloudflaredStatus()
    }
}

// MARK: - Server Status

private enum ServerStatus {
    case running
    case stopped
    case starting
    case error(String)
}

// MARK: - Session Info

private struct SessionInfo: Identifiable {
    let id: String
    let title: String
    let createdAt: Date
    let isActive: Bool
}

// MARK: - Server Status Section

private struct ServerStatusSection: View {
    let serverStatus: ServerStatus
    let serverPort: String
    let accessMode: DashboardAccessMode
    let serverManager: ServerManager
    
    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                // Status indicator
                HStack {
                    switch serverStatus {
                    case .running:
                        Image(systemName: "circle.fill")
                            .foregroundColor(.green)
                            .font(.system(size: 10))
                        Text("Server is running")
                            .font(.callout)
                    case .stopped:
                        Image(systemName: "circle.fill")
                            .foregroundColor(.red)
                            .font(.system(size: 10))
                        Text("Server is stopped")
                            .font(.callout)
                    case .starting:
                        ProgressView()
                            .scaleEffect(0.7)
                        Text("Server is starting...")
                            .font(.callout)
                    case .error(let message):
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(.orange)
                            .font(.system(size: 10))
                        Text("Error: \(message)")
                            .font(.callout)
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                    
                    if serverStatus == .stopped {
                        Button("Start") {
                            Task {
                                await serverManager.start()
                            }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    } else if serverStatus == .running {
                        Button("Restart") {
                            Task {
                                await serverManager.restart()
                            }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
                
                // Server details
                if serverStatus == .running {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("Port:")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text(serverPort)
                                .font(.caption)
                                .fontWeight(.medium)
                        }
                        
                        HStack {
                            Text("Access Mode:")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text(accessMode.displayName)
                                .font(.caption)
                                .fontWeight(.medium)
                        }
                        
                        if accessMode == .localhost {
                            HStack {
                                Text("URL:")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                if let url = DashboardURLBuilder.dashboardURL(port: serverPort) {
                                    Link(url.absoluteString, destination: url)
                                        .font(.caption)
                                }
                            }
                        } else if accessMode == .network {
                            if let ip = NetworkUtility.getLocalIPAddress() {
                                HStack {
                                    Text("URL:")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                    if let url = URL(string: "http://\(ip):\(serverPort)") {
                                        Link(url.absoluteString, destination: url)
                                            .font(.caption)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } header: {
            Text("Server Status")
                .font(.headline)
        }
    }
}

// MARK: - Active Sessions Section

private struct ActiveSessionsSection: View {
    let activeSessions: [SessionInfo]
    let sessionService: SessionService
    
    var body: some View {
        Section {
            if activeSessions.isEmpty {
                Text("No active sessions")
                    .font(.callout)
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 8)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(activeSessions.prefix(5)) { session in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(session.title)
                                    .font(.callout)
                                    .lineLimit(1)
                                Text(session.createdAt, style: .relative)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            
                            Spacer()
                            
                            if session.isActive {
                                Image(systemName: "circle.fill")
                                    .foregroundColor(.green)
                                    .font(.system(size: 8))
                            } else {
                                Image(systemName: "circle")
                                    .foregroundColor(.gray)
                                    .font(.system(size: 8))
                            }
                        }
                    }
                    
                    if activeSessions.count > 5 {
                        Text("And \(activeSessions.count - 5) more...")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
        } header: {
            HStack {
                Text("Active Sessions")
                    .font(.headline)
                Spacer()
                Text("\(activeSessions.count)")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Color.gray.opacity(0.2))
                    .clipShape(Capsule())
            }
        }
    }
}

// MARK: - Remote Access Status Section

private struct RemoteAccessStatusSection: View {
    let ngrokStatus: NgrokTunnelStatus?
    let tailscaleStatus: (isInstalled: Bool, isRunning: Bool, hostname: String?)?
    let cloudflareService: CloudflareService
    let serverPort: String
    let accessMode: DashboardAccessMode
    
    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                // Tailscale status
                HStack {
                    if let status = tailscaleStatus {
                        if status.isRunning {
                            Image(systemName: "circle.fill")
                                .foregroundColor(.green)
                                .font(.system(size: 10))
                            Text("Tailscale")
                                .font(.callout)
                            if let hostname = status.hostname {
                                Text("(\(hostname))")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        } else if status.isInstalled {
                            Image(systemName: "circle.fill")
                                .foregroundColor(.orange)
                                .font(.system(size: 10))
                            Text("Tailscale (not running)")
                                .font(.callout)
                        } else {
                            Image(systemName: "circle")
                                .foregroundColor(.gray)
                                .font(.system(size: 10))
                            Text("Tailscale (not installed)")
                                .font(.callout)
                                .foregroundColor(.secondary)
                        }
                    } else {
                        Image(systemName: "circle")
                            .foregroundColor(.gray)
                            .font(.system(size: 10))
                        Text("Tailscale")
                            .font(.callout)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                }
                
                // ngrok status
                HStack {
                    if let status = ngrokStatus {
                        Image(systemName: "circle.fill")
                            .foregroundColor(.green)
                            .font(.system(size: 10))
                        Text("ngrok")
                            .font(.callout)
                        Text("(\(status.publicUrl.replacingOccurrences(of: "https://", with: "")))")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    } else {
                        Image(systemName: "circle")
                            .foregroundColor(.gray)
                            .font(.system(size: 10))
                        Text("ngrok (not connected)")
                            .font(.callout)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                }
                
                // Cloudflare status
                HStack {
                    if cloudflareService.isRunning {
                        Image(systemName: "circle.fill")
                            .foregroundColor(.green)
                            .font(.system(size: 10))
                        Text("Cloudflare")
                            .font(.callout)
                        if let url = cloudflareService.publicUrl {
                            Text("(\(url.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: ".trycloudflare.com", with: "")))")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                        }
                    } else {
                        Image(systemName: "circle")
                            .foregroundColor(.gray)
                            .font(.system(size: 10))
                        Text("Cloudflare (not connected)")
                            .font(.callout)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                }
            }
        } header: {
            Text("Remote Access")
                .font(.headline)
        } footer: {
            Text("Configure remote access options in the Remote Access tab")
                .font(.caption)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
    }
}

// MARK: - Previews

#Preview("Dashboard Settings") {
    DashboardSettingsView()
        .frame(width: 500, height: 600)
        .environment(SystemPermissionManager.shared)
}