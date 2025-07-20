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

        // Update active sessions - filter out zombie and exited sessions
        activeSessions = sessionMonitor.sessions.values
            .compactMap { session in
                // Only include sessions that are actually running
                guard session.status == "running" else { return nil }

                // Parse the ISO 8601 date string
                let createdAt = ISO8601DateFormatter().date(from: session.startedAt) ?? Date()

                return DashboardSessionInfo(
                    id: session.id,
                    title: session.name ?? "Untitled",
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

// MARK: - Server Status Section

private struct ServerStatusSection: View {
    let serverStatus: ServerStatus
    let serverPort: String
    let accessMode: DashboardAccessMode
    let serverManager: ServerManager

    @State private var portConflict: PortConflict?
    @State private var isCheckingPort = false

    private var isServerRunning: Bool {
        serverStatus == .running
    }

    private var serverPortInt: Int {
        Int(serverPort) ?? 4_020
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

                    LabeledContent("Port") {
                        Text(serverPort)
                    }

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
                }

                Divider()

                // Server Status
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("HTTP Server")
                            Circle()
                                .fill(isServerRunning ? .green : .red)
                                .frame(width: 8, height: 8)
                        }
                        Text(isServerRunning ? "Server is running on port \(serverPort)" : "Server is stopped")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    if serverStatus == .stopped {
                        Button("Start") {
                            Task {
                                await serverManager.start()
                            }
                        }
                        .buttonStyle(.borderedProminent)
                    } else if serverStatus == .running {
                        Button("Restart") {
                            Task {
                                await serverManager.manualRestart()
                            }
                        }
                        .buttonStyle(.borderedProminent)
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
            }
            .task(id: serverPort) {
                await checkPortAvailability()
            }
        } header: {
            Text("Server Status")
                .font(.headline)
        }
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

                        if let url = URL(string: status.publicUrl) {
                            Link(status.publicUrl, destination: url)
                                .font(.caption)
                                .foregroundStyle(.blue)
                                .lineLimit(1)
                        } else {
                            Text(status.publicUrl)
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                        }

                        NgrokURLCopyButton(url: status.publicUrl)
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
                            Text(
                                "(\(url.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: ".trycloudflare.com", with: "")))"
                            )
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
            Text("Configure remote access options in the Remote tab")
                .font(.caption)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
    }
}

// MARK: - Ngrok URL Copy Button

private struct NgrokURLCopyButton: View {
    let url: String
    @State private var showCopiedFeedback = false
    @State private var feedbackTask: DispatchWorkItem?

    var body: some View {
        Button(action: {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(url, forType: .string)

            // Cancel previous timer if exists
            feedbackTask?.cancel()

            withAnimation {
                showCopiedFeedback = true
            }

            // Create new timer
            let task = DispatchWorkItem {
                withAnimation {
                    showCopiedFeedback = false
                }
            }
            feedbackTask = task
            DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: task)
        }, label: {
            Image(systemName: showCopiedFeedback ? "checkmark" : "doc.on.doc")
                .foregroundColor(showCopiedFeedback ? .green : .accentColor)
        })
        .buttonStyle(.borderless)
        .help("Copy URL")
        .font(.caption)
    }
}

// MARK: - Previews

#Preview("Dashboard Settings") {
    DashboardSettingsView()
        .frame(width: 500, height: 600)
        .environment(SystemPermissionManager.shared)
}
