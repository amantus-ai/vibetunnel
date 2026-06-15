import SwiftUI

struct PinggyIntegrationSection: View {
    let pinggyService: PinggyService
    let serverPort: String

    @State private var tunnelEnabled = false
    @State private var isTogglingTunnel = false
    @State private var tokenInput = ""
    @State private var tokenStored = false
    @State private var isEditingToken = false
    @State private var tokenError: String?
    @State private var tunnelError: String?

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

                if !self.pinggyService.isInstalled {
                    HStack(spacing: 12) {
                        Button("Copy Install Command") {
                            self.pinggyService.copyInstallCommand()
                        }
                        .buttonStyle(.link)
                        .controlSize(.small)

                        Button("Setup Guide") {
                            self.pinggyService.openSetupGuide()
                        }
                        .buttonStyle(.link)
                        .controlSize(.small)
                    }
                } else {
                    HStack {
                        Toggle("Enable Pinggy tunnel", isOn: self.$tunnelEnabled)
                            .disabled(self.isTogglingTunnel)
                            .onChange(of: self.tunnelEnabled) { _, enabled in
                                if enabled {
                                    self.startTunnel()
                                } else {
                                    self.stopTunnel()
                                }
                            }

                        if self.isTogglingTunnel {
                            ProgressView()
                                .scaleEffect(0.7)
                        } else if self.pinggyService.isRunning {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("Connected")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }

                    self.tokenControls

                    if let publicUrl = pinggyService.publicUrl {
                        ClickableURLView(label: "Public URL:", url: publicUrl)
                    }

                    if let error = pinggyService.statusError {
                        self.errorView(error)
                    }
                    if let tunnelError {
                        self.errorView(tunnelError)
                    }
                    if let tokenError {
                        self.errorView(tokenError)
                    }

                    HStack {
                        Image(systemName: "link")
                        Button("Configure persistent URL") {
                            self.pinggyService.openDashboard()
                        }
                        .buttonStyle(.link)
                        .font(.caption)
                    }
                }
            }
        } header: {
            Text("Pinggy Integration")
                .font(.headline)
        } footer: {
            Text(
                "Pinggy creates a public HTTPS tunnel. An access token is optional; assign a persistent subdomain or custom domain to the token in Pinggy for a fixed URL.")
                .font(.caption)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
        .task {
            _ = self.pinggyService.checkCLIInstallation()
            self.tokenStored = self.pinggyService.hasAccessToken
            self.tunnelEnabled = self.pinggyService.isRunning
        }
        .onChange(of: self.pinggyService.isRunning) { _, isRunning in
            self.tunnelEnabled = isRunning
        }
    }

    @ViewBuilder
    private var tokenControls: some View {
        if self.tokenStored, !self.isEditingToken {
            HStack {
                Label("Access token saved", systemImage: "key.fill")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
                Button("Replace") {
                    self.tokenInput = ""
                    self.isEditingToken = true
                }
                .controlSize(.small)
                Button("Remove") {
                    self.pinggyService.deleteAccessToken()
                    self.tokenStored = false
                    self.tokenInput = ""
                    self.tokenError = nil
                }
                .controlSize(.small)
            }
        } else {
            HStack {
                SecureField("Access token (optional)", text: self.$tokenInput)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit {
                        self.saveToken()
                    }

                Button("Save") {
                    self.saveToken()
                }
                .disabled(self.tokenInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .controlSize(.small)

                if self.isEditingToken {
                    Button("Cancel") {
                        self.isEditingToken = false
                        self.tokenInput = ""
                        self.tokenError = nil
                    }
                    .controlSize(.small)
                }
            }
        }
    }

    private var statusColor: Color {
        if !self.pinggyService.isInstalled {
            return .yellow
        }
        return self.pinggyService.isRunning ? .green : .orange
    }

    private var statusText: String {
        if !self.pinggyService.isInstalled {
            return "pinggy is not installed"
        }
        return self.pinggyService.isRunning ? "Pinggy tunnel is running" : "pinggy is installed"
    }

    private func saveToken() {
        let token = self.tokenInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { return }

        if self.pinggyService.saveAccessToken(token) {
            self.tokenStored = true
            self.isEditingToken = false
            self.tokenInput = ""
            self.tokenError = nil
        } else {
            self.tokenError = "Failed to save Pinggy access token to Keychain"
        }
    }

    private func startTunnel() {
        guard !self.isTogglingTunnel else { return }
        self.isTogglingTunnel = true
        self.tunnelError = nil

        Task {
            defer { self.isTogglingTunnel = false }
            do {
                try await self.pinggyService.startTunnel(port: Int(self.serverPort) ?? 4020)
                self.tunnelEnabled = self.pinggyService.isRunning
            } catch {
                self.tunnelEnabled = false
                self.tunnelError = error.localizedDescription
            }
        }
    }

    private func stopTunnel() {
        guard !self.isTogglingTunnel else { return }
        self.isTogglingTunnel = true

        Task {
            await self.pinggyService.stopTunnel()
            self.tunnelEnabled = false
            self.isTogglingTunnel = false
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
