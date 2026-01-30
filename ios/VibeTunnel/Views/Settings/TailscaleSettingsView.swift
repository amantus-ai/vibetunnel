import SwiftUI

/// Content view for Tailscale settings (used within tabs)
struct TailscaleSettingsContent: View {
    @State private var tailscaleService = TailscaleService.shared
    @State private var discoveryService = TailscaleDiscoveryService.shared
    @State private var isRefreshing = false
    @State private var showingCredentialsInput = false
    @State private var clientIdInput = ""
    @State private var clientSecretInput = ""
    @State private var showingResetConfirmation = false
    @State private var credentialSaveError: String?
    @State private var isSavingCredentials = false

    @AppStorage("enableTailscaleDiscovery") private var enableDiscovery = true
    @AppStorage("preferTailscaleConnections") private var preferTailscale = false
    @AppStorage("tailscaleAutoRefresh") private var autoRefresh = true

    private let logger = Logger(category: "TailscaleSettings")

    var body: some View {
        VStack(spacing: Theme.Spacing.large) {
            statusSection
            settingsSection
            discoverySection
            aboutSection
            if tailscaleService.isConfigured {
                resetSection
            }
            Spacer()
        }
        .task {
            await refreshStatus()
            // Start auto-refresh if enabled
            if enableDiscovery && autoRefresh && tailscaleService.isRunning {
                discoveryService.startAutoRefresh()
            }
        }
        .onDisappear {
            // We don't stop auto-refresh when settings disappear
            // because it should continue running in the background
        }
        .refreshable {
            await refreshStatus()
        }
        .alert("Reset Tailscale Configuration", isPresented: $showingResetConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Reset", role: .destructive) {
                resetConfiguration()
            }
        } message: {
            Text(
                "This will remove your API credentials and clear all discovered servers. You'll need to reconfigure Tailscale to use it again."
            )
        }
        .sheet(isPresented: $showingCredentialsInput) {
            NavigationStack {
                Form {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Link your Tailscale account using OAuth client credentials.")
                                .font(.callout)
                                .foregroundColor(.secondary)

                            Text("To get OAuth client credentials:")
                                .font(.caption)
                                .fontWeight(.semibold)
                                .padding(.top, 4)

                            Text("1. Open Tailscale Admin Console")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            Text("2. Go to Settings → OAuth clients")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            Text("3. Click 'Generate OAuth client'")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            Text("4. Add 'devices' scope with read access")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            Text("5. Copy the Client ID (starts with 'k')")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            Text("6. Copy the Client Secret (starts with 'tskey-client-')")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }

                        if let url = URL(string: "https://tailscale.com/kb/1101/api") {
                            Link("Learn More", destination: url)
                                .font(.callout)
                                .foregroundColor(.purple)
                        }
                    }

                    Section {
                        TextField("k4cdcxxxxxxxx", text: $clientIdInput)
                            .textFieldStyle(.roundedBorder)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                            .font(.system(.body, design: .monospaced))
                    } header: {
                        Text("Client ID")
                    } footer: {
                        Text("OAuth Client ID from Tailscale Admin Console")
                            .font(.caption)
                    }

                    Section {
                        SecureField("tskey-client-...", text: $clientSecretInput)
                            .textFieldStyle(.roundedBorder)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                            .font(.system(.body, design: .monospaced))
                    } header: {
                        Text("Client Secret")
                    } footer: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("OAuth Client Secret from Tailscale Admin Console")
                                .font(.caption)
                            Text("This must start with 'tskey-client-'")
                                .font(.caption)
                            Text("Keep this secure - it grants access to your Tailscale network")
                                .font(.caption)
                                .foregroundColor(.orange)
                            Text("Note: Access tokens expire after 1 hour and will auto-refresh")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }

                    // Show loading state when saving
                    if isSavingCredentials {
                        Section {
                            HStack {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle())
                                Text("Connecting to Tailscale...")
                                    .foregroundColor(.secondary)
                                Spacer()
                            }
                            .padding(.vertical, 8)
                        }
                    }

                    // Show error if credentials failed
                    if let error = credentialSaveError {
                        Section {
                            HStack {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundColor(.red)
                                Text(error)
                                    .foregroundColor(.red)
                                    .font(.callout)
                            }
                        }
                    }
                }
                .navigationTitle("Configure Tailscale")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button("Cancel") {
                            showingCredentialsInput = false
                        }
                    }
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button("Save") {
                            // Clear any previous error
                            credentialSaveError = nil

                            // Save credentials (using legacy property names for compatibility)
                            tailscaleService.organization = clientIdInput.isEmpty ? nil : clientIdInput
                            tailscaleService.apiKey = clientSecretInput.isEmpty ? nil : clientSecretInput

                            // Start async task to validate and fetch data
                            Task {
                                // Show loading state
                                isSavingCredentials = true

                                // Validate credentials and fetch devices
                                await tailscaleService.refreshStatus()

                                // If successful, start discovery
                                if tailscaleService.isRunning {
                                    if enableDiscovery {
                                        // Start discovery to find VibeTunnel servers
                                        discoveryService.startDiscovery()

                                        // Wait a moment for discovery to complete
                                        try? await Task.sleep(nanoseconds: 2_000_000_000) // 2 seconds

                                        // Start auto-refresh if enabled
                                        if autoRefresh {
                                            discoveryService.startAutoRefresh()
                                        }
                                    }

                                    // Success! Clear loading state and dismiss
                                    isSavingCredentials = false
                                    showingCredentialsInput = false
                                } else {
                                    // If credentials are invalid, show error
                                    isSavingCredentials = false
                                    credentialSaveError = tailscaleService.statusError ?? "Failed to connect to Tailscale"
                                }
                            }
                        }
                        .fontWeight(.semibold)
                        .disabled(clientIdInput.isEmpty || clientSecretInput.isEmpty || isSavingCredentials)
                    }
                }
            }
            .interactiveDismissDisabled()
        }
    }

    // MARK: - Sections

    @ViewBuilder
    var statusSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            Text("Tailscale Configuration")
                .font(.headline)
                .foregroundColor(Theme.Colors.terminalForeground)

            VStack(spacing: Theme.Spacing.small) {
                HStack {
                    Label("Connection", systemImage: "network")
                    Spacer()
                    statusView
                }

                if tailscaleService.isRunning {
                    if let tailnet = tailscaleService.tailnetName {
                        HStack {
                            Label("Network", systemImage: "globe")
                                .foregroundColor(.secondary)
                            Spacer()
                            Text(tailnet)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }

                    HStack {
                        Label("Devices", systemImage: "desktopcomputer")
                            .foregroundColor(.secondary)
                        Spacer()
                        Text("\(tailscaleService.devices.count)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                if !tailscaleService.isConfigured {
                    Divider()

                    Button {
                        showingCredentialsInput = true
                        clientIdInput = tailscaleService.organization ?? ""
                        clientSecretInput = tailscaleService.apiKey ?? ""
                    } label: {
                        HStack {
                            Image(systemName: "key.fill")
                                .font(.system(size: 16))
                            Text("Configure Tailscale")
                                .font(.system(size: 16))
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 14))
                                .foregroundColor(.secondary)
                        }
                        .foregroundColor(.accentColor)
                    }
                } else {
                    HStack {
                        Label("Credentials", systemImage: "key.fill")
                            .foregroundColor(.secondary)
                        Spacer()
                        Text("Configured")
                            .font(.caption)
                            .foregroundColor(.green)
                        Button {
                            showingCredentialsInput = true
                            clientIdInput = tailscaleService.organization ?? ""
                            clientSecretInput = tailscaleService.apiKey ?? ""
                        } label: {
                            Image(systemName: "pencil.circle")
                                .font(.system(size: 16))
                                .foregroundColor(.accentColor)
                        }
                    }

                    // Add refresh button if not connected
                    if !tailscaleService.isRunning {
                        Divider()
                        Button {
                            Task {
                                isRefreshing = true
                                await tailscaleService.refreshStatus()
                                isRefreshing = false

                                // Start discovery if connected
                                if tailscaleService.isRunning && enableDiscovery {
                                    discoveryService.startDiscovery()
                                    if autoRefresh {
                                        discoveryService.startAutoRefresh()
                                    }
                                }
                            }
                        } label: {
                            HStack {
                                Image(systemName: "arrow.clockwise")
                                    .font(.system(size: 16))
                                Text("Retry Connection")
                                    .font(.system(size: 16))
                                Spacer()
                                if isRefreshing {
                                    ProgressView()
                                        .scaleEffect(0.8)
                                }
                            }
                            .foregroundColor(.accentColor)
                        }
                        .disabled(isRefreshing)
                    }
                }

                if let error = tailscaleService.statusError, !tailscaleService.isConfigured {
                    Divider()
                    HStack {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 14))
                            .foregroundColor(.orange)
                        Text(error)
                            .font(.system(size: 14))
                            .foregroundColor(.orange)
                        Spacer()
                    }
                }
            }
            .padding()
            .background(Theme.Colors.cardBackground)
            .cornerRadius(Theme.CornerRadius.card)
        }
    }

    @ViewBuilder
    var settingsSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            Text("Connection Preferences")
                .font(.headline)
                .foregroundColor(Theme.Colors.terminalForeground)

            VStack(spacing: 0) {
                Toggle(isOn: $enableDiscovery) {
                    Label("Auto-Discover Servers", systemImage: "magnifyingglass")
                }
                .toggleStyle(SwitchToggleStyle(tint: Theme.Colors.primaryAccent))
                .padding()
                .onChange(of: enableDiscovery) { _, newValue in
                    if newValue {
                        Task {
                            discoveryService.startDiscovery()
                            if autoRefresh {
                                discoveryService.startAutoRefresh()
                            }
                        }
                    } else {
                        discoveryService.stopDiscovery()
                        discoveryService.stopAutoRefresh()
                    }
                }

                Divider()

                Toggle(isOn: $preferTailscale) {
                    Label("Prefer Tailscale Connections", systemImage: "lock.shield")
                }
                .toggleStyle(SwitchToggleStyle(tint: Theme.Colors.primaryAccent))
                .padding()
                .disabled(!tailscaleService.isRunning)

                Divider()

                Toggle(isOn: $autoRefresh) {
                    Label("Auto-Refresh Discovery", systemImage: "arrow.triangle.2.circlepath")
                }
                .toggleStyle(SwitchToggleStyle(tint: Theme.Colors.primaryAccent))
                .padding()
                .disabled(!enableDiscovery)
                .onChange(of: autoRefresh) { _, newValue in
                    if newValue && enableDiscovery {
                        discoveryService.startAutoRefresh()
                    } else {
                        discoveryService.stopAutoRefresh()
                    }
                }
            }
            .background(Theme.Colors.cardBackground)
            .cornerRadius(Theme.CornerRadius.card)

            VStack(alignment: .leading, spacing: 4) {
                Text("When enabled, VibeTunnel will automatically use Tailscale for remote connections when available.")
                    .font(.caption)
                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.6))

                if autoRefresh && enableDiscovery && discoveryService.isAutoRefreshing {
                    Text("• Auto-refreshing every 30 seconds")
                        .font(.caption)
                        .foregroundColor(.green.opacity(0.8))
                }
            }
            .padding(.horizontal)
        }
    }

    @ViewBuilder
    var discoverySection: some View {
        if enableDiscovery && tailscaleService.isRunning {
            VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                HStack {
                    Text("Discovered Servers")
                        .font(.headline)
                        .foregroundColor(Theme.Colors.terminalForeground)

                    Spacer()

                    if discoveryService.isAutoRefreshing {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .font(.caption)
                                .foregroundColor(.green)
                            Text("Auto")
                                .font(.caption)
                                .foregroundColor(.green)
                        }
                    }
                }

                VStack(spacing: Theme.Spacing.small) {
                    if discoveryService.isDiscovering {
                        HStack {
                            ProgressView()
                                .scaleEffect(0.8)
                            Text("Discovering servers...")
                                .foregroundColor(.secondary)
                        }
                        .padding()
                    } else if discoveryService.discoveredServers.isEmpty {
                        Text("No VibeTunnel servers found on Tailscale network")
                            .foregroundColor(.secondary)
                            .font(.caption)
                            .padding()
                    } else {
                        ForEach(discoveryService.discoveredServers) { server in
                            DiscoveredTailscaleServerRow(server: server)
                                .padding(.horizontal)
                                .padding(.vertical, 8)
                        }
                    }

                    Button {
                        Task {
                            await discoveryService.refresh()
                        }
                    } label: {
                        Label("Refresh Servers", systemImage: "arrow.clockwise")
                    }
                    .disabled(discoveryService.isDiscovering)
                    .padding()
                }
                .background(Theme.Colors.cardBackground)
                .cornerRadius(Theme.CornerRadius.card)

                if !discoveryService.discoveredServers.isEmpty {
                    Text("\(discoveryService.discoveredServers.count) server(s) found on your Tailscale network")
                        .font(.caption)
                        .foregroundColor(Theme.Colors.terminalForeground.opacity(0.6))
                        .padding(.horizontal)
                }
            }
        }
    }

    @ViewBuilder
    var aboutSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            Text("Resources")
                .font(.headline)
                .foregroundColor(Theme.Colors.terminalForeground)

            VStack(spacing: 0) {
                if let url = URL(string: "https://tailscale.com/kb/") {
                    Link(destination: url) {
                        HStack {
                            Label("Learn About Tailscale", systemImage: "book")
                            Spacer()
                            Image(systemName: "arrow.up.forward")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .padding()
                    }
                }

                Divider()

                if let url = URL(string: "https://tailscale.com/download/ios") {
                    Link(destination: url) {
                        HStack {
                            Label("Tailscale Setup Guide", systemImage: "questionmark.circle")
                            Spacer()
                            Image(systemName: "arrow.up.forward")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .padding()
                    }
                }
            }
            .background(Theme.Colors.cardBackground)
            .cornerRadius(Theme.CornerRadius.card)

            Text(
                "Tailscale provides secure, private networking between your devices without port forwarding or complex configuration."
            )
            .font(.caption)
            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.6))
            .padding(.horizontal)
        }
    }

    @ViewBuilder
    var resetSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
            Text("Danger Zone")
                .font(.headline)
                .foregroundColor(Theme.Colors.terminalForeground)

            VStack(spacing: 0) {
                Button {
                    showingResetConfirmation = true
                } label: {
                    HStack {
                        Label("Reset Tailscale Configuration", systemImage: "trash")
                            .foregroundColor(.red)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundColor(.red.opacity(0.5))
                    }
                    .padding()
                }
            }
            .background(Theme.Colors.cardBackground)
            .cornerRadius(Theme.CornerRadius.card)
            .overlay(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                    .stroke(Color.red.opacity(0.3), lineWidth: 1)
            )

            Text("Removes all Tailscale credentials and discovered servers")
                .font(.caption)
                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.6))
                .padding(.horizontal)
        }
    }

    // MARK: - Helper Views

    @ViewBuilder
    var statusView: some View {
        if isRefreshing {
            ProgressView()
                .scaleEffect(0.8)
        } else if !tailscaleService.isConfigured {
            Label("Not Configured", systemImage: "xmark.circle.fill")
                .foregroundColor(.red)
                .font(.caption)
        } else if tailscaleService.isRunning {
            Label("Connected", systemImage: "checkmark.circle.fill")
                .foregroundColor(.green)
                .font(.caption)
        } else {
            Label("Not Connected", systemImage: "pause.circle.fill")
                .foregroundColor(.orange)
                .font(.caption)
        }
    }

    // MARK: - Methods

    func refreshStatus() async {
        isRefreshing = true
        await tailscaleService.refreshStatus()

        if enableDiscovery && tailscaleService.isRunning {
            await discoveryService.refresh()
        }

        isRefreshing = false
    }

    private func resetConfiguration() {
        // Clear all Tailscale credentials
        tailscaleService.clearCredentials()

        // Reset discovery environment
        discoveryService.resetEnvironment()

        // Reset settings to defaults
        enableDiscovery = true
        preferTailscale = false
        autoRefresh = true

        // Clear input fields
        clientIdInput = ""
        clientSecretInput = ""

        // Force UI refresh by triggering state changes
        // This ensures the UI reflects the cleared state immediately
        Task { @MainActor in
            // Trigger a refresh to update UI
            isRefreshing = true

            // Small delay to ensure UI updates
            try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds

            isRefreshing = false
        }

        logger.info("Tailscale configuration reset completed")
    }
}

/// Row view for discovered Tailscale servers
struct DiscoveredTailscaleServerRow: View {
    let server: TailscaleDiscoveryService.TailscaleServer
    @State private var isAdded = false
    @Environment(\.dismiss) private var dismissSettings

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text(server.displayName)
                    .font(.body)

                HStack {
                    if let ip = server.ip {
                        Text(ip)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    Text("Port \(String(server.port))")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            if isAdded {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)
            } else {
                Button {
                    addServer()
                } label: {
                    Text("Add")
                        .font(.caption)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4)
                        .background(Color.accentColor)
                        .foregroundColor(.white)
                        .cornerRadius(6)
                }
            }
        }
        .opacity(server.isReachable ? 1.0 : 0.6)
    }

    private func addServer() {
        // Convert to ServerConfig and save
        _ = TailscaleDiscoveryService.shared.serverConfig(from: server)

        // Add to known servers
        TailscaleDiscoveryService.shared.addKnownServer(hostname: server.hostname)

        // Use HTTPS URL if available, otherwise construct HTTP URL
        let url: String = if let httpsUrl = server.httpsUrl {
            httpsUrl
        } else {
            "http://\(server.ip ?? server.hostname):\(server.port)"
        }

        // Save as a server profile with complete info using the ServerProfile static method
        let profile = ServerProfile(
            id: UUID(),
            name: server.displayName,
            url: url,
            host: server.ip ?? server.hostname,
            port: server.port,
            tailscaleHostname: server.hostname,
            tailscaleIP: server.ip,
            isTailscaleEnabled: true,
            preferTailscale: true,
            httpsAvailable: server.httpsUrl != nil,
            isPublic: server.isPublic,
            preferSSL: server.httpsUrl != nil
        )

        // Use the proper ServerProfile.save method to ensure it's saved correctly
        ServerProfile.save(profile)

        withAnimation {
            isAdded = true
        }

        // Dismiss the settings view after a brief delay to show the checkmark
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            dismissSettings()
        }
    }
}

/// Standalone settings view for Tailscale integration (used as modal)
struct TailscaleSettingsView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TailscaleSettingsContent()
                .navigationTitle("Tailscale")
                .navigationBarTitleDisplayMode(.large)
                .toolbar {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button("Done") {
                            dismiss()
                        }
                    }
                }
        }
    }
}

// MARK: - Preview

#Preview("Tailscale Settings Content") {
    TailscaleSettingsContent()
}

#Preview("Tailscale Settings Modal") {
    TailscaleSettingsView()
}
