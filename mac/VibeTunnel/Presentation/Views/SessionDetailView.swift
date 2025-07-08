import ApplicationServices
import os
@preconcurrency import ScreenCaptureKit
import SwiftUI

/// View displaying detailed information about a specific terminal session.
///
/// Shows comprehensive session information including process details, status,
/// working directory, command history, and timestamps. Provides a detailed
/// debugging and monitoring interface for active terminal sessions.
struct SessionDetailView: View {
    let session: ServerSessionInfo
    @State private var windowTitle = ""
    @State private var windowInfo: WindowEnumerator.WindowInfo?
    @State private var windowScreenshot: NSImage?
    @State private var isCapturingScreenshot = false
    @State private var isFindingWindow = false
    @State private var windowSearchAttempted = false
    @Environment(SystemPermissionManager.self)
    private var permissionManager

    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "SessionDetailView")

    var body: some View {
        HStack(spacing: 30) {
            // Left side: Session Information
            VStack(alignment: .leading, spacing: 20) {
                // Session Header
                VStack(alignment: .leading, spacing: 8) {
                    Text("Session Details")
                        .font(.largeTitle)
                        .fontWeight(.bold)

                    HStack {
                        if let pid = session.pid {
                            Label("PID: \(pid)", systemImage: "number.circle.fill")
                                .font(.title3)
                        } else {
                            Label("PID: N/A", systemImage: "number.circle.fill")
                                .font(.title3)
                        }

                        Spacer()

                        StatusBadge(isRunning: session.isRunning)
                    }
                }
                .padding(.bottom, 10)

                // Session Information
                VStack(alignment: .leading, spacing: 16) {
                    DetailRow(label: "Session ID", value: session.id)
                    DetailRow(label: "Command", value: session.command.joined(separator: " "))
                    DetailRow(label: "Working Directory", value: session.workingDir)
                    DetailRow(label: "Status", value: session.status.capitalized)
                    DetailRow(label: "Started At", value: formatDate(session.startedAt))
                    DetailRow(label: "Last Modified", value: formatDate(session.lastModified))

                    if let pid = session.pid {
                        DetailRow(label: "Process ID", value: "\(pid)")
                    }

                    if let exitCode = session.exitCode {
                        DetailRow(label: "Exit Code", value: "\(exitCode)")
                    }
                }

                Spacer()

                // Action Buttons
                HStack {
                    Button("Open in Terminal") {
                        openInTerminal()
                    }
                    .controlSize(.large)

                    Spacer()

                    if session.isRunning {
                        Button("Terminate Session") {
                            terminateSession()
                        }
                        .controlSize(.large)
                        .foregroundColor(.red)
                    }
                }
            }
            .frame(minWidth: 400)

            Divider()

            // Right side: Window Information and Screenshot
            VStack(alignment: .leading, spacing: 20) {
                Text("Window Information")
                    .font(.title2)
                    .fontWeight(.semibold)

                if let windowInfo {
                    VStack(alignment: .leading, spacing: 12) {
                        DetailRow(label: "Window ID", value: "\(windowInfo.windowID)")
                        DetailRow(label: "Terminal App", value: windowInfo.terminalApp.displayName)
                        DetailRow(label: "Owner PID", value: "\(windowInfo.ownerPID)")

                        if let bounds = windowInfo.bounds {
                            DetailRow(
                                label: "Position",
                                value: "X: \(Int(bounds.origin.x)), Y: \(Int(bounds.origin.y))"
                            )
                            DetailRow(label: "Size", value: "\(Int(bounds.width)) × \(Int(bounds.height))")
                        }

                        if let title = windowInfo.title {
                            DetailRow(label: "Window Title", value: title)
                        }

                        HStack {
                            Button("Focus Window") {
                                focusWindow()
                            }
                            .controlSize(.regular)

                            Button("Capture Screenshot") {
                                Task {
                                    await captureWindowScreenshot()
                                }
                            }
                            .controlSize(.regular)
                            .disabled(isCapturingScreenshot)
                        }
                    }

                    // Window Screenshot
                    if let screenshot = windowScreenshot {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Window Preview")
                                .font(.headline)
                                .foregroundColor(.secondary)

                            Image(nsImage: screenshot)
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(maxWidth: 400, maxHeight: 300)
                                .background(Color.gray.opacity(0.1))
                                .cornerRadius(8)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(Color.gray.opacity(0.3), lineWidth: 1)
                                )
                        }
                    } else if !permissionManager.hasPermission(.screenRecording) {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Screen Recording Permission Required")
                                .font(.headline)
                                .foregroundColor(.orange)

                            Text("VibeTunnel needs Screen Recording permission to capture window screenshots.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .fixedSize(horizontal: false, vertical: true)

                            Button("Grant Permission") {
                                permissionManager.requestPermission(.screenRecording)
                            }
                            .controlSize(.small)
                        }
                        .padding()
                        .background(Color.orange.opacity(0.1))
                        .cornerRadius(8)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        if windowSearchAttempted {
                            Label("No window found", systemImage: "exclamationmark.triangle")
                                .foregroundColor(.orange)
                                .font(.headline)

                            Text(
                                "Could not find a terminal window for this session. The window may have been closed or the session was started outside VibeTunnel."
                            )
                            .foregroundColor(.secondary)
                            .font(.caption)
                            .fixedSize(horizontal: false, vertical: true)
                        } else {
                            Text("No window information available")
                                .foregroundColor(.secondary)
                        }

                        Button(isFindingWindow ? "Searching..." : "Find Window") {
                            findWindow()
                        }
                        .controlSize(.regular)
                        .disabled(isFindingWindow)
                    }
                    .padding(.vertical, 20)
                }

                Spacer()
            }
            .frame(minWidth: 400)
        }
        .padding(30)
        .frame(minWidth: 900, minHeight: 450)
        .onAppear {
            updateWindowTitle()
            findWindow()

            // Check permissions
            Task {
                await permissionManager.checkAllPermissions()
            }
        }
        .background(WindowAccessor(title: $windowTitle))
    }

    private func updateWindowTitle() {
        let dir = URL(fileURLWithPath: session.workingDir).lastPathComponent
        if let pid = session.pid {
            windowTitle = "\(dir) — VibeTunnel (PID: \(pid))"
        } else {
            windowTitle = "\(dir) — VibeTunnel"
        }
    }

    private func formatDate(_ dateString: String) -> String {
        // Parse the date string and format it nicely
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"

        if let date = formatter.date(from: String(dateString.prefix(19))) {
            formatter.dateStyle = .medium
            formatter.timeStyle = .medium
            return formatter.string(from: date)
        }

        return dateString
    }

    private func openInTerminal() {
        // TODO: Implement opening session in terminal
        logger.info("Opening session \(session.id) in terminal")
    }

    private func terminateSession() {
        // TODO: Implement session termination
        logger.info("Terminating session \(session.id)")
    }

    private func findWindow() {
        isFindingWindow = true
        windowSearchAttempted = true

        Task { @MainActor in
            defer {
                isFindingWindow = false
            }

            logger.info("Looking for window associated with session \(session.id)")

            // First, check if WindowTracker already has window info for this session
            if let trackedWindow = WindowTracker.shared.windowInfo(for: session.id) {
                logger
                    .info(
                        "Found tracked window for session \(session.id): windowID=\(trackedWindow.windowID), terminal=\(trackedWindow.terminalApp.rawValue)"
                    )
                self.windowInfo = trackedWindow
                return
            }

            logger.info("No tracked window found for session \(session.id), attempting to find it...")

            // Get all terminal windows for debugging
            let allWindows = WindowEnumerator.getAllTerminalWindows()
            logger.info("Found \(allWindows.count) terminal windows currently open")

            // Log details about each window for debugging
            for (index, window) in allWindows.enumerated() {
                logger
                    .debug(
                        "Window \(index): terminal=\(window.terminalApp.rawValue), windowID=\(window.windowID), ownerPID=\(window.ownerPID), title=\(window.title ?? "<no title>")"
                    )
            }

            // Log session details for debugging
            logger
                .info(
                    "Session details: id=\(session.id), pid=\(session.pid ?? -1), workingDir=\(session.workingDir), attachedViaVT=\(session.attachedViaVT ?? false)"
                )

            // Try to match by various criteria
            if let pid = session.pid {
                logger.info("Looking for window with PID \(pid)...")
                if let window = allWindows.first(where: { $0.ownerPID == pid }) {
                    logger.info("Found window by PID match: windowID=\(window.windowID)")
                    self.windowInfo = window
                    // Register this window with WindowTracker for future use
                    WindowTracker.shared.registerWindow(
                        for: session.id,
                        terminalApp: window.terminalApp,
                        tabReference: nil,
                        tabID: nil
                    )
                    return
                } else {
                    logger.warning("No window found with PID \(pid)")
                }
            }

            // Try to find by window title containing working directory
            let workingDirName = URL(fileURLWithPath: session.workingDir).lastPathComponent
            logger.info("Looking for window with title containing '\(workingDirName)'...")

            if let window = allWindows.first(where: { window in
                if let title = window.title {
                    return title.contains(workingDirName) || title.contains(session.id)
                }
                return false
            }) {
                logger.info("Found window by title match: windowID=\(window.windowID), title=\(window.title ?? "")")
                self.windowInfo = window
                // Register this window with WindowTracker for future use
                WindowTracker.shared.registerWindow(
                    for: session.id,
                    terminalApp: window.terminalApp,
                    tabReference: nil,
                    tabID: nil
                )
                return
            }

            logger
                .warning(
                    "Could not find window for session \(session.id) after checking all \(allWindows.count) terminal windows"
                )
            logger.warning("Session may not have an associated terminal window or window detection failed")
        }
    }

    private func focusWindow() {
        // Use WindowTracker's existing focus logic which handles all the complexity
        logger.info("Attempting to focus window for session \(session.id)")

        // First ensure we have window info
        if windowInfo == nil {
            logger.info("No window info cached, trying to find window first...")
            findWindow()
        }

        if let windowInfo {
            logger
                .info(
                    "Using WindowTracker to focus window: windowID=\(windowInfo.windowID), terminal=\(windowInfo.terminalApp.rawValue)"
                )
            WindowTracker.shared.focusWindow(for: session.id)
        } else {
            logger.error("Cannot focus window - no window found for session \(session.id)")
        }
    }

    private func captureWindowScreenshot() async {
        guard let windowInfo else {
            logger.warning("No window info available for screenshot")
            return
        }

        await MainActor.run {
            isCapturingScreenshot = true
        }

        defer {
            Task { @MainActor in
                isCapturingScreenshot = false
            }
        }

        // Check for screen recording permission using SystemPermissionManager
        guard permissionManager.hasPermission(.screenRecording) else {
            logger.warning("No screen capture permission")
            // Prompt user to grant permission
            await MainActor.run {
                permissionManager.requestPermission(.screenRecording)
            }
            return
        }

        do {
            // Get available content
            let availableContent = try await SCShareableContent.current

            // Find the window
            guard let window = availableContent.windows.first(where: { $0.windowID == windowInfo.windowID }) else {
                logger.warning("Window not found in shareable content")
                return
            }

            // Create content filter for this specific window
            let filter = SCContentFilter(desktopIndependentWindow: window)

            // Configure the capture
            let config = SCStreamConfiguration()
            config.width = Int(window.frame.width * 2) // Retina resolution
            config.height = Int(window.frame.height * 2)
            config.scalesToFit = true
            config.showsCursor = false
            config.captureResolution = .best

            // Capture the screenshot
            let screenshot = try await SCScreenshotManager.captureImage(
                contentFilter: filter,
                configuration: config
            )

            // Convert CGImage to NSImage
            let nsImage = NSImage(cgImage: screenshot, size: NSSize(width: screenshot.width, height: screenshot.height))

            await MainActor.run {
                self.windowScreenshot = nsImage
            }

            logger.info("Successfully captured window screenshot")
        } catch {
            logger.error("Failed to capture screenshot: \(error)")
        }
    }
}

// MARK: - Supporting Views

/// A reusable row component for displaying labeled values.
///
/// Used throughout the session detail view to maintain consistent
/// formatting for key-value pairs with selectable text support.
struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .top) {
            Text(label + ":")
                .fontWeight(.medium)
                .foregroundColor(.secondary)
                .frame(width: 140, alignment: .trailing)

            Text(value)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Visual badge indicating session running status.
///
/// Displays a colored indicator and text label showing whether
/// a terminal session is currently active or stopped.
struct StatusBadge: View {
    let isRunning: Bool

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(isRunning ? Color.green : Color.red)
                .frame(width: 10, height: 10)

            Text(isRunning ? "Running" : "Stopped")
                .font(.caption)
                .fontWeight(.medium)
                .foregroundColor(isRunning ? .green : .red)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(isRunning ? Color.green.opacity(0.1) : Color.red.opacity(0.1))
        )
    }
}

// MARK: - Window Title Accessor

/// NSViewRepresentable that provides access to the window title.
///
/// Used to set custom window titles for session detail windows,
/// allowing each window to display the session ID in its title bar.
struct WindowAccessor: NSViewRepresentable {
    @Binding var title: String

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            if let window = view.window {
                window.title = self.title

                // Watch for title changes
                Task { @MainActor in
                    context.coordinator.startObserving(window: window, binding: self.$title)
                }
            }
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            if let window = nsView.window {
                window.title = self.title
            }
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    class Coordinator: NSObject {
        private var observation: NSKeyValueObservation?

        @MainActor
        func startObserving(window: NSWindow, binding: Binding<String>) {
            // Update the binding when window title changes
            observation = window.observe(\.title, options: [.new]) { _, change in
                if let newTitle = change.newValue {
                    DispatchQueue.main.async {
                        binding.wrappedValue = newTitle
                    }
                }
            }

            // Set initial title
            window.title = binding.wrappedValue
        }

        deinit {
            observation?.invalidate()
        }
    }
}
