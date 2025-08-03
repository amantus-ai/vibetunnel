import os.log
import SwiftUI

/// Dashboard settings tab for monitoring and status
struct DashboardSettingsView: View {
    @AppStorage(AppConstants.UserDefaultsKeys.serverPort)
    private var serverPort = "4020"
    @AppStorage(AppConstants.UserDefaultsKeys.dashboardAccessMode)
    private var accessModeString = AppConstants.Defaults.dashboardAccessMode

    @Environment(ServerManager.self)
    private var serverManager
    @Environment(SessionService.self)
    private var sessionService
    @Environment(SessionMonitor.self)
    private var sessionMonitor
    @Environment(NgrokService.self)
    private var ngrokService
    @Environment(TailscaleService.self)
    private var tailscaleService
    @Environment(CloudflareService.self)
    private var cloudflareService

    @State private var serverStatus: ServerStatus = .stopped
    @State private var activeSessions: [DashboardSessionInfo] = []
    @State private var ngrokStatus: NgrokTunnelStatus?
    @State private var tailscaleStatus: (isInstalled: Bool, isRunning: Bool, hostname: String?)?

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "DashboardSettings")

    private var accessMode: DashboardAccessMode {
        DashboardAccessMode(rawValue: accessModeString) ?? .localhost
    }

    var body: some View {
        NavigationStack {
            Form {
                ServerStatusSection(
                    serverStatus: serverStatus,
                    serverPort: $serverPort,
                    accessModeString: $accessModeString,
                    serverManager: serverManager
                )

                RemoteAccessStatusSection(
                    ngrokStatus: ngrokStatus,
                    tailscaleStatus: tailscaleStatus,
                    cloudflareService: cloudflareService,
                    serverPort: serverPort,
                    accessMode: accessMode
                )

                ActiveSessionsSection(
                    activeSessions: activeSessions,
                    sessionService: sessionService
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

        // Update active sessions - filter out zombie and exited sessions
        activeSessions = sessionMonitor.sessions.values
            .compactMap { session in
                // Only include sessions that are actually running
                guard session.status == "running" else { return nil }

                // Parse the ISO 8601 date string
                let createdAt = ISO8601DateFormatter().date(from: session.startedAt) ?? Date()

                return DashboardSessionInfo(
                    id: session.id,
                    title: session.name.isEmpty ? "Untitled" : session.name,
                    createdAt: createdAt,
                    isActive: session.isRunning
                )
            }
            .sorted { $0.createdAt > $1.createdAt }

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

private enum ServerStatus: Equatable {
    case running
    case stopped
    case starting
    case error(String)
}

// MARK: - Session Info

private struct DashboardSessionInfo: Identifiable {
    let id: String
    let title: String
    let createdAt: Date
    let isActive: Bool
}

// MARK: - Server Configuration Section

private struct ServerStatusSection: View {
    let serverStatus: ServerStatus
    @Binding var serverPort: String
    @Binding var accessModeString: String
    let serverManager: ServerManager

    @State private var portConflict: PortConflict?
    @State private var isCheckingPort = false
    @State private var localIPAddress: String?

    private var isServerRunning: Bool {
        serverStatus == .running
    }

    private var serverPortInt: Int {
        Int(serverPort) ?? 4_020
    }

    private var accessMode: DashboardAccessMode {
        DashboardAccessMode(rawValue: accessModeString) ?? .localhost
    }

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                // Server Information
                VStack(alignment: .leading, spacing: 8) {
                    LabeledContent("Status") {
                        switch serverStatus {
                        case .running:
                            HStack {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                                Text("Running")
                            }
                        case .stopped:
                            Text("Stopped")
                                .foregroundStyle(.secondary)
                        case .starting:
                            HStack {
                                ProgressView()
                                    .scaleEffect(0.7)
                                Text("Starting...")
                            }
                        case .error(let message):
                            HStack {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(.orange)
                                Text(message)
                                    .lineLimit(1)
                            }
                        }
                    }

                    // Access Mode
                    AccessModeView(
                        accessMode: accessMode,
                        accessModeString: $accessModeString,
                        serverPort: serverPort,
                        localIPAddress: localIPAddress,
                        restartServerWithNewBindAddress: restartServerWithNewBindAddress
                    )

                    // Editable Port
                    PortConfigurationView(
                        serverPort: $serverPort,
                        restartServerWithNewPort: restartServerWithNewPort,
                        serverManager: serverManager
                    )

                    LabeledContent("Bind Address") {
                        Text(serverManager.bindAddress)
                            .font(.system(.body, design: .monospaced))
                    }

                    LabeledContent("Base URL") {
                        let baseAddress = serverManager.bindAddress == "0.0.0.0" ? "127.0.0.1" : serverManager
                            .bindAddress
                        if let serverURL = URL(string: "http://\(baseAddress):\(serverPort)") {
                            Link("http://\(baseAddress):\(serverPort)", destination: serverURL)
                                .font(.system(.body, design: .monospaced))
                        } else {
                            Text("http://\(baseAddress):\(serverPort)")
                                .font(.system(.body, design: .monospaced))
                        }
                    }

                    if let pid = serverManager.serverProcessId {
                        LabeledContent("Process ID") {
                            Text("\(pid)")
                                .font(.system(.body, design: .monospaced))
                        }
                    }
                }

                Divider()

                // Server Control
                LabeledContent("HTTP Server") {
                    HStack {
                        Spacer()

                        if serverStatus == .stopped {
                            Button("Start") {
                                Task {
                                    await serverManager.start()
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                        } else if serverStatus == .running {
                            Button("Restart") {
                                Task {
                                    await serverManager.manualRestart()
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                        }
                    }
                }

                // Port conflict warning
                if let conflict = portConflict {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 4) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.orange)
                                .font(.caption)

                            Text("Port \(conflict.port) is used by \(conflict.process.name)")
                                .font(.caption)
                                .foregroundColor(.orange)
                        }

                        if !conflict.alternativePorts.isEmpty {
                            HStack(spacing: 4) {
                                Text("Try port:")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)

                                ForEach(conflict.alternativePorts.prefix(3), id: \.self) { port in
                                    Button(String(port)) {
                                        Task {
                                            await ServerConfigurationHelpers.restartServerWithNewPort(
                                                port,
                                                serverManager: serverManager
                                            )
                                        }
                                    }
                                    .buttonStyle(.link)
                                    .font(.caption)
                                }
                            }
                        }

                        // Add kill button for conflicting processes
                        HStack {
                            Button("Kill Process") {
                                Task {
                                    do {
                                        try await PortConflictResolver.shared.forceKillProcess(conflict)
                                        // After killing, clear the conflict and restart the server
                                        portConflict = nil
                                        await serverManager.start()
                                    } catch {
                                        // Handle error - in a real implementation, you might show an alert
                                        print("Failed to kill process: \(error)")
                                    }
                                }
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)

                            Spacer()
                        }
                        .padding(.top, 8)
                    }
                    .padding(.vertical, 8)
                    .padding(.horizontal, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.orange.opacity(0.1))
                    .cornerRadius(6)
                }
            }
            .padding(.vertical, 4)
            .task {
                await checkPortAvailability()
                await updateLocalIPAddress()
            }
            .task(id: serverPort) {
                await checkPortAvailability()
            }
            .task(id: accessModeString) {
                await updateLocalIPAddress()
            }
        } header: {
            Text("Server Configuration")
                .font(.headline)
        } footer: {
            // Dashboard URL display
            if accessMode == .localhost {
                HStack(spacing: 5) {
                    Text("Dashboard available at")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    if let url = DashboardURLBuilder.dashboardURL(port: serverPort) {
                        Link(url.absoluteString, destination: url)
                            .font(.caption)
                            .foregroundStyle(.blue)
                    }
                }
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
            } else if accessMode == .network {
                if let ip = localIPAddress {
                    HStack(spacing: 5) {
                        Text("Dashboard available at")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        if let url = URL(string: "http://\(ip):\(serverPort)") {
                            Link(url.absoluteString, destination: url)
                                .font(.caption)
                                .foregroundStyle(.blue)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                } else {
                    Text("Fetching local IP address...")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                }
            }
        }
    }

    private func restartServerWithNewPort(_ port: Int) {
        Task {
            await ServerConfigurationHelpers.restartServerWithNewPort(port, serverManager: serverManager)
        }
    }

    private func restartServerWithNewBindAddress() {
        Task {
            await ServerConfigurationHelpers.restartServerWithNewBindAddress(
                accessMode: accessMode,
                serverManager: serverManager
            )
        }
    }

    private func updateLocalIPAddress() async {
        localIPAddress = await ServerConfigurationHelpers.updateLocalIPAddress(accessMode: accessMode)
    }

    private func checkPortAvailability() async {
        isCheckingPort = true
        defer { isCheckingPort = false }

        let port = serverPortInt

        // Only check if it's not the port we're already successfully using
        if serverManager.isRunning && Int(serverManager.port) == port {
            portConflict = nil
            return
        }

        if let conflict = await PortConflictResolver.shared.detectConflict(on: port) {
            // Only show warning for non-VibeTunnel processes
            // VibeTunnel instances will be auto-killed by ServerManager
            if case .reportExternalApp = conflict.suggestedAction {
                portConflict = conflict
            } else {
                // It's our own process, will be handled automatically
                portConflict = nil
            }
        } else {
            portConflict = nil
        }
    }
}

// MARK: - Active Sessions Section

private struct ActiveSessionsSection: View {
    let activeSessions: [DashboardSessionInfo]
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
                if let status = tailscaleStatus {
                    if status.isRunning, let hostname = status.hostname {
                        HStack {
                            Image(systemName: "circle.fill")
                                .foregroundColor(.green)
                                .font(.system(size: 10))
                            Text("Tailscale")
                                .font(.callout)
                            InlineClickableURLView(
                                label: "",
                                url: "http://\(hostname):\(serverPort)"
                            )
                        }
                    } else if status.isRunning {
                        HStack {
                            Image(systemName: "circle.fill")
                                .foregroundColor(.green)
                                .font(.system(size: 10))
                            Text("Tailscale")
                                .font(.callout)
                            Spacer()
                        }
                    } else if status.isInstalled {
                        HStack {
                            Image(systemName: "circle.fill")
                                .foregroundColor(.orange)
                                .font(.system(size: 10))
                            Text("Tailscale (not running)")
                                .font(.callout)
                            Spacer()
                        }
                    } else {
                        HStack {
                            Image(systemName: "circle")
                                .foregroundColor(.gray)
                                .font(.system(size: 10))
                            Text("Tailscale (not installed)")
                                .font(.callout)
                                .foregroundColor(.secondary)
                            Spacer()
                        }
                    }
                } else {
                    HStack {
                        Image(systemName: "circle")
                            .foregroundColor(.gray)
                            .font(.system(size: 10))
                        Text("Tailscale")
                            .font(.callout)
                            .foregroundColor(.secondary)
                        Spacer()
                    }
                }

                // ngrok status
                if let status = ngrokStatus {
                    HStack {
                        Image(systemName: "circle.fill")
                            .foregroundColor(.green)
                            .font(.system(size: 10))
                        Text("ngrok")
                            .font(.callout)
                        InlineClickableURLView(
                            label: "",
                            url: status.publicUrl
                        )
                    }
                } else {
                    HStack {
                        Image(systemName: "circle")
                            .foregroundColor(.gray)
                            .font(.system(size: 10))
                        Text("ngrok (not connected)")
                            .font(.callout)
                            .foregroundColor(.secondary)
                        Spacer()
                    }
                }

                // Cloudflare status
                if cloudflareService.isRunning, let url = cloudflareService.publicUrl {
                    HStack {
                        Image(systemName: "circle.fill")
                            .foregroundColor(.green)
                            .font(.system(size: 10))
                        Text("Cloudflare")
                            .font(.callout)
                        InlineClickableURLView(
                            label: "",
                            url: url
                        )
                    }
                } else {
                    HStack {
                        Image(systemName: "circle")
                            .foregroundColor(.gray)
                            .font(.system(size: 10))
                        Text("Cloudflare (not connected)")
                            .font(.callout)
                            .foregroundColor(.secondary)
                        Spacer()
                    }
                }
            }
        } header: {
            Text("Remote Access")
                .font(.headline)
        } footer: {
            Text("Configure remote access options in the Remote tab")
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
