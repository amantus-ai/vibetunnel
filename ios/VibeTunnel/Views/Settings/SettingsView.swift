import SwiftUI

/// Main settings view with tabbed navigation
struct SettingsView: View {
    @Environment(\.dismiss)
    var dismiss
    @State private var selectedTab = SettingsTab.general

    enum SettingsTab: String, CaseIterable {
        case general = "General"
        case advanced = "Advanced"
        case about = "About"

        var icon: String {
            switch self {
            case .general: "gear"
            case .advanced: "gearshape.2"
            case .about: "info.circle"
            }
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Tab selector
                HStack(spacing: 0) {
                    ForEach(SettingsTab.allCases, id: \.self) { tab in
                        Button {
                            withAnimation(Theme.Animation.smooth) {
                                selectedTab = tab
                            }
                        } label: {
                            VStack(spacing: Theme.Spacing.small) {
                                Image(systemName: tab.icon)
                                    .font(.title2)
                                Text(tab.rawValue)
                                    .font(Theme.Typography.terminalSystem(size: 14))
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, Theme.Spacing.medium)
                            .foregroundColor(selectedTab == tab ? Theme.Colors.primaryAccent : Theme.Colors
                                .terminalForeground.opacity(0.5)
                            )
                            .background(
                                selectedTab == tab ? Theme.Colors.primaryAccent.opacity(0.1) : Color.clear
                            )
                        }
                        .buttonStyle(PlainButtonStyle())
                    }
                }
                .background(Theme.Colors.cardBackground)

                Divider()
                    .background(Theme.Colors.terminalForeground.opacity(0.1))

                // Tab content
                ScrollView {
                    VStack(spacing: Theme.Spacing.large) {
                        switch selectedTab {
                        case .general:
                            GeneralSettingsView()
                        case .advanced:
                            AdvancedSettingsView()
                        case .about:
                            AboutSettingsView()
                        }
                    }
                    .padding()
                }
                .background(Theme.Colors.terminalBackground)
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }
            }
        }
    }
}

/// General settings tab content.
/// Provides options for basic app configuration and preferences.
struct GeneralSettingsView: View {
    @AppStorage("defaultFontSize")
    private var defaultFontSize: Double = 14
    @AppStorage("defaultTerminalWidth")
    private var defaultTerminalWidth: Int = 80
    @AppStorage("autoScrollEnabled")
    private var autoScrollEnabled = true
    @AppStorage("enableURLDetection")
    private var enableURLDetection = true
    @AppStorage("enableLivePreviews")
    private var enableLivePreviews = true
    @AppStorage("colorSchemePreference")
    private var colorSchemePreferenceRaw = "system"

    enum ColorSchemePreference: String, CaseIterable {
        case system
        case light
        case dark

        var displayName: String {
            switch self {
            case .system: "System"
            case .light: "Light"
            case .dark: "Dark"
            }
        }
    }

    private var colorSchemePreference: ColorSchemePreference {
        ColorSchemePreference(rawValue: colorSchemePreferenceRaw) ?? .system
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.large) {
            // Appearance Section
            VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                Text("Appearance")
                    .font(.headline)
                    .foregroundColor(Theme.Colors.terminalForeground)

                VStack(spacing: Theme.Spacing.medium) {
                    // Color Scheme
                    VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                        Text("Color Scheme")
                            .font(Theme.Typography.terminalSystem(size: 14))
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))

                        Picker("Color Scheme", selection: $colorSchemePreferenceRaw) {
                            ForEach(ColorSchemePreference.allCases, id: \.self) { preference in
                                Text(preference.displayName).tag(preference.rawValue)
                            }
                        }
                        .pickerStyle(SegmentedPickerStyle())
                    }
                    .padding()
                    .background(Theme.Colors.cardBackground)
                    .cornerRadius(Theme.CornerRadius.card)
                }
            }

            // Terminal Defaults Section
            VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                Text("Terminal Defaults")
                    .font(.headline)
                    .foregroundColor(Theme.Colors.terminalForeground)

                VStack(spacing: Theme.Spacing.medium) {
                    // Font Size
                    VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                        Text("Default Font Size: \(Int(defaultFontSize))pt")
                            .font(Theme.Typography.terminalSystem(size: 14))
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))

                        Slider(value: $defaultFontSize, in: 10...24, step: 1)
                            .accentColor(Theme.Colors.primaryAccent)
                    }
                    .padding()
                    .background(Theme.Colors.cardBackground)
                    .cornerRadius(Theme.CornerRadius.card)

                    // Terminal Width
                    VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                        Text("Default Terminal Width: \(defaultTerminalWidth) columns")
                            .font(Theme.Typography.terminalSystem(size: 14))
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))

                        Picker("Width", selection: $defaultTerminalWidth) {
                            Text("80 columns").tag(80)
                            Text("100 columns").tag(100)
                            Text("120 columns").tag(120)
                            Text("160 columns").tag(160)
                        }
                        .pickerStyle(SegmentedPickerStyle())
                    }
                    .padding()
                    .background(Theme.Colors.cardBackground)
                    .cornerRadius(Theme.CornerRadius.card)

                    // Auto Scroll
                    Toggle(isOn: $autoScrollEnabled) {
                        HStack {
                            Image(systemName: "arrow.down.to.line")
                                .foregroundColor(Theme.Colors.primaryAccent)
                            Text("Auto-scroll to bottom")
                                .font(Theme.Typography.terminalSystem(size: 14))
                                .foregroundColor(Theme.Colors.terminalForeground)
                        }
                    }
                    .toggleStyle(SwitchToggleStyle(tint: Theme.Colors.primaryAccent))
                    .padding()
                    .background(Theme.Colors.cardBackground)
                    .cornerRadius(Theme.CornerRadius.card)

                    // URL Detection
                    Toggle(isOn: $enableURLDetection) {
                        HStack {
                            Image(systemName: "link")
                                .foregroundColor(Theme.Colors.primaryAccent)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Detect URLs")
                                    .font(Theme.Typography.terminalSystem(size: 14))
                                    .foregroundColor(Theme.Colors.terminalForeground)
                                Text("Make URLs clickable in terminal output")
                                    .font(Theme.Typography.terminalSystem(size: 12))
                                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.6))
                            }
                        }
                    }
                    .toggleStyle(SwitchToggleStyle(tint: Theme.Colors.primaryAccent))
                    .padding()
                    .background(Theme.Colors.cardBackground)
                    .cornerRadius(Theme.CornerRadius.card)

                    // Live Previews
                    Toggle(isOn: $enableLivePreviews) {
                        HStack {
                            Image(systemName: "dot.radiowaves.left.and.right")
                                .foregroundColor(Theme.Colors.primaryAccent)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Live Session Previews")
                                    .font(Theme.Typography.terminalSystem(size: 14))
                                    .foregroundColor(Theme.Colors.terminalForeground)
                                Text("Show real-time terminal output in session cards")
                                    .font(Theme.Typography.terminalSystem(size: 12))
                                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.6))
                            }
                        }
                    }
                    .toggleStyle(SwitchToggleStyle(tint: Theme.Colors.primaryAccent))
                    .padding()
                    .background(Theme.Colors.cardBackground)
                    .cornerRadius(Theme.CornerRadius.card)
                }
            }

            Spacer()
        }
    }
}

/// Advanced settings tab content
/// Advanced settings tab content.
/// Offers technical configuration options for power users.
struct AdvancedSettingsView: View {
    @AppStorage("verboseLogging")
    private var verboseLogging = false
    @AppStorage("debugModeEnabled")
    private var debugModeEnabled = false
    @State private var showingSystemLogs = false

    #if targetEnvironment(macCatalyst)
        @AppStorage("macWindowStyle")
        private var macWindowStyleRaw = "standard"
        @State private var windowManager = MacCatalystWindowManager.shared

        private var macWindowStyle: MacWindowStyle {
            macWindowStyleRaw == "inline" ? .inline : .standard
        }
    #endif

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.large) {
            // Logging Section
            VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                Text("Logging & Analytics")
                    .font(.headline)
                    .foregroundColor(Theme.Colors.terminalForeground)

                VStack(spacing: Theme.Spacing.medium) {
                    // Verbose Logging
                    Toggle(isOn: $verboseLogging) {
                        HStack {
                            Image(systemName: "doc.text.magnifyingglass")
                                .foregroundColor(Theme.Colors.primaryAccent)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Verbose Logging")
                                    .font(Theme.Typography.terminalSystem(size: 14))
                                    .foregroundColor(Theme.Colors.terminalForeground)
                                Text("Log detailed debugging information")
                                    .font(Theme.Typography.terminalSystem(size: 12))
                                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.6))
                            }
                        }
                    }
                    .toggleStyle(SwitchToggleStyle(tint: Theme.Colors.primaryAccent))
                    .padding()
                    .background(Theme.Colors.cardBackground)
                    .cornerRadius(Theme.CornerRadius.card)

                    // View System Logs Button
                    Button(action: { showingSystemLogs = true }, label: {
                        HStack {
                            Image(systemName: "doc.text")
                                .foregroundColor(Theme.Colors.primaryAccent)
                            Text("View System Logs")
                                .font(Theme.Typography.terminalSystem(size: 14))
                                .foregroundColor(Theme.Colors.terminalForeground)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                        }
                        .padding()
                        .background(Theme.Colors.cardBackground)
                        .cornerRadius(Theme.CornerRadius.card)
                    })
                    .buttonStyle(PlainButtonStyle())
                }
            }

            #if targetEnvironment(macCatalyst)
                // Mac Catalyst Section
                VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                    Text("Mac Catalyst")
                        .font(.headline)
                        .foregroundColor(Theme.Colors.terminalForeground)

                    VStack(spacing: Theme.Spacing.medium) {
                        // Window Style Picker
                        VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                            Text("Window Style")
                                .font(Theme.Typography.terminalSystem(size: 14))
                                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))

                            Picker("Window Style", selection: $macWindowStyleRaw) {
                                Label("Standard", systemImage: "macwindow")
                                    .tag("standard")
                                Label("Inline Traffic Lights", systemImage: "macwindow.badge.plus")
                                    .tag("inline")
                            }
                            .pickerStyle(SegmentedPickerStyle())
                            .onChange(of: macWindowStyleRaw) { _, newValue in
                                let style: MacWindowStyle = newValue == "inline" ? .inline : .standard
                                windowManager.setWindowStyle(style)
                            }

                            Text(macWindowStyle == .inline ?
                                "Traffic light buttons appear inline with content" :
                                "Standard macOS title bar with traffic lights"
                            )
                            .font(Theme.Typography.terminalSystem(size: 12))
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.6))
                        }
                        .padding()
                        .background(Theme.Colors.cardBackground)
                        .cornerRadius(Theme.CornerRadius.card)
                    }
                }
            #endif

            // Developer Section
            VStack(alignment: .leading, spacing: Theme.Spacing.medium) {
                Text("Developer")
                    .font(.headline)
                    .foregroundColor(Theme.Colors.terminalForeground)

                // Debug Mode Switch - Last element in Advanced section
                Toggle(isOn: $debugModeEnabled) {
                    HStack {
                        Image(systemName: "ladybug")
                            .foregroundColor(Theme.Colors.warningAccent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Debug Mode")
                                .font(Theme.Typography.terminalSystem(size: 14))
                                .foregroundColor(Theme.Colors.terminalForeground)
                            Text("Enable debug features and logging")
                                .font(Theme.Typography.terminalSystem(size: 12))
                                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.6))
                        }
                    }
                }
                .toggleStyle(SwitchToggleStyle(tint: Theme.Colors.warningAccent))
                .padding()
                .background(Theme.Colors.cardBackground)
                .cornerRadius(Theme.CornerRadius.card)
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.CornerRadius.card)
                        .stroke(Theme.Colors.warningAccent.opacity(0.3), lineWidth: 1)
                )
            }

            Spacer()
        }
        .sheet(isPresented: $showingSystemLogs) {
            SystemLogsView()
        }
    }
}

/// About settings tab content
/// About settings tab content.
/// Displays app information, version details, and external links.
struct AboutSettingsView: View {
    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Unknown"
    }

    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "Unknown"
    }

    var body: some View {
        VStack(spacing: Theme.Spacing.xlarge) {
            // App icon and info
            VStack(spacing: Theme.Spacing.large) {
                Image("AppIcon")
                    .resizable()
                    .frame(width: 100, height: 100)
                    .cornerRadius(22)
                    .shadow(color: Theme.Colors.primaryAccent.opacity(0.3), radius: 10, y: 5)

                VStack(spacing: Theme.Spacing.small) {
                    Text("VibeTunnel")
                        .font(.largeTitle)
                        .fontWeight(.bold)

                    Text("Version \(appVersion) (\(buildNumber))")
                        .font(Theme.Typography.terminalSystem(size: 14))
                        .foregroundColor(Theme.Colors.secondaryText)
                }
            }
            .padding(.top, Theme.Spacing.large)

            // Links section
            VStack(spacing: Theme.Spacing.medium) {
                LinkRow(
                    icon: "globe",
                    title: "Website",
                    subtitle: "vibetunnel.sh",
                    url: URL(string: "https://vibetunnel.sh")
                )

                LinkRow(
                    icon: "doc.text",
                    title: "Documentation",
                    subtitle: "Learn how to use VibeTunnel",
                    url: URL(string: "https://docs.vibetunnel.sh")
                )

                LinkRow(
                    icon: "exclamationmark.bubble",
                    title: "Report an Issue",
                    subtitle: "Help us improve",
                    url: URL(string: "https://github.com/vibetunnel/vibetunnel/issues")
                )

                LinkRow(
                    icon: "heart",
                    title: "Rate on App Store",
                    subtitle: "Share your feedback",
                    url: URL(string: "https://apps.apple.com/app/vibetunnel")
                )
            }

            // Credits
            VStack(spacing: Theme.Spacing.small) {
                Text("Made with ❤️ by the VibeTunnel team")
                    .font(Theme.Typography.terminalSystem(size: 12))
                    .foregroundColor(Theme.Colors.secondaryText)
                    .multilineTextAlignment(.center)

                Text("© 2024 VibeTunnel. All rights reserved.")
                    .font(Theme.Typography.terminalSystem(size: 11))
                    .foregroundColor(Theme.Colors.secondaryText.opacity(0.7))
            }
            .padding(.top, Theme.Spacing.large)

            Spacer()
        }
    }
}

/// Reusable row component for external links.
/// Displays a link with icon and opens URLs in the default browser.
struct LinkRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let url: URL?

    var body: some View {
        Button(action: {
            if let url {
                UIApplication.shared.open(url)
            }
        }, label: {
            HStack(spacing: Theme.Spacing.medium) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundColor(Theme.Colors.primaryAccent)
                    .frame(width: 30)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(Theme.Typography.terminalSystem(size: 14))
                        .foregroundColor(Theme.Colors.terminalForeground)

                    Text(subtitle)
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .foregroundColor(Theme.Colors.secondaryText)
                }

                Spacer()

                Image(systemName: "arrow.up.right.square")
                    .font(.system(size: 16))
                    .foregroundColor(Theme.Colors.secondaryText.opacity(0.5))
            }
            .padding()
            .background(Theme.Colors.cardBackground)
            .cornerRadius(Theme.CornerRadius.card)
        })
        .buttonStyle(PlainButtonStyle())
    }
}

#Preview {
    SettingsView()
}
