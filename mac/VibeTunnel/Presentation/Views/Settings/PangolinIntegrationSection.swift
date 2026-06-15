import SwiftUI

struct PangolinIntegrationSection: View {
    let pangolinService: PangolinService
    let serverPort: String

    @State private var connectionEnabled = false
    @State private var isTogglingConnection = false
    @State private var endpointInput = URLConstants.pangolinCloud
    @State private var siteIDInput = ""
    @State private var secretInput = ""
    @State private var credentialsStored = false
    @State private var isEditingCredentials = false
    @State private var credentialsError: String?
    @State private var connectionError: String?

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Image(systemName: "circle.fill")
                        .foregroundColor(self.statusColor)
                        .font(.system(size: 10))
                    Text(self.statusText)
                        .font(.callout)
                    Spacer()
                }

                if !self.pangolinService.isInstalled {
                    HStack(spacing: 12) {
                        Button("Copy Install Command") {
                            self.pangolinService.copyInstallCommand()
                        }
                        .buttonStyle(.link)
                        .controlSize(.small)
                    }
                } else {
                    self.credentialsControls

                    if self.credentialsStored {
                        HStack {
                            Toggle("Connect Pangolin site", isOn: self.$connectionEnabled)
                                .disabled(self.isTogglingConnection)
                                .onChange(of: self.connectionEnabled) { _, enabled in
                                    if enabled {
                                        self.startConnection()
                                    } else {
                                        self.stopConnection()
                                    }
                                }

                            if self.isTogglingConnection {
                                ProgressView()
                                    .scaleEffect(0.7)
                            } else if self.pangolinService.isConnected {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                                Text("Connected")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }

                    if let error = pangolinService.statusError {
                        self.errorView(error)
                    }
                    if let connectionError {
                        self.errorView(connectionError)
                    }
                    if let credentialsError {
                        self.errorView(credentialsError)
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Pangolin resource target")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text("http://localhost:\(self.serverPort)")
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                }

                HStack(spacing: 12) {
                    Button("Open Pangolin") {
                        self.pangolinService.openDashboard()
                    }
                    .buttonStyle(.link)
                    .font(.caption)

                    Button("Setup Guide") {
                        self.pangolinService.openSetupGuide()
                    }
                    .buttonStyle(.link)
                    .font(.caption)
                }
            }
        } header: {
            Text("Pangolin Integration")
                .font(.headline)
        } footer: {
            Text(
                "Newt connects this Mac as a Pangolin site. Create a public Resource in Pangolin with the target shown above; Pangolin owns the public URL and access policy.")
                .font(.caption)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
        .task {
            _ = self.pangolinService.checkCLIInstallation()
            self.credentialsStored = self.pangolinService.hasCredentials
            self.connectionEnabled = self.pangolinService.isRunning
            if let credentials = pangolinService.credentials {
                self.endpointInput = credentials.endpoint
            }
        }
        .onChange(of: self.pangolinService.isRunning) { _, isRunning in
            self.connectionEnabled = isRunning
        }
    }

    @ViewBuilder
    private var credentialsControls: some View {
        if self.credentialsStored, !self.isEditingCredentials {
            HStack {
                Label("Site credentials saved", systemImage: "key.fill")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
                Button("Replace") {
                    if let credentials = pangolinService.credentials {
                        self.endpointInput = credentials.endpoint
                        self.siteIDInput = credentials.siteID
                    }
                    self.secretInput = ""
                    self.isEditingCredentials = true
                }
                .controlSize(.small)
                .disabled(self.pangolinService.isRunning)

                Button("Remove") {
                    self.pangolinService.deleteCredentials()
                    self.credentialsStored = false
                    self.siteIDInput = ""
                    self.secretInput = ""
                    self.credentialsError = nil
                }
                .controlSize(.small)
                .disabled(self.pangolinService.isRunning)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                TextField("Pangolin endpoint", text: self.$endpointInput)
                    .textFieldStyle(.roundedBorder)
                TextField("Newt site ID", text: self.$siteIDInput)
                    .textFieldStyle(.roundedBorder)
                SecureField("Newt secret", text: self.$secretInput)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit {
                        self.saveCredentials()
                    }

                HStack {
                    Button("Save Credentials") {
                        self.saveCredentials()
                    }
                    .disabled(
                        self.endpointInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                            self.siteIDInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                            self.secretInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .controlSize(.small)

                    if self.isEditingCredentials {
                        Button("Cancel") {
                            self.isEditingCredentials = false
                            self.siteIDInput = ""
                            self.secretInput = ""
                            self.credentialsError = nil
                        }
                        .controlSize(.small)
                    }
                }
            }
        }
    }

    private var statusColor: Color {
        if !self.pangolinService.isInstalled {
            return .yellow
        }
        if self.pangolinService.isConnected {
            return .green
        }
        return self.pangolinService.isRunning ? .blue : .orange
    }

    private var statusText: String {
        if !self.pangolinService.isInstalled {
            return "Newt is not installed"
        }
        if self.pangolinService.isConnected {
            return "Pangolin site is connected"
        }
        return self.pangolinService.isRunning ? "Connecting Pangolin site..." : "Newt is installed"
    }

    private func saveCredentials() {
        if self.pangolinService.saveCredentials(
            endpoint: self.endpointInput,
            siteID: self.siteIDInput,
            secret: self.secretInput)
        {
            self.credentialsStored = true
            self.isEditingCredentials = false
            self.siteIDInput = ""
            self.secretInput = ""
            self.credentialsError = nil
        } else {
            self.credentialsError = "Enter a valid HTTP(S) endpoint, site ID, and secret."
        }
    }

    private func startConnection() {
        guard !self.isTogglingConnection else { return }
        self.isTogglingConnection = true
        self.connectionError = nil

        Task {
            defer { self.isTogglingConnection = false }
            do {
                try await self.pangolinService.start()
                self.connectionEnabled = self.pangolinService.isRunning
            } catch {
                self.connectionEnabled = false
                self.connectionError = error.localizedDescription
            }
        }
    }

    private func stopConnection() {
        guard !self.isTogglingConnection else { return }
        self.isTogglingConnection = true

        Task {
            await self.pangolinService.stop()
            self.connectionEnabled = false
            self.isTogglingConnection = false
        }
    }

    private func errorView(_ error: String) -> some View {
        HStack {
            Image(systemName: "exclamationmark.triangle")
                .foregroundColor(.red)
            Text(error)
                .font(.caption)
                .foregroundColor(.red)
                .lineLimit(2)
        }
    }
}
