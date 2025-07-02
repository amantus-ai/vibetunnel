import AppKit
import SwiftUI

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
    @State private var isHoveringFolder = false
    @FocusState private var isEditFieldFocused: Bool

    var body: some View {
        Button(action: handleTap) {
            content
        }
        .buttonStyle(PlainButtonStyle())
        .onAppear {
            // First, try to get cached data synchronously
            if gitRepository == nil {
                gitRepository = gitRepositoryMonitor.getCachedRepository(for: session.value.workingDir)
            }
        }
        .task(id: session.value.workingDir) {
            // Then fetch fresh data asynchronously (this will update the cache)
            if let freshData = await gitRepositoryMonitor.findRepository(for: session.value.workingDir) {
                gitRepository = freshData
            }
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
                Circle()
                    .fill(activityColor)
                    .frame(width: 4, height: 4)
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
                                .truncationMode(.tail)
                        }

                        // Edit button (pencil icon) - only show on hover
                        if isHovered && !isEditing {
                            Button(action: startEditing) {
                                Image(systemName: "square.and.pencil")
                                    .font(.system(size: 11))
                                    .foregroundColor(.primary)
                            }
                            .buttonStyle(.plain)
                            .help("Rename session")
                        }
                    }

                    Spacer()

                    // Window indicator - only show globe if no window
                    if !hasWindow {
                        Image(systemName: "globe")
                            .font(.system(size: 10))
                            .foregroundColor(.secondary.opacity(0.6))
                    }
                }

                // Second row: Path, Git info, Duration and X button
                HStack(alignment: .center, spacing: 6) {
                    // Left side: Path and git info
                    HStack(alignment: .center, spacing: 6) {
                        // Folder icon and path - clickable as one unit
                        Button(action: {
                            NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: session.value.workingDir)
                        }) {
                            HStack(spacing: 4) {
                                Image(systemName: "folder")
                                    .font(.system(size: 10))
                                    .foregroundColor(.secondary)

                                Text(compactPath)
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundColor(.secondary)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(isHoveringFolder ? AppColors.Fallback.controlBackground(for: colorScheme)
                                        .opacity(0.15) : Color.clear
                                    )
                            )
                        }
                        .buttonStyle(.plain)
                        .onHover { hovering in
                            isHoveringFolder = hovering
                        }
                        .help("Open in Finder")

                        if let repo = gitRepository {
                            GitRepositoryRow(repository: repo)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    // Right side: Duration and X button overlay
                    ZStack {
                        // Duration label (hidden on hover)
                        if !duration.isEmpty && !isHovered && !isTerminating {
                            Text(duration)
                                .font(.system(size: 10))
                                .foregroundColor(.secondary.opacity(0.6))
                        }

                        // Show X button on hover (overlays duration)
                        if !isTerminating && isHovered {
                            Button(action: terminateSession) {
                                ZStack {
                                    Circle()
                                        .fill(AppColors.Fallback.destructive(for: colorScheme).opacity(0.1))
                                        .frame(width: 14, height: 14)
                                    Circle()
                                        .strokeBorder(
                                            AppColors.Fallback.destructive(for: colorScheme).opacity(0.3),
                                            lineWidth: 0.5
                                        )
                                        .frame(width: 14, height: 14)
                                    Image(systemName: "xmark")
                                        .font(.system(size: 8, weight: .medium))
                                        .foregroundColor(AppColors.Fallback.destructive(for: colorScheme).opacity(0.8))
                                }
                            }
                            .buttonStyle(.plain)
                        }

                        // Show progress indicator while terminating
                        if isTerminating {
                            ProgressView()
                                .scaleEffect(0.5)
                                .frame(width: 14, height: 14)
                        }
                    }
                    .frame(width: 30, height: 16)
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
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(isHovered ? hoverBackgroundColor : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(
                    isFocused ? AppColors.Fallback.accentHover(for: colorScheme).opacity(2) : Color.clear,
                    lineWidth: 1
                )
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
        isActive ? AppColors.Fallback.activityIndicator(for: colorScheme) : AppColors.Fallback
            .gitClean(for: colorScheme)
    }

    private var hasWindow: Bool {
        // Check if WindowTracker has found a window for this session
        // This includes both spawned terminals and those attached via vt
        WindowTracker.shared.windowInfo(for: session.key) != nil
    }

    private var hoverBackgroundColor: Color {
        AppColors.Fallback.accentHover(for: colorScheme)
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
