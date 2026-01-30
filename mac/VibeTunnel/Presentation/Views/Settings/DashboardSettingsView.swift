import os.log
import SwiftUI

private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "DashboardSettingsView")

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
    @State private var tailscaleStatus: RemoteServicesStatusManager.TailscaleStatus?

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "DashboardSettings")

    private var accessMode: DashboardAccessMode {
        DashboardAccessMode(rawValue: self.accessModeString) ?? .localhost
    }

    var body: some View {
        NavigationStack {
            Form {
                ServerStatusSection(
                    serverStatus: self.serverStatus,
                    serverPort: self.$serverPort,
                    accessModeString: self.$accessModeString,
                    serverManager: self.serverManager)

                RemoteAccessStatusSection(
                    ngrokStatus: self.ngrokStatus,
                    tailscaleStatus: self.tailscaleStatus,
                    cloudflareService: self.cloudflareService,
                    serverPort: self.serverPort,
                    accessMode: self.accessMode)

                ActiveSessionsSection(
                    activeSessions: self.activeSessions,
                    sessionService: self.sessionService)
            }
            .formStyle(.grouped)
            .frame(minWidth: 500, idealWidth: 600)
            .scrollContentBackground(.hidden)
            .navigationTitle("Dashboard")
            .task {
                await self.updateStatuses()
            }
            .onReceive(Timer.publish(every: 15, on: .main, in: .common).autoconnect()) { _ in
                // Reduced frequency to prevent UI flickering
                Task {
                    await self.updateStatuses()
                }
            }
        }
    }

    // MARK: - Private Methods

    private func updateStatuses() async {
        // Update server status
        self.serverStatus = self.serverManager.isRunning ? .running : .stopped

        // Update active sessions - filter out zombie and exited sessions
        self.activeSessions = self.sessionMonitor.sessions.values
            .compactMap { session in
                // Only include sessions that are actually running
                guard session.status == "running" else { return nil }

                // Parse the ISO 8601 date string
                let createdAt = ISO8601DateFormatter().date(from: session.startedAt) ?? Date()

                return DashboardSessionInfo(
                    id: session.id,
                    title: session.name.isEmpty ? "Untitled" : session.name,
                    createdAt: createdAt,
                    isActive: session.isRunning)
            }
            .sorted { $0.createdAt > $1.createdAt }

        // Update ngrok status
        self.ngrokStatus = await self.ngrokService.getStatus()

        // Update Tailscale status
        await self.tailscaleService.checkTailscaleStatus()
        self.tailscaleStatus = RemoteServicesStatusManager.TailscaleStatus(
            isInstalled: self.tailscaleService.isInstalled,
            isRunning: self.tailscaleService.isRunning,
            hostname: self.tailscaleService.tailscaleHostname)

        // Update Cloudflare status
        await self.cloudflareService.checkCloudflaredStatus()
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

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "ServerStatusSection")

    @State private var portConflict: PortConflict?
    @State private var isCheckingPort = false
    @State private var localIPAddress: String?
    @State private var isShowingKillPortConflictConfirm = false
    @State private var isKillingPortConflictProcess = false
    @State private var killPortConflictErrorMessage: String?

    private var isServerRunning: Bool {
        self.serverStatus == .running
    }

    private var serverPortInt: Int {
        Int(self.serverPort) ?? 4020
    }

    private var accessMode: DashboardAccessMode {
        DashboardAccessMode(rawValue: self.accessModeString) ?? .localhost
    }

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                // Server Information
                VStack(alignment: .leading, spacing: 8) {
                    LabeledContent("Status") {
                        switch self.serverStatus {
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
                        case let .error(message):
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
                        accessMode: self.accessMode,
                        accessModeString: self.$accessModeString,
                        serverPort: self.serverPort,
                        localIPAddress: self.localIPAddress,
                        restartServerWithNewBindAddress: self.restartServerWithNewBindAddress)

                    // Editable Port
                    PortConfigurationView(
                        serverPort: self.$serverPort,
                        restartServerWithNewPort: self.restartServerWithNewPort,
                        serverManager: self.serverManager)

                    LabeledContent("Bind Address") {
                        Text(self.serverManager.bindAddress)
                            .font(.system(.body, design: .monospaced))
                    }

                    LabeledContent("Base URL") {
                        let baseAddress = self.serverManager.bindAddress == "0.0.0.0" ? "127.0.0.1" : self.serverManager
                            .bindAddress
                        if let serverURL = URL(string: "http://\(baseAddress):\(serverPort)") {
                            Link("http://\(baseAddress):\(self.serverPort)", destination: serverURL)
                                .font(.system(.body, design: .monospaced))
                        } else {
                            Text("http://\(baseAddress):\(self.serverPort)")
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

                        if self.serverStatus == .stopped {
                            Button("Start") {
                                Task {
                                    await self.serverManager.start()
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                        } else if self.serverStatus == .running {
                            Button("Restart") {
                                Task {
                                    await self.serverManager.manualRestart()
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
                        HStack(spacing: 6) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.orange)
                                .font(.caption)

                            Text("Port \(conflict.port) is used by \(conflict.process.name)")
                                .font(.caption)
                                .foregroundColor(.orange)

                            Spacer(minLength: 8)

                            Button(role: .destructive) {
                                self.isShowingKillPortConflictConfirm = true
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.caption2.bold())
                                    .frame(width: 18, height: 18)
                                    .foregroundStyle(.white)
                                    .background(Color.red)
                                    .clipShape(Circle())
                            }
                            .buttonStyle(.plain)
                            .disabled(self.isKillingPortConflictProcess)
                            .help("Kill PID \(conflict.process.pid) (\(conflict.process.name))")
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
                                                serverManager: self.serverManager)
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
                                        self.portConflict = nil
                                        await self.serverManager.start()
                                    } catch {
                                        // Handle error - in a real implementation, you might show an alert
                                        self.logger.error("Failed to kill process: \(error)")
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
                    .confirmationDialog(
                        "Kill \(conflict.process.name) (PID \(conflict.process.pid))?",
                        isPresented: self.$isShowingKillPortConflictConfirm,
                        titleVisibility: .visible)
                    {
                        Button("Kill", role: .destructive) {
                            Task {
                                await self.killPortConflictProcess(conflict)
                            }
                        }
                        Button("Cancel", role: .cancel) {}
                    } message: {
                        Text("This will force-terminate the process currently listening on port \(conflict.port).")
                    }
                }
            }
            .padding(.vertical, 4)
            .task {
                await self.checkPortAvailability()
                await self.updateLocalIPAddress()
            }
            .task(id: self.serverPort) {
                await self.checkPortAvailability()
            }
            .task(id: self.accessModeString) {
                await self.updateLocalIPAddress()
            }
            .alert(
                "Failed to kill process",
                isPresented: Binding(
                    get: { self.killPortConflictErrorMessage != nil },
                    set: { if !$0 { self.killPortConflictErrorMessage = nil } }))
            {
                Button("OK", role: .cancel) {}
            } message: {
                Text(self.killPortConflictErrorMessage ?? "")
            }
        } header: {
            Text("Server Configuration")
                .font(.headline)
        } footer: {
            // Dashboard URL display
            if self.accessMode == .localhost {
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
            } else if self.accessMode == .network {
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
            await ServerConfigurationHelpers.restartServerWithNewPort(port, serverManager: self.serverManager)
        }
    }

    private func restartServerWithNewBindAddress() {
        Task {
            await ServerConfigurationHelpers.restartServerWithNewBindAddress(
                accessMode: self.accessMode,
                serverManager: self.serverManager)
        }
    }

    private func updateLocalIPAddress() async {
        self.localIPAddress = await ServerConfigurationHelpers.updateLocalIPAddress(accessMode: self.accessMode)
    }

    private func checkPortAvailability() async {
        self.isCheckingPort = true
        defer { isCheckingPort = false }

        let port = self.serverPortInt

        // Only check if it's not the port we're already successfully using
        if self.serverManager.isRunning, Int(self.serverManager.port) == port {
            self.portConflict = nil
            return
        }

        if let conflict = await PortConflictResolver.shared.detectConflict(on: port) {
            // Only show warning for non-VibeTunnel processes
            // VibeTunnel instances will be auto-killed by ServerManager
            if case .reportExternalApp = conflict.suggestedAction {
                self.portConflict = conflict
            } else {
                // It's our own process, will be handled automatically
                self.portConflict = nil
            }
        } else {
            self.portConflict = nil
        }
    }

    private func killPortConflictProcess(_ conflict: PortConflict) async {
        guard !self.isKillingPortConflictProcess else { return }
        self.isKillingPortConflictProcess = true
        defer { self.isKillingPortConflictProcess = false }

        do {
            try await PortConflictResolver.shared.forceKillProcess(conflict)
            await self.checkPortAvailability()

            if self.serverStatus == .stopped {
                await self.serverManager.start()
            }
        } catch {
            self.logger.error("Failed to kill port-conflicting process: \(String(describing: error))")
            self.killPortConflictErrorMessage = error.localizedDescription.isEmpty ? String(describing: error) : error
                .localizedDescription
        }
    }
}

// MARK: - Active Sessions Section

private struct ActiveSessionsSection: View {
    let activeSessions: [DashboardSessionInfo]
    let sessionService: SessionService

    var body: some View {
        Section {
            if self.activeSessions.isEmpty {
                Text("No active sessions")
                    .font(.callout)
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 8)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(self.activeSessions.prefix(5)) { session in
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

                    if self.activeSessions.count > 5 {
                        Text("And \(self.activeSessions.count - 5) more...")
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
                Text("\(self.activeSessions.count)")
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
    let tailscaleStatus: RemoteServicesStatusManager.TailscaleStatus?
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
                                url: "http://\(hostname):\(self.serverPort)")
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
                            url: status.publicUrl)
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
                if self.cloudflareService.isRunning, let url = cloudflareService.publicUrl {
                    HStack {
                        Image(systemName: "circle.fill")
                            .foregroundColor(.green)
                            .font(.system(size: 10))
                        Text("Cloudflare")
                            .font(.callout)
                        InlineClickableURLView(
                            label: "",
                            url: url)
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
