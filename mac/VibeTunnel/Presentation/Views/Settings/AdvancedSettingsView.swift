import AppKit
import OSLog
import SwiftUI

// MARK: - Logger

extension Logger {
    fileprivate static let advanced = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "AdvancedSettings")
}

/// Advanced settings tab for power user options
struct AdvancedSettingsView: View {
    @AppStorage(AppConstants.UserDefaultsKeys.debugMode)
    private var debugMode = false
    @AppStorage(AppConstants.UserDefaultsKeys.cleanupOnStartup)
    private var cleanupOnStartup = true
    @AppStorage(AppConstants.UserDefaultsKeys.updateChannel)
    private var updateChannelRaw = UpdateChannel.stable.rawValue

    @State private var isCheckingForUpdates = false

    var updateChannel: UpdateChannel {
        UpdateChannel(rawValue: updateChannelRaw) ?? .stable
    }

    var body: some View {
        NavigationStack {
            Form {
                // Apps preference section
                TerminalPreferenceSection()

                // Window Highlight section
                WindowHighlightSettingsSection()

                // Updates section
                Section {
                    // Update Channel
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("Update Channel")
                            Spacer()
                            Picker("", selection: updateChannelBinding) {
                                ForEach(UpdateChannel.allCases) { channel in
                                    Text(channel.displayName).tag(channel)
                                }
                            }
                            .pickerStyle(.menu)
                            .labelsHidden()
                        }
                        Text(updateChannel.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    // Check for Updates
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Check for Updates")
                            Text("Check for new versions of VibeTunnel.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        Button("Check Now") {
                            checkForUpdates()
                        }
                        .buttonStyle(.bordered)
                        .disabled(isCheckingForUpdates)
                    }
                } header: {
                    Text("Updates")
                        .font(.headline)
                }

                // Advanced section
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Clean up old sessions on startup", isOn: $cleanupOnStartup)
                        Text("Automatically remove terminated sessions when the app starts.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    // Debug mode toggle
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Debug mode", isOn: $debugMode)
                        Text("Enable additional logging and debugging features.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Advanced")
                        .font(.headline)
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .navigationTitle("Advanced Settings")
        }
    }

    private var updateChannelBinding: Binding<UpdateChannel> {
        Binding(
            get: { updateChannel },
            set: { newValue in
                updateChannelRaw = newValue.rawValue
                // Notify the updater manager about the channel change
                NotificationCenter.default.post(
                    name: Notification.Name("UpdateChannelChanged"),
                    object: nil,
                    userInfo: ["channel": newValue]
                )
            }
        )
    }

    private func checkForUpdates() {
        isCheckingForUpdates = true
        NotificationCenter.default.post(name: Notification.Name("checkForUpdates"), object: nil)

        // Reset after a delay
        Task {
            try? await Task.sleep(for: .seconds(2))
            isCheckingForUpdates = false
        }
    }
}

// MARK: - Terminal Preference Section

private struct TerminalPreferenceSection: View {
    @AppStorage(AppConstants.UserDefaultsKeys.preferredTerminal)
    private var preferredTerminal = Terminal.terminal.rawValue
    @AppStorage(AppConstants.UserDefaultsKeys.preferredGitApp)
    private var preferredGitApp = ""
    @State private var terminalLauncher = TerminalLauncher.shared
    @State private var gitAppLauncher = GitAppLauncher.shared
    @State private var showingError = false
    @State private var errorMessage = ""
    @State private var errorTitle = "Terminal Launch Failed"

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                // Terminal selector row
                HStack {
                    Text("Preferred Terminal")
                    Spacer()
                    Button("Test") {
                        Task {
                            do {
                                try terminalLauncher.launchCommand("echo 'VibeTunnel Terminal Test: Success!'")
                            } catch {
                                // Log the error
                                Logger.advanced.error("Failed to launch terminal test: \(error)")

                                // Set up alert content based on error type
                                if let terminalError = error as? TerminalLauncherError {
                                    switch terminalError {
                                    case .appleScriptPermissionDenied:
                                        errorTitle = "Permission Denied"
                                        errorMessage =
                                            "VibeTunnel needs permission to control terminal applications.\n\nPlease grant Automation permission in System Settings > Privacy & Security > Automation."
                                    case .accessibilityPermissionDenied:
                                        errorTitle = "Accessibility Permission Required"
                                        errorMessage =
                                            "VibeTunnel needs Accessibility permission to send keystrokes to \(Terminal(rawValue: preferredTerminal)?.displayName ?? "terminal").\n\nPlease grant permission in System Settings > Privacy & Security > Accessibility."
                                    case .terminalNotFound:
                                        errorTitle = "Terminal Not Found"
                                        errorMessage =
                                            "The selected terminal application could not be found. Please select a different terminal."
                                    case .appleScriptExecutionFailed(let details, let errorCode):
                                        if let code = errorCode {
                                            switch code {
                                            case -1_743:
                                                errorTitle = "Permission Denied"
                                                errorMessage =
                                                    "VibeTunnel needs permission to control terminal applications.\n\nPlease grant Automation permission in System Settings > Privacy & Security > Automation."
                                            case -1_728:
                                                errorTitle = "Terminal Not Available"
                                                errorMessage =
                                                    "The terminal application is not running or cannot be controlled.\n\nDetails: \(details)"
                                            case -1_708:
                                                errorTitle = "Terminal Communication Error"
                                                errorMessage =
                                                    "The terminal did not respond to the command.\n\nDetails: \(details)"
                                            case -25_211:
                                                errorTitle = "Accessibility Permission Required"
                                                errorMessage =
                                                    "System Events requires Accessibility permission to send keystrokes.\n\nPlease grant permission in System Settings > Privacy & Security > Accessibility."
                                            default:
                                                errorTitle = "Terminal Launch Failed"
                                                errorMessage = "AppleScript error \(code): \(details)"
                                            }
                                        } else {
                                            errorTitle = "Terminal Launch Failed"
                                            errorMessage = "Failed to launch terminal: \(details)"
                                        }
                                    case .processLaunchFailed(let details):
                                        errorTitle = "Process Launch Failed"
                                        errorMessage = "Failed to start terminal process: \(details)"
                                    }
                                } else {
                                    errorTitle = "Terminal Launch Failed"
                                    errorMessage = error.localizedDescription
                                }

                                showingError = true
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .foregroundColor(.secondary)

                    Picker("", selection: $preferredTerminal) {
                        ForEach(Terminal.installed, id: \.rawValue) { terminal in
                            HStack {
                                if let icon = terminal.appIcon {
                                    Image(nsImage: icon.resized(to: NSSize(width: 16, height: 16)))
                                }
                                Text(terminal.displayName)
                            }
                            .tag(terminal.rawValue)
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                }

                // Git app selector row
                HStack {
                    Text("Preferred Git App")
                    Spacer()
                    Picker("", selection: gitAppBinding) {
                        ForEach(GitApp.installed, id: \.rawValue) { gitApp in
                            HStack {
                                if let icon = gitApp.appIcon {
                                    Image(nsImage: icon.resized(to: NSSize(width: 16, height: 16)))
                                }
                                Text(gitApp.displayName)
                            }
                            .tag(gitApp.rawValue)
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                }
            }
        } header: {
            Text("Apps")
                .font(.headline)
        } footer: {
            Text(
                "Configure which applications VibeTunnel uses for terminal sessions and Git repositories."
            )
            .font(.caption)
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
        }
        .alert(errorTitle, isPresented: $showingError) {
            Button("OK") {}
            if errorTitle == "Permission Denied" {
                Button("Open System Settings") {
                    if let url =
                        URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")
                    {
                        NSWorkspace.shared.open(url)
                    }
                }
            }
        } message: {
            Text(errorMessage)
        }
    }

    private var gitAppBinding: Binding<String> {
        Binding(
            get: {
                // If no preference or invalid preference, use first installed app
                if preferredGitApp.isEmpty || GitApp(rawValue: preferredGitApp) == nil {
                    return GitApp.installed.first?.rawValue ?? ""
                }
                return preferredGitApp
            },
            set: { newValue in
                preferredGitApp = newValue
            }
        )
    }
}

// MARK: - Window Highlight Settings Section

private struct WindowHighlightSettingsSection: View {
    @AppStorage("windowHighlightEnabled")
    private var highlightEnabled = true
    @AppStorage("windowHighlightStyle")
    private var highlightStyle = "default"
    @AppStorage("windowHighlightColor")
    private var highlightColorData = Data()

    @State private var customColor = Color.blue
    @State private var highlightEffect: WindowHighlightEffect?

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                // Window highlight style picker
                HStack {
                    Text("Window highlight")
                    Spacer()
                    Picker("", selection: highlightStyleBinding) {
                        Text("None").tag("none")
                        Text("Default").tag("default")
                        Text("Subtle").tag("subtle")
                        Text("Neon").tag("neon")
                        Text("Custom").tag("custom")
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                }

                // Custom color picker (only shown when custom is selected)
                if highlightStyle == "custom" && highlightEnabled {
                    HStack {
                        Text("Custom color")
                        Spacer()
                        ColorPicker("", selection: $customColor, supportsOpacity: false)
                            .labelsHidden()
                            .onChange(of: customColor) { _, newColor in
                                saveCustomColor(newColor)
                                previewHighlightEffect()
                            }
                    }
                }
            }
        } header: {
            Text("Terminal window highlight effect")
                .font(.headline)
        } footer: {
            Text("Visual effect when focusing terminal windows to make selection more noticeable.")
                .font(.caption)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
        .onAppear {
            loadCustomColor()
            // Create highlight effect instance for preview
            highlightEffect = WindowHighlightEffect()
        }
    }

    private var highlightStyleBinding: Binding<String> {
        Binding(
            get: {
                highlightEnabled ? highlightStyle : "none"
            },
            set: { newValue in
                if newValue == "none" {
                    highlightEnabled = false
                    highlightStyle = "default" // Keep a default style for when re-enabled
                } else {
                    highlightEnabled = true
                    highlightStyle = newValue
                    previewHighlightEffect()
                }
            }
        )
    }

    private func saveCustomColor(_ color: Color) {
        let nsColor = NSColor(color)
        do {
            let data = try NSKeyedArchiver.archivedData(withRootObject: nsColor, requiringSecureCoding: false)
            highlightColorData = data
        } catch {
            Logger.advanced.error("Failed to save custom color: \(error)")
        }
    }

    private func loadCustomColor() {
        if !highlightColorData.isEmpty {
            do {
                if let nsColor = try NSKeyedUnarchiver.unarchivedObject(
                    ofClass: NSColor.self,
                    from: highlightColorData
                ) {
                    customColor = Color(nsColor)
                }
            } catch {
                Logger.advanced.error("Failed to load custom color: \(error)")
            }
        }
    }

    private func previewHighlightEffect() {
        Task { @MainActor in
            // Get the current highlight configuration
            let config = loadCurrentHighlightConfig()

            // Update the highlight effect with new config
            highlightEffect?.updateConfig(config)

            // Find the settings window
            guard let settingsWindow = NSApp.windows.first(where: { window in
                window.title.contains("Settings") || window.title.contains("Preferences")
            }) else {
                Logger.advanced.debug("Could not find settings window for highlight preview")
                return
            }

            // Get the window's accessibility element
            let pid = ProcessInfo.processInfo.processIdentifier
            let axApp = AXElement.application(pid: pid)

            guard let windows = axApp.windows, !windows.isEmpty else {
                Logger.advanced.debug("Could not get accessibility windows for highlight preview")
                return
            }

            // Find the settings window by comparing bounds
            let settingsFrame = settingsWindow.frame
            var targetWindow: AXElement?

            for axWindow in windows {
                if let frame = axWindow.frame() {
                    // Check if this matches our settings window (with some tolerance for frame differences)
                    let tolerance: CGFloat = 5.0
                    if abs(frame.origin.x - settingsFrame.origin.x) < tolerance &&
                        abs(frame.width - settingsFrame.width) < tolerance &&
                        abs(frame.height - settingsFrame.height) < tolerance
                    {
                        targetWindow = axWindow
                        break
                    }
                }
            }

            // Apply highlight effect to the settings window
            if let window = targetWindow {
                highlightEffect?.highlightWindow(window)
            } else {
                Logger.advanced.debug("Could not match settings window for highlight preview")
            }
        }
    }

    private func loadCurrentHighlightConfig() -> WindowHighlightConfig {
        guard highlightEnabled else {
            return WindowHighlightConfig(
                color: .clear,
                duration: 0,
                borderWidth: 0,
                glowRadius: 0,
                isEnabled: false
            )
        }

        switch highlightStyle {
        case "subtle":
            return .subtle
        case "neon":
            return .neon
        case "custom":
            // Load custom color
            let colorData = highlightColorData
            if !colorData.isEmpty,
               let nsColor = try? NSKeyedUnarchiver.unarchivedObject(ofClass: NSColor.self, from: colorData)
            {
                return WindowHighlightConfig(
                    color: nsColor,
                    duration: 0.8,
                    borderWidth: 4.0,
                    glowRadius: 12.0,
                    isEnabled: true
                )
            }
            return .default
        default:
            return .default
        }
    }
}
