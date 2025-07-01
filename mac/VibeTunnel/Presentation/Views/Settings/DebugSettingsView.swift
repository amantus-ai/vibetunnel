import AppKit
import os.log
import SwiftUI

/// Debug settings tab for development and troubleshooting
struct DebugSettingsView: View {
    @AppStorage("debugMode")
    private var debugMode = false
    @AppStorage("logLevel")
    private var logLevel = "info"
    @Environment(ServerManager.self)
    private var serverManager
    @State private var showPurgeConfirmation = false

    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "DebugSettings")

    private var isServerRunning: Bool {
        serverManager.isRunning
    }

    private var serverPort: Int {
        Int(serverManager.port) ?? 4_020
    }

    var body: some View {
        NavigationStack {
            Form {
                ServerSection(
                    isServerRunning: isServerRunning,
                    serverPort: serverPort,
                    serverManager: serverManager,
                    getCurrentServerMode: getCurrentServerMode
                )

                DebugOptionsSection(
                    debugMode: $debugMode,
                    logLevel: $logLevel
                )

                DeveloperToolsSection(
                    showPurgeConfirmation: $showPurgeConfirmation,
                    openConsole: openConsole,
                    showApplicationSupport: showApplicationSupport
                )
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .navigationTitle("Debug Settings")
            .alert("Purge All User Defaults?", isPresented: $showPurgeConfirmation) {
                Button("Cancel", role: .cancel) {}
                Button("Purge", role: .destructive) {
                    purgeAllUserDefaults()
                }
            } message: {
                Text(
                    "This will remove all stored preferences and reset the app to its default state. The app will quit after purging."
                )
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

    private func getCurrentServerMode() -> String {
        // Server mode is fixed to Go
        "Go"
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
}

// MARK: - Server Section

private struct ServerSection: View {
    let isServerRunning: Bool
    let serverPort: Int
    let serverManager: ServerManager
    let getCurrentServerMode: () -> String

    @State private var portConflict: PortConflict?
    @State private var isCheckingPort = false

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                // Server Information
                VStack(alignment: .leading, spacing: 8) {
                    LabeledContent("Status") {
                        if isServerRunning {
                            HStack {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                                Text("Running")
                            }
                        } else {
                            Text("Stopped")
                                .foregroundStyle(.secondary)
                        }
                    }

                    LabeledContent("Port") {
                        Text("\(serverPort)")
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

                    // Show restart button for all server modes
                    Button("Restart") {
                        Task {
                            await serverManager.manualRestart()
                        }
                    }
                    .buttonStyle(.borderedProminent)
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
                                        serverManager.port = String(port)
                                        Task {
                                            await serverManager.restart()
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
            Text("HTTP Server")
                .font(.headline)
        }
    }

    private func checkPortAvailability() async {
        isCheckingPort = true
        defer { isCheckingPort = false }

        let port = Int(serverPort)

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
                    Picker("", selection: $logLevel) {
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
                        openConsole()
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
                        showPurgeConfirmation = true
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
