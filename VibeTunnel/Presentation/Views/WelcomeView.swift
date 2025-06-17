import SwiftUI

/// Welcome onboarding view for first-time users.
///
/// Presents a multi-page onboarding experience that introduces VibeTunnel's features,
/// guides through CLI installation, and explains dashboard security best practices.
/// The view tracks completion state to ensure it's only shown once.
struct WelcomeView: View {
    @State private var currentPage = 0
    @Environment(\.dismiss)
    private var dismiss
    @AppStorage("hasSeenWelcome")
    private var hasSeenWelcome = false
    @State private var cliInstaller = CLIInstaller()

    var body: some View {
        VStack(spacing: 0) {
            // Custom page view implementation for macOS
            ZStack {
                // Page 1: Welcome
                if currentPage == 0 {
                    WelcomePageView()
                        .transition(.asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .leading)))
                }

                // Page 2: VT Command
                if currentPage == 1 {
                    VTCommandPageView(cliInstaller: cliInstaller)
                        .transition(.asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .leading)))
                }

                // Page 3: Protect Your Dashboard
                if currentPage == 2 {
                    ProtectDashboardPageView()
                        .transition(.asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .leading)))
                }

                // Page 4: Accessing Dashboard
                if currentPage == 3 {
                    AccessDashboardPageView()
                        .transition(.asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .leading)))
                }
            }
            .animation(.easeInOut, value: currentPage)

            // Custom page indicators and navigation
            VStack(spacing: 16) {
                // Page indicators
                HStack(spacing: 8) {
                    ForEach(0..<4) { index in
                        Button(action: {
                            withAnimation {
                                currentPage = index
                            }
                        }) {
                            Circle()
                                .fill(index == currentPage ? Color.accentColor : Color.gray.opacity(0.3))
                                .frame(width: 8, height: 8)
                        }
                        .buttonStyle(.plain)
                        .pointingHandCursor()
                    }
                }
                .padding(.top, 12)

                // Navigation button
                HStack {
                    Spacer()

                    Button(action: handleNextAction) {
                        Text(buttonTitle)
                            .frame(minWidth: 80)
                    }
                    .keyboardShortcut(.return)
                    .buttonStyle(.borderedProminent)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
            }
        }
        .frame(width: 640, height: 560)
        .background(Color(NSColor.windowBackgroundColor))
        .onAppear {
            // Always start at the first page when the view appears
            currentPage = 0
        }
    }

    private var buttonTitle: String {
        currentPage == 3 ? "Finish" : "Next"
    }

    private func handleNextAction() {
        if currentPage < 3 {
            withAnimation {
                currentPage += 1
            }
        } else {
            // Finish action - open Settings
            hasSeenWelcome = true
            dismiss()
            SettingsOpener.openSettings()
        }
    }
}

// MARK: - Welcome Page

/// First page of the welcome flow introducing VibeTunnel.
private struct WelcomePageView: View {
    var body: some View {
        VStack(spacing: 40) {
            Spacer()

            // App icon
            Image(nsImage: NSImage(named: "AppIcon") ?? NSImage())
                .resizable()
                .frame(width: 156, height: 156)
                .shadow(radius: 10)

            VStack(spacing: 20) {
                Text("Welcome to VibeTunnel")
                    .font(.largeTitle)
                    .fontWeight(.semibold)

                Text("Turn any browser into your terminal. Command your agents on the go.")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 480)

                Text(
                    "You'll be quickly guided through the basics of VibeTunnel.\nThis screen can always be opened from the settings."
                )
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 480)
                .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()
        }
        .padding()
    }
}

// MARK: - VT Command Page

/// Second page explaining the VT command-line tool and installation.
private struct VTCommandPageView: View {
    var cliInstaller: CLIInstaller

    var body: some View {
        VStack(spacing: 30) {
            Spacer()

            // App icon
            Image(nsImage: NSImage(named: "AppIcon") ?? NSImage())
                .resizable()
                .frame(width: 156, height: 156)
                .shadow(radius: 10)

            VStack(spacing: 16) {
                Text("Capturing Terminal Apps")
                    .font(.largeTitle)
                    .fontWeight(.semibold)

                Text(
                    "VibeTunnel can capture any terminal app or terminal.\nJust prefix it with the `vt` command and it will show up on the dashboard."
                )
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 480)
                .fixedSize(horizontal: false, vertical: true)

                Text("For example, to remote control Claude Code, type:")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)

                Text("vt claude")
                    .font(.system(.body, design: .monospaced))
                    .foregroundColor(.primary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color.gray.opacity(0.1))
                    .cornerRadius(6)

                // Install VT Binary button
                VStack(spacing: 12) {
                    if cliInstaller.isInstalled {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("CLI tool is installed")
                                .foregroundColor(.secondary)
                        }
                    } else {
                        Button("Install VT Command Line Tool") {
                            Task {
                                await cliInstaller.install()
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(cliInstaller.isInstalling)

                        if cliInstaller.isInstalling {
                            ProgressView()
                                .scaleEffect(0.8)
                        }
                    }

                    if let error = cliInstaller.lastError {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                            .frame(maxWidth: 300)
                    }
                }
            }

            Spacer()
        }
        .padding()
        .onAppear {
            cliInstaller.checkInstallationStatus()
        }
    }
}

// MARK: - Protect Dashboard Page

/// Third page explaining dashboard security and access protection.
private struct ProtectDashboardPageView: View {
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var showError = false
    @State private var errorMessage = ""
    @State private var isPasswordSet = false

    private let dashboardKeychain = DashboardKeychain.shared

    var body: some View {
        VStack(spacing: 30) {
            Spacer()

            // App icon
            Image(nsImage: NSImage(named: "AppIcon") ?? NSImage())
                .resizable()
                .frame(width: 156, height: 156)
                .shadow(radius: 10)

            VStack(spacing: 16) {
                Text("Protect Your Dashboard")
                    .font(.largeTitle)
                    .fontWeight(.semibold)

                Text(
                    "If you want to access your dashboard over the network, set a password now.\nOtherwise, it will only be accessible via localhost."
                )
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 480)
                .fixedSize(horizontal: false, vertical: true)

                // Password fields
                VStack(spacing: 12) {
                    SecureField("Password", text: $password)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 300)
                        .onChange(of: password) { _, _ in
                            // Reset password saved state when user starts typing
                            if isPasswordSet {
                                isPasswordSet = false
                            }
                        }

                    SecureField("Confirm Password", text: $confirmPassword)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 300)
                        .onChange(of: confirmPassword) { _, _ in
                            // Reset password saved state when user starts typing
                            if isPasswordSet {
                                isPasswordSet = false
                            }
                        }

                    if showError {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundColor(.red)
                    }

                    if isPasswordSet {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("Password saved securely")
                                .foregroundColor(.secondary)
                        }
                        .font(.caption)
                    } else {
                        Button("Set Password") {
                            setPassword()
                        }
                        .buttonStyle(.bordered)
                        .disabled(password.isEmpty)
                    }

                    Text("Leave empty to skip password protection")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()
        }
        .padding()
    }

    private func setPassword() {
        showError = false

        guard !password.isEmpty else {
            return
        }

        guard password == confirmPassword else {
            errorMessage = "Passwords do not match"
            showError = true
            return
        }

        guard password.count >= 6 else {
            errorMessage = "Password must be at least 6 characters"
            showError = true
            return
        }

        if dashboardKeychain.setPassword(password) {
            isPasswordSet = true
            UserDefaults.standard.set(true, forKey: "dashboardPasswordEnabled")

            // When password is set for the first time, automatically switch to network mode
            let currentMode = DashboardAccessMode(rawValue: UserDefaults.standard
                .string(forKey: "dashboardAccessMode") ?? ""
            ) ?? .localhost
            if currentMode == .localhost {
                UserDefaults.standard.set(DashboardAccessMode.network.rawValue, forKey: "dashboardAccessMode")
                
                // Restart server to apply new bind address for network access
                Task {
                    await ServerManager.shared.restart()
                }
            }
        } else {
            errorMessage = "Failed to save password to keychain"
            showError = true
        }
    }
}

// MARK: - Access Dashboard Page

/// Fourth page showing how to access the dashboard and ngrok integration.
private struct AccessDashboardPageView: View {
    @AppStorage("ngrokEnabled")
    private var ngrokEnabled = false
    @AppStorage("serverPort")
    private var serverPort = "4020"

    var body: some View {
        VStack(spacing: 30) {
            Spacer()

            // App icon
            Image(nsImage: NSImage(named: "AppIcon") ?? NSImage())
                .resizable()
                .frame(width: 156, height: 156)
                .shadow(radius: 10)

            VStack(spacing: 16) {
                Text("Accessing Your Dashboard")
                    .font(.largeTitle)
                    .fontWeight(.semibold)

                Text(
                    "To access your terminals from any device, create a tunnel from your device.\n\nThis can be done via **ngrok** in settings or **Tailscale** (recommended)."
                )
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 480)
                .fixedSize(horizontal: false, vertical: true)

                VStack(spacing: 12) {
                    // Open Dashboard button
                    Button(action: {
                        if let dashboardURL = URL(string: "http://127.0.0.1:\(serverPort)") {
                            NSWorkspace.shared.open(dashboardURL)
                        }
                    }, label: {
                        HStack {
                            Image(systemName: "safari")
                            Text("Open Dashboard")
                        }
                    })
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)

                    // Tailscale link button
                    TailscaleLink()
                }
            }

            // Credits
            VStack(spacing: 4) {
                Text("VibeTunnel is open source and brought to you by")
                    .font(.caption)
                    .foregroundColor(.secondary)

                HStack(spacing: 4) {
                    CreditLink(name: "@badlogic", url: "https://mariozechner.at/")

                    Text("•")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    CreditLink(name: "@mitsuhiko", url: "https://lucumr.pocoo.org/")

                    Text("•")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    CreditLink(name: "@steipete", url: "https://steipete.me")
                }
            }
            .padding(.bottom, 8)
        }
        .padding()
    }
}

// MARK: - Tailscale Link Component

struct TailscaleLink: View {
    @State private var isHovering = false

    var body: some View {
        Button(action: {
            if let tailscaleURL = URL(string: "https://tailscale.com/") {
                NSWorkspace.shared.open(tailscaleURL)
            }
        }, label: {
            HStack {
                Image(systemName: "link")
                Text("Learn more about Tailscale")
                    .underline(isHovering, color: .accentColor)
            }
        })
        .buttonStyle(.link)
        .pointingHandCursor()
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.2)) {
                isHovering = hovering
            }
        }
    }
}

// MARK: - Preview

struct WelcomeView_Previews: PreviewProvider {
    static var previews: some View {
        WelcomeView()
    }
}
