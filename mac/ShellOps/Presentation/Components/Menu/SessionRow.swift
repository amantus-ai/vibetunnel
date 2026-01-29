import AppKit
import OSLog
import SwiftUI

/// Row component displaying a single terminal session.
///
/// Shows session information including command, directory, git status,
/// status indicators, and provides interaction for opening, renaming,
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
    @State private var isHoveringFolder = false
    @FocusState private var isEditFieldFocused: Bool

    private static let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "SessionRow")

    /// Computed property that reads directly from the monitor's cache
    /// This will automatically update when the monitor refreshes
    private var gitRepository: GitRepository? {
        self.gitRepositoryMonitor.getCachedRepository(for: self.session.value.workingDir)
    }

    var body: some View {
        Button(action: self.handleTap) {
            self.content
        }
        .buttonStyle(PlainButtonStyle())
        .task(id: self.session.value.workingDir) {
            // Fetch repository data if not already cached
            if self.gitRepository == nil {
                _ = await self.gitRepositoryMonitor.findRepository(for: self.session.value.workingDir)
            }
        }
    }

    var content: some View {
        HStack(spacing: 8) {
            // Activity indicator with subtle glow
            ZStack {
                Circle()
                    .fill(self.activityColor.opacity(0.3))
                    .frame(width: 8, height: 8)
                    .blur(radius: 2)
                Circle()
                    .fill(self.activityColor)
                    .frame(width: 4, height: 4)
            }

            // Session info - use flexible width
            VStack(alignment: .leading, spacing: 2) {
                // First row: Command name, session name, and window indicator - FULL WIDTH
                HStack(spacing: 4) {
                    if self.isEditing {
                        TextField("Session Name", text: self.$editedName)
                            .font(.system(size: 12, weight: .medium))
                            .textFieldStyle(.plain)
                            .focused(self.$isEditFieldFocused)
                            .onSubmit {
                                self.saveSessionName()
                            }
                            .onKeyPress(.escape) {
                                self.cancelEditing()
                                return .handled
                            }
                    } else {
                        // Show command name
                        Text(self.commandName)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.primary)
                            .lineLimit(1)
                            .truncationMode(.tail)

                        // Show session name if available
                        if !self.session.value.name.isEmpty {
                            Text("–")
                                .font(.system(size: 12))
                                .foregroundColor(.secondary.opacity(0.6))

                            Text(self.session.value.name)
                                .font(.system(size: 12))
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                                .truncationMode(.tail)
                        }

                        // Edit button (pencil icon) - only show on hover
                        if self.isHovered, !self.isEditing {
                            HStack(spacing: 6) {
                                Button(action: self.startEditing) {
                                    Image(systemName: "square.and.pencil")
                                        .font(.system(size: 11))
                                        .foregroundColor(.primary)
                                }
                                .buttonStyle(.plain)
                                .help("Rename session")
                                .modifier(HoverOpacityModifier())

                                // Magic wand button for AI assistant sessions
                                if self.isAIAssistantSession {
                                    Button(action: self.sendAIPrompt) {
                                        Image(systemName: "wand.and.rays")
                                            .font(.system(size: 11))
                                            .foregroundColor(.primary)
                                    }
                                    .buttonStyle(.plain)
                                    .help("Send prompt to update terminal title")
                                    .modifier(HoverOpacityModifier())
                                }
                            }
                        }
                    }

                    Spacer()

                    // Window indicator - only show globe if no window
                    if !self.hasWindow {
                        Image(systemName: "globe")
                            .font(.system(size: 10))
                            .foregroundColor(.secondary.opacity(0.6))
                    }
                }

                // Second row: Path, Git info, Duration and X button
                HStack(alignment: .center, spacing: 6) {
                    // Left side: Path and git info
                    HStack(alignment: .center, spacing: 4) {
                        // Folder icon - clickable
                        Button(action: {
                            NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: self.session.value.workingDir)
                        }, label: {
                            Image(systemName: "folder")
                                .font(.system(size: 10))
                                .foregroundColor(self.isHoveringFolder ? .primary : .secondary)
                                .padding(4)
                                .background(
                                    RoundedRectangle(cornerRadius: 4)
                                        .fill(
                                            self.isHoveringFolder ? AppColors.Fallback
                                                .controlBackground(for: self.colorScheme)
                                                .opacity(0.3) : Color.clear))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 4)
                                        .strokeBorder(
                                            self.isHoveringFolder ? AppColors.Fallback.gitBorder(for: self.colorScheme)
                                                .opacity(0.4) : Color.clear,
                                            lineWidth: 0.5))
                        })
                        .buttonStyle(.plain)
                        .onHover { hovering in
                            self.isHoveringFolder = hovering
                        }
                        .help("Open in Finder")

                        // Path text - not clickable
                        Text(self.compactPath)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                            .truncationMode(.head)
                            .layoutPriority(-1) // Lowest priority

                        if let repo = gitRepository {
                            GitRepositoryRow(repository: repo)
                                .layoutPriority(1) // Highest priority
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    // Right side: Duration and X button overlay
                    ZStack {
                        // Duration label (hidden on hover)
                        if !self.duration.isEmpty, !self.isHovered, !self.isTerminating {
                            Text(self.duration)
                                .font(.system(size: 10))
                                .foregroundColor(.secondary.opacity(0.6))
                        }

                        // Show X button on hover (overlays duration)
                        if !self.isTerminating, self.isHovered {
                            Button(action: self.terminateSession) {
                                ZStack {
                                    Circle()
                                        .fill(AppColors.Fallback.destructive(for: self.colorScheme).opacity(0.1))
                                        .frame(width: 14, height: 14)
                                    Circle()
                                        .strokeBorder(
                                            AppColors.Fallback.destructive(for: self.colorScheme).opacity(0.3),
                                            lineWidth: 0.5)
                                        .frame(width: 14, height: 14)
                                    Image(systemName: "xmark")
                                        .font(.system(size: 8, weight: .medium))
                                        .foregroundColor(AppColors.Fallback.destructive(for: self.colorScheme)
                                            .opacity(0.8))
                                }
                            }
                            .buttonStyle(.plain)
                        }

                        // Show progress indicator while terminating
                        if self.isTerminating {
                            ProgressView()
                                .scaleEffect(0.5)
                                .frame(width: 14, height: 14)
                        }
                    }
                    .frame(width: 30, height: 16)
                }
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(self.isHovered ? self.hoverBackgroundColor : Color.clear))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(
                    self.isFocused ? AppColors.Fallback.accentHover(for: self.colorScheme).opacity(2) : Color.clear,
                    lineWidth: 1))
        .focusable()
        .help(self.tooltipText)
        .contextMenu {
            if self.hasWindow {
                Button("Focus Terminal Window") {
                    WindowTracker.shared.focusWindow(for: self.session.key)
                }
            } else {
                Button("Open in Browser") {
                    if let url = DashboardURLBuilder.dashboardURL(port: serverManager.port, sessionId: session.key) {
                        NSWorkspace.shared.open(url)
                    }
                }
            }

            Button("View Session Details") {
                self.openWindow(id: "session-detail", value: self.session.key)
            }

            Divider()

            Button("Show in Finder") {
                NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: self.session.value.workingDir)
            }

            // Add git repository options if available
            if let repo = gitRepository {
                Divider()

                // Open in Git app
                let gitAppName = self.getGitAppName()
                Button("Open in \(gitAppName)") {
                    GitAppLauncher.shared.openRepository(at: repo.path)
                }

                if repo.githubURL != nil {
                    Button("Open on GitHub") {
                        if let url = repo.githubURL {
                            NSWorkspace.shared.open(url)
                        }
                    }
                }

                Divider()

                Button("Copy Branch Name") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(repo.currentBranch ?? "detached", forType: .string)
                }

                Button("Copy Repository Path") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(repo.path, forType: .string)
                }
            }

            Divider()

            Button("Rename Session...") {
                self.startEditing()
            }

            Divider()

            Button("Kill Session", role: .destructive) {
                self.terminateSession()
            }

            Divider()

            Button("Copy Session ID") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(self.session.key, forType: .string)
            }
        }
    }

    private func handleTap() {
        guard !self.isEditing else { return }

        if self.hasWindow {
            WindowTracker.shared.focusWindow(for: self.session.key)
        } else {
            // Open browser for sessions without windows
            if let url = DashboardURLBuilder.dashboardURL(port: serverManager.port, sessionId: session.key) {
                NSWorkspace.shared.open(url)
            }
        }
    }

    private func getGitAppName() -> String {
        GitAppHelper.getPreferredGitAppName()
    }

    private func terminateSession() {
        self.isTerminating = true

        Task {
            do {
                try await self.sessionService.terminateSession(sessionId: self.session.key)
                // Session terminated successfully
                // The session monitor will automatically update
            } catch {
                // Handle error
                Self.logger.error("Failed to terminate session \(self.session.key): \(error)")
                await MainActor.run {
                    self.isTerminating = false
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
            if self.session.value.command.count > 2,
               self.session.value.command.contains("-c"),
               let cIndex = session.value.command.firstIndex(of: "-c"),
               cIndex + 1 < session.value.command.count
            {
                let actualCommand = self.session.value.command[cIndex + 1]
                return (actualCommand as NSString).lastPathComponent
            }
            return executableName
        default:
            return executableName
        }
    }

    private var isAIAssistantSession: Bool {
        // Check if this is an AI assistant session by looking at the command
        let aiAssistants = ["claude", "gemini", "openhands", "aider", "codex"]
        let cmd = self.commandName.lowercased()

        // Match exact executable names or at word boundaries
        return aiAssistants.contains { ai in
            cmd == ai ||
                cmd.hasPrefix(ai + ".") || // e.g., claude.exe
                cmd.hasPrefix(ai + "-wrapper") // e.g., claude-wrapper
        }
    }

    private var sessionName: String {
        // Use the session name if available, otherwise fall back to directory name
        if !self.session.value.name.isEmpty {
            return self.session.value.name
        }
        let workingDir = self.session.value.workingDir
        return (workingDir as NSString).lastPathComponent
    }

    private func startEditing() {
        self.editedName = self.session.value.name
        self.isEditing = true
        self.isEditFieldFocused = true
    }

    private func cancelEditing() {
        self.isEditing = false
        self.editedName = ""
        self.isEditFieldFocused = false
    }

    private func saveSessionName() {
        let trimmedName = self.editedName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            self.cancelEditing()
            return
        }

        // Update the session name via SessionService
        Task {
            do {
                try await self.sessionService.renameSession(sessionId: self.session.key, to: trimmedName)

                // Clear editing state after successful update
                await MainActor.run {
                    self.isEditing = false
                    self.editedName = ""
                    self.isEditFieldFocused = false
                }
            } catch {
                // Error already handled - editing state reverted
                self.cancelEditing()
            }
        }
    }

    private func sendAIPrompt() {
        Task {
            do {
                // Send a prompt that encourages the AI assistant to use vt title
                let prompt = "use vt title to update the terminal title with what you're currently working on"
                try await sessionService.sendInput(to: self.session.key, text: prompt)

                // Send Enter key to submit the prompt
                try await self.sessionService.sendKey(to: self.session.key, key: "enter")
            } catch {
                // Silently handle errors for now
                Self.logger.error("Failed to send prompt to AI assistant: \(error)")
            }
        }
    }

    private var compactPath: String {
        let path = self.session.value.workingDir
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
        self.isActive
            ? AppColors.Fallback.activityIndicator(for: self.colorScheme)
            : AppColors.Fallback.gitClean(for: self.colorScheme)
    }

    private var hasWindow: Bool {
        // Check if WindowTracker has found a window for this session
        // This includes both spawned terminals and those attached via vt
        WindowTracker.shared.windowInfo(for: self.session.key) != nil
    }

    private var hoverBackgroundColor: Color {
        AppColors.Fallback.accentHover(for: self.colorScheme)
    }

    private var tooltipText: String {
        var tooltip = ""

        // Session name
        if !self.session.value.name.isEmpty {
            tooltip += "Session: \(self.session.value.name)\n"
        }

        // Command
        tooltip += "Command: \(self.session.value.command.joined(separator: " "))\n"

        // Project path
        tooltip += "Path: \(self.session.value.workingDir)\n"

        // Git info
        if let repo = gitRepository {
            tooltip += "Git: \(repo.currentBranch ?? "detached")"
            if repo.hasChanges {
                tooltip += " (\(repo.statusText))"
            }
            tooltip += "\n"
        }

        // Status
        tooltip += "Status: \(self.session.value.status)\n"

        // Duration
        tooltip += "Duration: \(self.formattedDuration)"

        return tooltip
    }

    private var formattedDuration: String {
        // Parse ISO8601 date string with fractional seconds
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        guard let startDate = formatter.date(from: session.value.startedAt) else {
            // Fallback: try without fractional seconds
            formatter.formatOptions = [.withInternetDateTime]
            guard let startDate = formatter.date(from: session.value.startedAt) else {
                return "unknown"
            }
            return self.formatLongDuration(from: startDate)
        }

        return self.formatLongDuration(from: startDate)
    }

    private func formatLongDuration(from startDate: Date) -> String {
        let elapsed = Date().timeIntervalSince(startDate)

        if elapsed < 60 {
            return "just started"
        } else if elapsed < 3600 {
            let minutes = Int(elapsed / 60)
            return "\(minutes) minute\(minutes == 1 ? "" : "s")"
        } else if elapsed < 86400 {
            let hours = Int(elapsed / 3600)
            let minutes = Int((elapsed.truncatingRemainder(dividingBy: 3600)) / 60)
            if minutes > 0 {
                return "\(hours) hour\(hours == 1 ? "" : "s") \(minutes) minute\(minutes == 1 ? "" : "s")"
            }
            return "\(hours) hour\(hours == 1 ? "" : "s")"
        } else {
            let days = Int(elapsed / 86400)
            let hours = Int((elapsed.truncatingRemainder(dividingBy: 86400)) / 3600)
            if hours > 0 {
                return "\(days) day\(days == 1 ? "" : "s") \(hours) hour\(hours == 1 ? "" : "s")"
            }
            return "\(days) day\(days == 1 ? "" : "s")"
        }
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
            return self.formatDuration(from: startDate)
        }

        return self.formatDuration(from: startDate)
    }

    private func formatDuration(from startDate: Date) -> String {
        let elapsed = Date().timeIntervalSince(startDate)

        if elapsed < 60 {
            return "now"
        } else if elapsed < 3600 {
            let minutes = Int(elapsed / 60)
            return "\(minutes)m"
        } else if elapsed < 86400 {
            let hours = Int(elapsed / 3600)
            return "\(hours)h"
        } else {
            let days = Int(elapsed / 86400)
            return "\(days)d"
        }
    }
}

/// Modifier that makes an element fully opaque on hover
struct HoverOpacityModifier: ViewModifier {
    @State private var isHovering = false

    func body(content: Content) -> some View {
        content
            .opacity(self.isHovering ? 1.0 : 0.5)
            .scaleEffect(self.isHovering ? 1.0 : 0.95)
            .animation(.easeInOut(duration: 0.15), value: self.isHovering)
            .onHover { hovering in
                self.isHovering = hovering
            }
    }
}
