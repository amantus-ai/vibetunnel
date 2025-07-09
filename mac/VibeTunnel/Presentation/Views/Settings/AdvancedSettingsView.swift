import AppKit
import OSLog
import SwiftUI

// MARK: - Logger

extension Logger {
    fileprivate static let advanced = Logger(subsystem: "com.vibetunnel.VibeTunnel", category: "AdvancedSettings")
}

/// Advanced settings tab for power user options
struct AdvancedSettingsView: View {
    @AppStorage("debugMode")
    private var debugMode = false
    @AppStorage("cleanupOnStartup")
    private var cleanupOnStartup = true
    @AppStorage("showInDock")
    private var showInDock = true
    @AppStorage("repositoryBasePath")
    private var repositoryBasePath = AppConstants.Defaults.repositoryBasePath
    @State private var cliInstaller = CLIInstaller()
    @State private var showingVtConflictAlert = false

    var body: some View {
        NavigationStack {
            Form {
                // Apps preference section
                TerminalPreferenceSection()

                // Repository section
                RepositorySettingsSection(repositoryBasePath: $repositoryBasePath)

                // Integration section
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("Install CLI Tool")
                            Spacer()
                            ZStack {
                                // Hidden button to maintain consistent height
                                Button("Placeholder") {}
                                    .buttonStyle(.bordered)
                                    .opacity(0)
                                    .allowsHitTesting(false)

                                // Actual content
                                if cliInstaller.isInstalled {
                                    HStack(spacing: 8) {
                                        if cliInstaller.isOutdated {
                                            Image(systemName: "exclamationmark.triangle.fill")
                                                .foregroundColor(.orange)
                                            Text("VT update available")
                                                .foregroundColor(.secondary)

                                            Button("Update") {
                                                Task {
                                                    await cliInstaller.install()
                                                }
                                            }
                                            .buttonStyle(.bordered)
                                            .disabled(cliInstaller.isInstalling)
                                        } else {
                                            Image(systemName: "checkmark.circle.fill")
                                                .foregroundColor(.green)
                                            Text("VT installed")
                                                .foregroundColor(.secondary)

                                            // Show reinstall button in debug mode
                                            if debugMode {
                                                Button(action: {
                                                    cliInstaller.installCLITool()
                                                }, label: {
                                                    Image(systemName: "arrow.clockwise.circle")
                                                        .font(.system(size: 14))
                                                })
                                                .buttonStyle(.plain)
                                                .foregroundColor(.accentColor)
                                                .help("Reinstall CLI tool")
                                            }
                                        }
                                    }
                                } else {
                                    Button("Install 'vt' Command") {
                                        Task {
                                            await cliInstaller.install()
                                        }
                                    }
                                    .buttonStyle(.bordered)
                                    .disabled(cliInstaller.isInstalling)
                                }
                            }
                        }

                        if let error = cliInstaller.lastError {
                            Text(error)
                                .font(.caption)
                                .foregroundColor(.red)
                        } else {
                            HStack(alignment: .center, spacing: 8) {
                                if cliInstaller.isInstalled {
                                    Text("The 'vt' command line tool is installed at /usr/local/bin/vt")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                } else {
                                    Text("Install the 'vt' command line tool to /usr/local/bin for terminal access.")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }

                                Spacer()

                                Button(action: {
                                    showingVtConflictAlert = true
                                }, label: {
                                    Text("Use a different name")
                                        .font(.caption)
                                })
                                .buttonStyle(.link)
                            }
                        }
                    }
                } header: {
                    Text("Integration")
                        .font(.headline)
                } footer: {
                    Text(
                        "Prefix any terminal command with 'vt' to enable remote control."
                    )
                    .font(.caption)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                }

                // Window Highlight section
                WindowHighlightSettingsSection()

                // Advanced section
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Clean up old sessions on startup", isOn: $cleanupOnStartup)
                        Text("Automatically remove terminated sessions when the app starts.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    // Show in Dock
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Show in Dock", isOn: showInDockBinding)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Show VibeTunnel icon in the Dock.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("The dock icon is always displayed when the Settings dialog is visible.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
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
        .onAppear {
            cliInstaller.checkInstallationStatus()
        }
        .alert("Using a Different Command Name", isPresented: $showingVtConflictAlert) {
            Button("OK") {}
            Button("Copy to Clipboard") {
                copyCommandToClipboard()
            }
        } message: {
            Text(vtConflictMessage)
        }
    }

    private var showInDockBinding: Binding<Bool> {
        Binding(
            get: { showInDock },
            set: { newValue in
                showInDock = newValue
                // Don't change activation policy while settings window is open
                // The change will be applied when the settings window closes
            }
        )
    }

    private var vtScriptPath: String {
        if let path = Bundle.main.path(forResource: "vt", ofType: nil) {
            return path
        }
        return "/Applications/VibeTunnel.app/Contents/Resources/vt"
    }

    private var vtConflictMessage: String {
        """
        You can install the `vt` bash script with a different name. For example:

        cp "\(vtScriptPath)" /usr/local/bin/vtunnel && chmod +x /usr/local/bin/vtunnel
        """
    }

    private func copyCommandToClipboard() {
        let command = "cp \"\(vtScriptPath)\" /usr/local/bin/vtunnel && chmod +x /usr/local/bin/vtunnel"
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(command, forType: .string)
    }
}

// MARK: - Terminal Preference Section

private struct TerminalPreferenceSection: View {
    @AppStorage("preferredTerminal")
    private var preferredTerminal = Terminal.terminal.rawValue
    @AppStorage("preferredGitApp")
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

// MARK: - Repository Settings Section

private struct RepositorySettingsSection: View {
    @Binding var repositoryBasePath: String
    
    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    TextField("Default base path", text: $repositoryBasePath)
                        .textFieldStyle(.roundedBorder)
                    
                    Button(action: selectDirectory) {
                        Image(systemName: "folder")
                            .font(.system(size: 12))
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.borderless)
                    .help("Choose directory")
                }
                
                Text("Base path where VibeTunnel will search for Git repositories to show in the New Session form.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("Repository Discovery")
                .font(.headline)
        } footer: {
            Text("Git repositories found in this directory will appear in the New Session form for quick access.")
                .font(.caption)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
    }
    
    private func selectDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = URL(fileURLWithPath: NSString(string: repositoryBasePath).expandingTildeInPath)
        
        if panel.runModal() == .OK, let url = panel.url {
            let path = url.path
            let homeDir = NSHomeDirectory()
            if path.hasPrefix(homeDir) {
                repositoryBasePath = "~" + path.dropFirst(homeDir.count)
            } else {
                repositoryBasePath = path
            }
        }
    }
}
