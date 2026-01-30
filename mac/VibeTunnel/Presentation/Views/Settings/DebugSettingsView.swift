import AppKit
import os.log
import SwiftUI

// MARK: - Dev Server Validation

enum DevServerValidation: Equatable {
    case notValidated
    case validating
    case valid
    case invalid(String)

    var isValid: Bool {
        if case .valid = self { return true }
        return false
    }

    var errorMessage: String? {
        if case let .invalid(message) = self { return message }
        return nil
    }
}

/// Debug settings tab for development and troubleshooting
struct DebugSettingsView: View {
    @AppStorage(AppConstants.UserDefaultsKeys.debugMode)
    private var debugMode = false
    @AppStorage(AppConstants.UserDefaultsKeys.logLevel)
    private var logLevel = "info"
    @AppStorage(AppConstants.UserDefaultsKeys.useDevServer)
    private var useDevServer = false
    @AppStorage(AppConstants.UserDefaultsKeys.devServerPath)
    private var devServerPath = ""
    @Environment(ServerManager.self)
    private var serverManager
    @State private var showPurgeConfirmation = false
    @State private var devServerValidation: DevServerValidation = .notValidated
    @State private var devServerManager = DevServerManager.shared

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "DebugSettings")

    var body: some View {
        NavigationStack {
            Form {
                DevelopmentServerSection(
                    useDevServer: self.$useDevServer,
                    devServerPath: self.$devServerPath,
                    devServerValidation: self.$devServerValidation,
                    validateDevServer: self.validateDevServer,
                    serverManager: self.serverManager)

                DebugOptionsSection(
                    debugMode: self.$debugMode,
                    logLevel: self.$logLevel)

                DeveloperToolsSection(
                    showPurgeConfirmation: self.$showPurgeConfirmation,
                    openConsole: self.openConsole,
                    showApplicationSupport: self.showApplicationSupport)
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .navigationTitle("Debug Settings")
            .alert("Purge All User Defaults?", isPresented: self.$showPurgeConfirmation) {
                Button("Cancel", role: .cancel) {}
                Button("Purge", role: .destructive) {
                    self.purgeAllUserDefaults()
                }
            } message: {
                Text(
                    "This will remove all stored preferences and reset the app to its default state. The app will quit after purging.")
            }
        }
    }

    // MARK: - Private Methods

    private func purgeAllUserDefaults() {
        // Get the app's bundle identifier
        if let bundleIdentifier = Bundle.main.bundleIdentifier {
            // Remove all UserDefaults for this app
            UserDefaults.standard.removePersistentDomain(forName: bundleIdentifier)
            UserDefaults.standard.synchronize()

            // Quit the app after a short delay to ensure the purge completes
            Task {
                try? await Task.sleep(for: .milliseconds(500))
                await MainActor.run {
                    NSApplication.shared.terminate(nil)
                }
            }
        }
    }

    private func openConsole() {
        NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/Utilities/Console.app"))
    }

    private func showApplicationSupport() {
        if let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            let appDirectory = appSupport.appendingPathComponent("VibeTunnel")
            NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: appDirectory.path)
        }
    }

    private func validateDevServer(path: String) {
        self.devServerValidation = self.devServerManager.validate(path: path)
    }
}

// MARK: - Debug Options Section

private struct DebugOptionsSection: View {
    @Binding var debugMode: Bool
    @Binding var logLevel: String

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("Log Level")
                    Spacer()
                    Picker("", selection: self.$logLevel) {
                        Text("Error").tag("error")
                        Text("Warning").tag("warning")
                        Text("Info").tag("info")
                        Text("Debug").tag("debug")
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                }
                Text("Set the verbosity of application logs.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("Debug Options")
                .font(.headline)
        }
    }
}

// MARK: - Developer Tools Section

private struct DeveloperToolsSection: View {
    @Binding var showPurgeConfirmation: Bool
    let openConsole: () -> Void
    let showApplicationSupport: () -> Void

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("System Logs")
                    Spacer()
                    Button("Open Console") {
                        self.openConsole()
                    }
                    .buttonStyle(.bordered)
                }
                Text("View all application logs in Console.app.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Welcome Screen")
                    Spacer()
                    Button("Show Welcome") {
                        #if !SWIFT_PACKAGE
                        AppDelegate.showWelcomeScreen()
                        #endif
                    }
                    .buttonStyle(.bordered)
                }
                Text("Display the welcome screen again.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("User Defaults")
                    Spacer()
                    Button("Purge All") {
                        self.showPurgeConfirmation = true
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                }
                Text("Remove all stored preferences and reset to defaults.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("Developer Tools")
                .font(.headline)
        }
    }
}

// MARK: - Development Server Section

private struct DevelopmentServerSection: View {
    @Binding var useDevServer: Bool
    @Binding var devServerPath: String
    @Binding var devServerValidation: DevServerValidation
    let validateDevServer: (String) -> Void
    let serverManager: ServerManager

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                // Toggle for using dev server
                VStack(alignment: .leading, spacing: 4) {
                    Toggle("Use development server", isOn: self.$useDevServer)
                        .onChange(of: self.useDevServer) { _, newValue in
                            if newValue, !self.devServerPath.isEmpty {
                                self.validateDevServer(self.devServerPath)
                            }
                            // Restart server if it's running and the setting changed
                            if self.serverManager.isRunning {
                                Task {
                                    await self.serverManager.restart()
                                }
                            }
                        }
                    Text("Run the web server in development mode with hot reload instead of using the built-in server.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                // Path input (only shown when enabled)
                if self.useDevServer {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            TextField("Web project path", text: self.$devServerPath)
                                .textFieldStyle(.roundedBorder)
                                .onChange(of: self.devServerPath) { _, newPath in
                                    self.validateDevServer(newPath)
                                }

                            Button(action: self.selectDirectory) {
                                Image(systemName: "folder")
                                    .font(.system(size: 12))
                                    .foregroundColor(.secondary)
                            }
                            .buttonStyle(.borderless)
                            .help("Choose directory")
                        }

                        // Validation status
                        if self.devServerValidation == .validating {
                            HStack(spacing: 4) {
                                ProgressView()
                                    .scaleEffect(0.7)
                                Text("Validating...")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        } else if self.devServerValidation.isValid {
                            HStack(spacing: 4) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                                    .font(.caption)
                                Text("Valid project with 'pnpm run dev' script")
                                    .font(.caption)
                                    .foregroundColor(.green)
                            }
                        } else if let error = devServerValidation.errorMessage {
                            HStack(spacing: 4) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundColor(.red)
                                    .font(.caption)
                                Text(error)
                                    .font(.caption)
                                    .foregroundColor(.red)
                            }
                        }

                        Text("Path to the VibeTunnel web project directory containing package.json.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        } header: {
            Text("Development Server")
                .font(.headline)
        } footer: {
            if self.useDevServer {
                Text(
                    "Requires pnpm to be installed. The server will run 'pnpm run dev' with the same arguments as the built-in server.")
                    .font(.caption)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private func selectDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false

        // Set initial directory
        if !self.devServerPath.isEmpty {
            let expandedPath = NSString(string: devServerPath).expandingTildeInPath
            panel.directoryURL = URL(fileURLWithPath: expandedPath)
        }

        if panel.runModal() == .OK, let url = panel.url {
            let path = url.path
            let homeDir = NSHomeDirectory()
            if path.hasPrefix(homeDir) {
                self.devServerPath = "~" + path.dropFirst(homeDir.count)
            } else {
                self.devServerPath = path
            }

            // Validate immediately after selection
            self.validateDevServer(self.devServerPath)
        }
    }
}
