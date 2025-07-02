import AppKit
import SwiftUI

/// Main menu view displayed when left-clicking the status bar item.
/// Shows server status, session list, and quick actions in a rich interface.
struct VibeTunnelMenuView: View {
    @Environment(SessionMonitor.self)
    var sessionMonitor
    @Environment(ServerManager.self)
    var serverManager
    @Environment(NgrokService.self)
    var ngrokService
    @Environment(TailscaleService.self)
    var tailscaleService
    @Environment(GitRepositoryMonitor.self)
    var gitRepositoryMonitor
    @Environment(\.openWindow)
    private var openWindow
    @Environment(\.colorScheme)
    private var colorScheme

    @State private var hoveredSessionId: String?
    @State private var hasStartedKeyboardNavigation = false
    @State private var showingNewSession = false
    @FocusState private var focusedField: FocusField?

    /// Binding to allow external control of new session state
    @Binding var isNewSessionActive: Bool

    init(isNewSessionActive: Binding<Bool> = .constant(false)) {
        self._isNewSessionActive = isNewSessionActive
    }

    enum FocusField: Hashable {
        case sessionRow(String)
        case settingsButton
        case newSessionButton
        case quitButton
    }

    var body: some View {
        if showingNewSession {
            NewSessionForm(isPresented: Binding(
                get: { showingNewSession },
                set: { newValue in
                    showingNewSession = newValue
                    isNewSessionActive = newValue
                }
            ))
            .transition(.asymmetric(
                insertion: .move(edge: .bottom).combined(with: .opacity),
                removal: .move(edge: .bottom).combined(with: .opacity)
            ))
        } else {
            mainContent
                .transition(.asymmetric(
                    insertion: .opacity,
                    removal: .opacity
                ))
        }
    }

    private var mainContent: some View {
        VStack(spacing: 0) {
            // Header with server info
            ServerInfoHeader()
                .padding()
                .background(
                    LinearGradient(
                        colors: colorScheme == .dark ? [
                            Color(NSColor.controlBackgroundColor).opacity(0.6),
                            Color(NSColor.controlBackgroundColor).opacity(0.3)
                        ] : [
                            Color(NSColor.controlBackgroundColor),
                            Color(NSColor.controlBackgroundColor).opacity(0.8)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )

            Divider()

            // Session list
            ScrollView {
                VStack(spacing: 1) {
                    if activeSessions.isEmpty && idleSessions.isEmpty {
                        EmptySessionsView()
                            .padding()
                            .transition(.opacity.combined(with: .scale(scale: 0.95)))
                    } else {
                        // Active sessions section
                        if !activeSessions.isEmpty {
                            SessionSectionHeader(title: "Active", count: activeSessions.count)
                                .transition(.opacity)
                            ForEach(activeSessions, id: \.key) { session in
                                SessionRow(
                                    session: session,
                                    isHovered: hoveredSessionId == session.key,
                                    isActive: true,
                                    isFocused: focusedField == .sessionRow(session.key) && hasStartedKeyboardNavigation
                                )
                                .onHover { hovering in
                                    hoveredSessionId = hovering ? session.key : nil
                                }
                                .focused($focusedField, equals: .sessionRow(session.key))
                                .transition(.asymmetric(
                                    insertion: .opacity.combined(with: .move(edge: .top)),
                                    removal: .opacity.combined(with: .move(edge: .bottom))
                                ))
                            }
                        }

                        // Idle sessions section
                        if !idleSessions.isEmpty {
                            if !activeSessions.isEmpty {
                                Divider()
                                    .padding(.vertical, 4)
                                    .transition(.opacity)
                            }

                            SessionSectionHeader(title: "Idle", count: idleSessions.count)
                                .transition(.opacity)
                            ForEach(idleSessions, id: \.key) { session in
                                SessionRow(
                                    session: session,
                                    isHovered: hoveredSessionId == session.key,
                                    isActive: false,
                                    isFocused: focusedField == .sessionRow(session.key) && hasStartedKeyboardNavigation
                                )
                                .onHover { hovering in
                                    hoveredSessionId = hovering ? session.key : nil
                                }
                                .focused($focusedField, equals: .sessionRow(session.key))
                                .transition(.asymmetric(
                                    insertion: .opacity.combined(with: .move(edge: .bottom)),
                                    removal: .opacity.combined(with: .move(edge: .top))
                                ))
                            }
                        }
                    }
                }
                .padding(.vertical, 4)
                .animation(.easeInOut(duration: 0.3), value: sessionMonitor.sessions.keys.sorted())
            }
            .frame(maxHeight: 400)

            Divider()

            // Bottom actions
            HStack {
                Button(action: {
                    withAnimation(.easeOut(duration: 0.2)) {
                        showingNewSession = true
                        isNewSessionActive = true
                    }
                }) {
                    Label("New Session", systemImage: "plus.square")
                        .font(.system(size: 12))
                }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)
                .focusable()
                .focused($focusedField, equals: .newSessionButton)
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .strokeBorder(
                            focusedField == .newSessionButton && hasStartedKeyboardNavigation ? Color.accentColor
                                .opacity(0.3) : Color.clear,
                            lineWidth: 1
                        )
                        .animation(.easeInOut(duration: 0.15), value: focusedField)
                )

                Spacer()

                Button(action: {
                    SettingsOpener.openSettings()
                }) {
                    Label("Settings", systemImage: "gear")
                        .font(.system(size: 12))
                }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)
                .focusable()
                .focused($focusedField, equals: .settingsButton)
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .strokeBorder(
                            focusedField == .settingsButton && hasStartedKeyboardNavigation ? Color.accentColor
                                .opacity(0.3) : Color.clear,
                            lineWidth: 1
                        )
                        .animation(.easeInOut(duration: 0.15), value: focusedField)
                )

                Spacer()

                Button(action: {
                    NSApplication.shared.terminate(nil)
                }) {
                    Label("Quit", systemImage: "power")
                        .font(.system(size: 12))
                }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)
                .focusable()
                .focused($focusedField, equals: .quitButton)
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .strokeBorder(
                            focusedField == .quitButton && hasStartedKeyboardNavigation ? Color.accentColor
                                .opacity(0.3) : Color.clear,
                            lineWidth: 1
                        )
                        .animation(.easeInOut(duration: 0.15), value: focusedField)
                )
            }
            .padding()
        }
        .frame(width: 384)
        .background(Color.clear)
        .onAppear {
            gitRepositoryMonitor.startMonitoring()
        }
        .onDisappear {
            gitRepositoryMonitor.stopMonitoring()
        }
        .onKeyPress { keyPress in
            if keyPress.key == .tab && !hasStartedKeyboardNavigation {
                hasStartedKeyboardNavigation = true
                // Let the system handle the Tab to actually move focus
                return .ignored
            }
            return .ignored
        }
    }

    private var activeSessions: [(key: String, value: ServerSessionInfo)] {
        sessionMonitor.sessions
            .filter { $0.value.isRunning && hasActivity($0.value) }
            .sorted { $0.value.startedAt > $1.value.startedAt }
    }

    private var idleSessions: [(key: String, value: ServerSessionInfo)] {
        sessionMonitor.sessions
            .filter { $0.value.isRunning && !hasActivity($0.value) }
            .sorted { $0.value.startedAt > $1.value.startedAt }
    }

    private func hasActivity(_ session: ServerSessionInfo) -> Bool {
        if let activityStatus = session.activityStatus?.specificStatus?.status {
            return !activityStatus.isEmpty
        }
        return false
    }
}

// MARK: - Server Info Header

/// Header section of the menu showing server status and connection info.
///
/// Displays the VibeTunnel logo, server running status, and available
/// connection addresses including local, ngrok, and Tailscale endpoints.
struct ServerInfoHeader: View {
    @Environment(ServerManager.self)
    var serverManager
    @Environment(NgrokService.self)
    var ngrokService
    @Environment(TailscaleService.self)
    var tailscaleService
    @Environment(\.colorScheme)
    private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Title and status
            HStack {
                HStack(spacing: 8) {
                    Image(nsImage: NSImage(named: "AppIcon") ?? NSImage())
                        .resizable()
                        .frame(width: 24, height: 24)
                        .cornerRadius(4)

                    Text("VibeTunnel")
                        .font(.system(size: 14, weight: .semibold))
                }

                Spacer()

                ServerStatusBadge(isRunning: serverManager.isRunning)
            }

            // Server address
            if serverManager.isRunning {
                VStack(alignment: .leading, spacing: 4) {
                    ServerAddressRow()

                    if ngrokService.isActive, let publicURL = ngrokService.publicUrl {
                        ServerAddressRow(
                            icon: "network",
                            label: "ngrok:",
                            address: publicURL,
                            url: URL(string: publicURL)
                        )
                    }

                    if tailscaleService.isRunning, let hostname = tailscaleService.tailscaleHostname {
                        ServerAddressRow(
                            icon: "shield",
                            label: "Tailscale:",
                            address: hostname,
                            url: URL(string: "http://\(hostname):\(serverManager.port)")
                        )
                    }
                }
            }
        }
    }
}

/// Displays a clickable server address with an icon and label.
///
/// Shows connection endpoints that can be clicked to open in the browser,
/// with support for local addresses, ngrok tunnels, and Tailscale connections.
struct ServerAddressRow: View {
    let icon: String
    let label: String
    let address: String
    let url: URL?

    @Environment(ServerManager.self)
    var serverManager
    @Environment(\.colorScheme)
    private var colorScheme

    init(
        icon: String = "server.rack",
        label: String = "Local:",
        address: String? = nil,
        url: URL? = nil
    ) {
        self.icon = icon
        self.label = label
        self.address = address ?? ""
        self.url = url
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 10))
                .foregroundColor(AppColors.Fallback.serverRunning(for: colorScheme))
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(.secondary)
            Button(action: {
                if let providedUrl = url {
                    NSWorkspace.shared.open(providedUrl)
                } else if computedAddress.starts(with: "127.0.0.1:") {
                    // For localhost, use DashboardURLBuilder
                    if let dashboardURL = DashboardURLBuilder.dashboardURL(port: serverManager.port) {
                        NSWorkspace.shared.open(dashboardURL)
                    }
                } else if let url = URL(string: "http://\(computedAddress)") {
                    // For other addresses (network IP, etc.), construct URL directly
                    NSWorkspace.shared.open(url)
                }
            }) {
                Text(computedAddress)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(AppColors.Fallback.serverRunning(for: colorScheme))
                    .underline()
            }
            .buttonStyle(.plain)
            .pointingHandCursor()
        }
    }

    private var computedAddress: String {
        if !address.isEmpty {
            return address
        }

        // Default behavior for local server
        let bindAddress = serverManager.bindAddress
        if bindAddress == "127.0.0.1" {
            return "127.0.0.1:\(serverManager.port)"
        } else if let localIP = NetworkUtility.getLocalIPAddress() {
            return "\(localIP):\(serverManager.port)"
        } else {
            return "0.0.0.0:\(serverManager.port)"
        }
    }
}

/// Visual indicator for server running status.
///
/// Shows a colored badge with status text indicating whether
/// the VibeTunnel server is currently running or stopped.
struct ServerStatusBadge: View {
    let isRunning: Bool
    @Environment(\.colorScheme)
    private var colorScheme

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(isRunning ? AppColors.Fallback.serverRunning(for: colorScheme) : Color.red)
                .frame(width: 6, height: 6)
            Text(isRunning ? "Running" : "Stopped")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(isRunning ? AppColors.Fallback.serverRunning(for: colorScheme) : .red)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            Capsule()
                .fill(isRunning ? AppColors.Fallback.serverRunning(for: colorScheme).opacity(0.1) : Color.red.opacity(0.1))
                .overlay(
                    Capsule()
                        .stroke(
                            isRunning ? AppColors.Fallback.serverRunning(for: colorScheme).opacity(0.3) : Color.red.opacity(0.3),
                            lineWidth: 0.5
                        )
                )
        )
    }
}

// MARK: - Session Components

/// Section header for grouping sessions by status.
///
/// Displays a section title (Active/Idle) with a count of sessions
/// in that category for better visual organization.
struct SessionSectionHeader: View {
    let title: String
    let count: Int

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.secondary)
            Text("(\(count))")
                .font(.system(size: 11))
                .foregroundColor(Color.secondary.opacity(0.6))
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
    }
}

/// Row component displaying a single terminal session.
///
/// Shows session information including command, directory, git status,
/// activity indicators, and provides interaction for opening, renaming,
/// and terminating sessions. Supports both window and web-based sessions.
struct SessionRow: View {
    let session: (key: String, value: ServerSessionInfo)
    let isHovered: Bool
    let isActive: Bool
    let isFocused: Bool

    @Environment(\.openWindow)
    private var openWindow
    @Environment(ServerManager.self)
    private var serverManager
    @Environment(SessionMonitor.self)
    private var sessionMonitor
    @Environment(SessionService.self)
    private var sessionService
    @Environment(GitRepositoryMonitor.self)
    private var gitRepositoryMonitor
    @Environment(\.colorScheme)
    private var colorScheme
    @State private var isTerminating = false
    @State private var isEditing = false
    @State private var editedName = ""
    @State private var gitRepository: GitRepository?
    @State private var isHoveringGitFolder = false
    @FocusState private var isEditFieldFocused: Bool

    var body: some View {
        Button(action: handleTap) {
            content
        }
        .buttonStyle(PlainButtonStyle())
        .task(id: session.value.workingDir) {
            // Fetch git repository info for this session - will return cached data immediately
            gitRepository = await gitRepositoryMonitor.findRepository(for: session.value.workingDir)
        }
    }

    var content: some View {
        HStack(spacing: 8) {
            // Activity indicator with subtle glow
            ZStack {
                Circle()
                    .fill(activityColor.opacity(0.3))
                    .frame(width: 8, height: 8)
                    .blur(radius: 2)
                    .animation(.easeInOut(duration: 0.4), value: activityColor)
                Circle()
                    .fill(activityColor)
                    .frame(width: 4, height: 4)
                    .animation(.easeInOut(duration: 0.4), value: activityColor)
            }

            // Session info - use flexible width
            VStack(alignment: .leading, spacing: 2) {
                // First row: Command name, session name, and window indicator - FULL WIDTH
                HStack(spacing: 4) {
                    if isEditing {
                        TextField("Session Name", text: $editedName)
                            .font(.system(size: 12, weight: .medium))
                            .textFieldStyle(.plain)
                            .focused($isEditFieldFocused)
                            .onSubmit {
                                saveSessionName()
                            }
                            .onKeyPress(.escape) {
                                cancelEditing()
                                return .handled
                            }
                    } else {
                        // Show command name
                        Text(commandName)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.primary)
                            .lineLimit(1)
                            .truncationMode(.tail)

                        // Show session name if available
                        if let name = session.value.name, !name.isEmpty {
                            Text("–")
                                .font(.system(size: 12))
                                .foregroundColor(.secondary.opacity(0.6))

                            Text(name)
                                .font(.system(size: 12))
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                                .layoutPriority(1)
                        }

                        // Show edit icon on hover when not editing
                        if isHovered && !isEditing && !isTerminating {
                            Button(action: startEditing) {
                                Image(systemName: "square.and.pencil")
                                    .font(.system(size: 10))
                                    .foregroundColor(.secondary.opacity(0.6))
                            }
                            .buttonStyle(.plain)
                            .transition(.scale.combined(with: .opacity))
                        }
                    }

                    Spacer(minLength: 4)

                    if !hasWindow {
                        Image(systemName: "globe")
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                            .opacity(0.8)
                    }
                }

                // Second row: Path/git info on left, time/close on right
                HStack(spacing: 0) {
                    // Left side: folder, path, git info
                    HStack(spacing: 0) {
                        // Clickable folder icon
                        Image(systemName: gitRepository != nil ? "folder.badge.gearshape" : "folder")
                            .font(.system(size: 9))
                            .foregroundColor(isHoveringGitFolder ? Color(red: 0.0, green: 0.5, blue: 0.0) : .secondary)
                            .scaleEffect(isHoveringGitFolder ? 1.1 : 1.0)
                            .animation(.easeInOut(duration: 0.15), value: isHoveringGitFolder)
                            .onTapGesture {
                                let pathToOpen = gitRepository?.path ?? session.value.workingDir
                                NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: pathToOpen)
                            }
                            .onHover { hovering in
                                withTransaction(Transaction(animation: nil)) {
                                    isHoveringGitFolder = hovering
                                }
                                if hovering {
                                    NSCursor.pointingHand.push()
                                } else {
                                    NSCursor.pop()
                                }
                            }
                        
                        Text(" ")
                            .font(.system(size: 10))
                        
                        // Path
                        Text(compactPath)
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        
                        // Git info inline with branch symbol
                        if let repo = gitRepository {
                            Text(" ⎇ ")
                                .font(.system(size: 10))
                                .foregroundColor(.secondary.opacity(0.6))
                            
                            if let branch = repo.currentBranch {
                                Text(branch)
                                    .font(.system(size: 10))
                                    .foregroundColor(AppColors.Fallback.gitBranch(for: colorScheme))
                            }
                            
                            if repo.hasChanges {
                                Text(" • ")
                                    .font(.system(size: 10))
                                    .foregroundColor(.secondary.opacity(0.6))
                                
                                Text(repo.statusText)
                                    .font(.system(size: 10))
                                    .foregroundColor(AppColors.Fallback.gitChanges(for: colorScheme))
                            }
                        }
                    }
                    
                    Spacer(minLength: 8)
                    
                    // Right side: time/close button
                    ZStack {
                        if isHovered && !isTerminating {
                            // Show X button on hover
                            Button(action: terminateSession) {
                                ZStack {
                                    Circle()
                                        .fill(Color.red.opacity(0.1))
                                        .frame(width: 16, height: 16)
                                    Circle()
                                        .strokeBorder(Color.red.opacity(0.3), lineWidth: 0.5)
                                        .frame(width: 16, height: 16)
                                    Image(systemName: "xmark")
                                        .font(.system(size: 9, weight: .medium))
                                        .foregroundColor(.red.opacity(0.8))
                                }
                            }
                            .buttonStyle(.plain)
                            .transition(.scale.combined(with: .opacity))
                        } else if isTerminating {
                            // Show progress indicator while terminating
                            ProgressView()
                                .scaleEffect(0.6)
                                .frame(width: 14, height: 14)
                        } else {
                            // Show time when not hovering
                            Text(duration)
                                .font(.system(size: 10))
                                .foregroundColor(Color.secondary.opacity(0.6))
                                .transition(.opacity)
                        }
                    }
                    .frame(width: 40, alignment: .trailing)
                    .animation(.easeInOut(duration: 0.15), value: isHovered)
                }
                
                // Third row: Activity status (if present)
                if let activityStatus = session.value.activityStatus?.specificStatus?.status {
                    HStack(spacing: 4) {
                        Text(activityStatus)
                            .font(.system(size: 10))
                            .foregroundColor(AppColors.Fallback.activityIndicator(for: colorScheme))
                            .lineLimit(1)
                            .truncationMode(.tail)
                        
                        Spacer()
                    }
                }
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(isHovered ? hoverBackgroundColor : Color.clear)
                .animation(.easeInOut(duration: 0.15), value: isHovered)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(
                    isFocused ? Color.accentColor.opacity(0.3) : Color.clear,
                    lineWidth: 1
                )
                .animation(.easeInOut(duration: 0.15), value: isFocused)
        )
        .focusable()
        .contextMenu {
            if hasWindow {
                Button("Focus Terminal Window") {
                    WindowTracker.shared.focusWindow(for: session.key)
                }
            } else {
                Button("Open in Browser") {
                    if let url = DashboardURLBuilder.dashboardURL(port: serverManager.port, sessionId: session.key) {
                        NSWorkspace.shared.open(url)
                    }
                }
            }

            Button("View Session Details") {
                openWindow(id: "session-detail", value: session.key)
            }

            Button("Show in Finder") {
                NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: session.value.workingDir)
            }

            // Add git repository options if available
            if let repo = gitRepository {
                Button("Open Git Repository in Finder") {
                    NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: repo.path)
                }

                if repo.githubURL != nil {
                    Button("Open on GitHub") {
                        if let url = repo.githubURL {
                            NSWorkspace.shared.open(url)
                        }
                    }
                }
            }

            Button("Rename Session...") {
                startEditing()
            }

            Divider()

            Button("Kill Session", role: .destructive) {
                terminateSession()
            }

            Divider()

            Button("Copy Session ID") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(session.key, forType: .string)
            }
        }
    }

    private func handleTap() {
        guard !isEditing else { return }

        if hasWindow {
            WindowTracker.shared.focusWindow(for: session.key)
        } else {
            // Open browser for sessions without windows
            if let url = DashboardURLBuilder.dashboardURL(port: serverManager.port, sessionId: session.key) {
                NSWorkspace.shared.open(url)
            }
        }
    }

    private func terminateSession() {
        isTerminating = true

        Task {
            do {
                try await sessionService.terminateSession(sessionId: session.key)
                // Session terminated successfully
                // The session monitor will automatically update
            } catch {
                // Handle error
                await MainActor.run {
                    isTerminating = false
                }
                // Error terminating session - reset state
            }
        }
    }

    private var commandName: String {
        // Extract the process name from the command
        guard let firstCommand = session.value.command.first else {
            return "Unknown"
        }

        // Extract just the executable name from the path
        let executableName = (firstCommand as NSString).lastPathComponent

        // Special handling for common commands
        switch executableName {
        case "zsh", "bash", "sh":
            // For shells, check if there's a -c argument with the actual command
            if session.value.command.count > 2,
               session.value.command.contains("-c"),
               let cIndex = session.value.command.firstIndex(of: "-c"),
               cIndex + 1 < session.value.command.count
            {
                let actualCommand = session.value.command[cIndex + 1]
                return (actualCommand as NSString).lastPathComponent
            }
            return executableName
        default:
            return executableName
        }
    }

    private var sessionName: String {
        // Use the session name if available, otherwise fall back to directory name
        if let name = session.value.name, !name.isEmpty {
            return name
        }
        let workingDir = session.value.workingDir
        return (workingDir as NSString).lastPathComponent
    }

    private func startEditing() {
        editedName = session.value.name ?? ""
        isEditing = true
        isEditFieldFocused = true
    }

    private func cancelEditing() {
        isEditing = false
        editedName = ""
        isEditFieldFocused = false
    }

    private func saveSessionName() {
        let trimmedName = editedName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            cancelEditing()
            return
        }

        // Update the session name via SessionService
        Task {
            do {
                try await sessionService.renameSession(sessionId: session.key, to: trimmedName)

                // Clear editing state after successful update
                await MainActor.run {
                    isEditing = false
                    editedName = ""
                    isEditFieldFocused = false
                }
            } catch {
                // Error already handled - editing state reverted
                cancelEditing()
            }
        }
    }

    private var compactPath: String {
        let path = session.value.workingDir
        let homeDir = NSHomeDirectory()

        if path.hasPrefix(homeDir) {
            let relativePath = String(path.dropFirst(homeDir.count))
            return "~" + relativePath
        }

        let components = (path as NSString).pathComponents
        if components.count > 2 {
            let lastTwo = components.suffix(2).joined(separator: "/")
            return ".../" + lastTwo
        }

        return path
    }

    private var activityColor: Color {
        if isActive {
            AppColors.Fallback.activityIndicator(for: colorScheme)
        } else {
            AppColors.Fallback.gitClean(for: colorScheme)
        }
    }

    private var hasWindow: Bool {
        // Check if WindowTracker has a window registered for this session
        WindowTracker.shared.windowInfo(for: session.key) != nil
    }

    private var hoverBackgroundColor: Color {
        colorScheme == .dark ? Color.accentColor.opacity(0.08) : Color.accentColor.opacity(0.15)
    }

    private var duration: String {
        // Parse ISO8601 date string with fractional seconds
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        guard let startDate = formatter.date(from: session.value.startedAt) else {
            // Fallback: try without fractional seconds
            formatter.formatOptions = [.withInternetDateTime]
            guard let startDate = formatter.date(from: session.value.startedAt) else {
                return "" // Return empty string instead of "unknown"
            }
            return formatDuration(from: startDate)
        }

        return formatDuration(from: startDate)
    }

    private func formatDuration(from startDate: Date) -> String {
        let elapsed = Date().timeIntervalSince(startDate)

        if elapsed < 60 {
            return "now"
        } else if elapsed < 3_600 {
            let minutes = Int(elapsed / 60)
            return "\(minutes)m"
        } else if elapsed < 86_400 {
            let hours = Int(elapsed / 3_600)
            return "\(hours)h"
        } else {
            let days = Int(elapsed / 86_400)
            return "\(days)d"
        }
    }
}

// MARK: - Git Repository Row

/// Displays git repository information in a compact row.
///
/// Shows repository folder name, current branch, and change status
/// with clickable navigation to open the repository in Finder.
struct GitRepositoryRow: View {
    let repository: GitRepository
    @State private var isHovering = false
    @Environment(\.colorScheme)
    private var colorScheme

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "folder.badge.gearshape")
                .font(.system(size: 10))
                .foregroundColor(repository.hasChanges ? AppColors.Fallback.gitChanges(for: colorScheme) : AppColors.Fallback.gitClean(for: colorScheme))

            Text("Git:")
                .font(.system(size: 11))
                .foregroundColor(.secondary)

            Button(action: {
                NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: repository.path)
            }) {
                HStack(spacing: 4) {
                    Text(repository.folderName)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(isHovering ? .accentColor : .primary)
                        .underline(isHovering)

                    if let branch = repository.currentBranch {
                        Text("(\(branch))")
                            .font(.system(size: 11))
                            .foregroundColor(AppColors.Fallback.gitBranch(for: colorScheme))
                    }

                    if repository.hasChanges {
                        Text("• \(repository.statusText)")
                            .font(.system(size: 11))
                            .foregroundColor(AppColors.Fallback.gitChanges(for: colorScheme))
                    }
                }
            }
            .buttonStyle(.plain)
            .pointingHandCursor()
            .onHover { hovering in
                isHovering = hovering
            }
        }
    }
}

/// Placeholder view shown when no sessions are active.
///
/// Displays a friendly message with an animated terminal icon
/// and optional link to open the dashboard when the server is running.
struct EmptySessionsView: View {
    @Environment(ServerManager.self)
    var serverManager
    @State private var isAnimating = false

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "terminal")
                .font(.system(size: 32))
                .foregroundStyle(
                    LinearGradient(
                        colors: [Color.secondary, Color.secondary.opacity(0.6)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .scaleEffect(isAnimating ? 1.05 : 1.0)
                .animation(.easeInOut(duration: 2).repeatForever(autoreverses: true), value: isAnimating)
                .onAppear { isAnimating = true }

            Text("No active sessions")
                .font(.system(size: 12))
                .foregroundColor(.secondary)

            if serverManager.isRunning {
                Button("Open Dashboard") {
                    if let url = DashboardURLBuilder.dashboardURL(port: serverManager.port) {
                        NSWorkspace.shared.open(url)
                    }
                }
                .buttonStyle(.link)
                .font(.system(size: 11))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
    }
}
