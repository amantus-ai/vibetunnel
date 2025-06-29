import SwiftUI

/// Welcome onboarding view for first-time users.
///
/// Presents a multi-page onboarding experience that introduces VibeTunnel's features
/// on iOS. The view tracks completion state to ensure it's only shown once.
struct WelcomeView: View {
    @State private var currentPage = 0
    @Environment(\.dismiss)
    private var dismiss
    @AppStorage("welcomeCompleted")
    private var welcomeCompleted = false
    @AppStorage("welcomeVersion")
    private var welcomeVersion = 0
    @State private var selectedTheme: TerminalTheme = .vibeTunnel

    private let currentWelcomeVersion = 1

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                VStack(spacing: 0) {
                    // Page content
                    TabView(selection: $currentPage) {
                        WelcomePageView()
                            .tag(0)

                        ConnectServerPageView()
                            .tag(1)

                        TerminalFeaturesPageView(selectedTheme: $selectedTheme)
                            .tag(2)

                        MobileControlsPageView()
                            .tag(3)

                        GetStartedPageView()
                            .tag(4)
                    }
                    .tabViewStyle(PageTabViewStyle(indexDisplayMode: .never))
                    .animation(.easeInOut(duration: 0.3), value: currentPage)

                    // Custom page indicator and navigation
                    VStack(spacing: Theme.Spacing.medium) {
                        // Page indicators
                        HStack(spacing: 8) {
                            ForEach(0..<5) { index in
                                Circle()
                                    .fill(index == currentPage ? Theme.Colors.primaryAccent : Theme.Colors.secondaryText.opacity(0.3))
                                    .frame(width: 8, height: 8)
                                    .animation(.easeInOut, value: currentPage)
                            }
                        }
                        .padding(.top, Theme.Spacing.small)

                        // Navigation buttons
                        HStack(spacing: Theme.Spacing.medium) {
                            if currentPage > 0 {
                                Button(action: {
                                    withAnimation {
                                        currentPage -= 1
                                    }
                                }, label: {
                                    HStack {
                                        Image(systemName: "chevron.left")
                                        Text("Back")
                                    }
                                    .font(Theme.Typography.terminalSystem(size: 16))
                                })
                                .foregroundColor(Theme.Colors.primaryAccent)
                            }

                            Spacer()

                            Button(action: handleNextAction) {
                                Text(currentPage == 4 ? "Get Started" : "Continue")
                                    .font(Theme.Typography.terminalSystem(size: 16, weight: .semibold))
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 24)
                                    .padding(.vertical, 12)
                                    .background(Theme.Colors.primaryAccent)
                                    .cornerRadius(Theme.Layout.cornerRadius)
                            }
                        }
                        .padding(.horizontal, Theme.Spacing.large)
                        .padding(.bottom, geometry.safeAreaInsets.bottom > 0 ? 0 : Theme.Spacing.medium)
                    }
                    .padding(.vertical, Theme.Spacing.medium)
                    .background(Theme.Colors.terminalBackground.opacity(0.95))
                }
            }
            .background(Theme.Colors.terminalBackground)
            .ignoresSafeArea(.keyboard)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Skip") {
                        completeOnboarding()
                    }
                    .font(Theme.Typography.terminalSystem(size: 16))
                    .foregroundColor(Theme.Colors.primaryAccent)
                }
            }
        }
    }

    private func handleNextAction() {
        if currentPage < 4 {
            withAnimation {
                currentPage += 1
            }
        } else {
            completeOnboarding()
        }
    }

    private func completeOnboarding() {
        // Save the selected theme
        TerminalTheme.selected = selectedTheme

        // Mark onboarding as completed
        welcomeCompleted = true
        welcomeVersion = currentWelcomeVersion

        // Generate haptic feedback
        let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
        impactFeedback.impactOccurred()

        dismiss()
    }
}

// MARK: - Individual Page Views

struct WelcomePageView: View {
    var body: some View {
        VStack(spacing: Theme.Spacing.xlarge) {
            Spacer()

            // App icon with glow effect
            ZStack {
                // Glow background
                Image("AppIcon")
                    .resizable()
                    .frame(width: 120, height: 120)
                    .blur(radius: 20)
                    .opacity(0.5)

                // Main icon
                Image("AppIcon")
                    .resizable()
                    .frame(width: 120, height: 120)
                    .cornerRadius(26)
                    .shadow(color: Theme.Colors.primaryAccent.opacity(0.3), radius: 10, y: 5)
            }
            .padding(.bottom, Theme.Spacing.medium)

            VStack(spacing: Theme.Spacing.medium) {
                Text("Welcome to VibeTunnel")
                    .font(Theme.Typography.largeTitle())
                    .multilineTextAlignment(.center)

                Text("Access your terminal sessions from anywhere, right on your iPhone or iPad")
                    .font(Theme.Typography.terminalSystem(size: 17))
                    .foregroundColor(Theme.Colors.secondaryText)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Theme.Spacing.xlarge)
            }

            Spacer()
            Spacer()
        }
        .padding(.horizontal, Theme.Spacing.large)
    }
}

struct ConnectServerPageView: View {
    var body: some View {
        VStack(spacing: Theme.Spacing.xlarge) {
            Spacer()

            // Server connection illustration
            VStack(spacing: Theme.Spacing.medium) {
                Image(systemName: "server.rack")
                    .font(.system(size: 80))
                    .foregroundColor(Theme.Colors.primaryAccent)
                    .padding(.bottom, Theme.Spacing.small)

                Text("Connect to Your Server")
                    .font(Theme.Typography.title())
                    .multilineTextAlignment(.center)

                VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                    FeatureRow(
                        icon: "network",
                        text: "Connect via HTTP or HTTPS"
                    )
                    FeatureRow(
                        icon: "lock.shield",
                        text: "Secure authentication support"
                    )
                    FeatureRow(
                        icon: "clock.arrow.circlepath",
                        text: "Automatic reconnection"
                    )
                }
                .padding(.top, Theme.Spacing.medium)
            }

            Spacer()
            Spacer()
        }
        .padding(.horizontal, Theme.Spacing.xlarge)
    }
}

struct TerminalFeaturesPageView: View {
    @Binding var selectedTheme: TerminalTheme

    var body: some View {
        VStack(spacing: Theme.Spacing.xlarge) {
            Spacer()

            Text("Powerful Terminal Experience")
                .font(Theme.Typography.title())
                .multilineTextAlignment(.center)
                .padding(.horizontal, Theme.Spacing.large)

            // Theme preview
            VStack(spacing: Theme.Spacing.medium) {
                Text("Choose Your Theme")
                    .font(Theme.Typography.terminalSystem(size: 16, weight: .medium))
                    .foregroundColor(Theme.Colors.secondaryText)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.Spacing.small) {
                        ForEach(TerminalTheme.allThemes, id: \.id) { theme in
                            ThemePreviewCard(
                                theme: theme,
                                isSelected: selectedTheme.id == theme.id
                            ) { selectedTheme = theme }
                        }
                    }
                    .padding(.horizontal, Theme.Spacing.large)
                }
            }

            // Features list
            VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                FeatureRow(icon: "keyboard", text: "Advanced keyboard with special keys")
                FeatureRow(icon: "folder", text: "Built-in file browser")
                FeatureRow(icon: "doc.plaintext", text: "Session recording & export")
            }
            .padding(.horizontal, Theme.Spacing.xlarge)
            .padding(.top, Theme.Spacing.medium)

            Spacer()
        }
    }
}

struct MobileControlsPageView: View {
    var body: some View {
        VStack(spacing: Theme.Spacing.xlarge) {
            Spacer()

            Text("Optimized for Mobile")
                .font(Theme.Typography.title())
                .multilineTextAlignment(.center)
                .padding(.horizontal, Theme.Spacing.large)

            // Feature grid
            LazyVGrid(columns: [
                GridItem(.flexible()),
                GridItem(.flexible())
            ], spacing: Theme.Spacing.medium) {
                ControlFeatureCard(
                    icon: "arrow.up.arrow.down",
                    title: "Quick Controls",
                    description: "Access arrow keys and special functions"
                )

                ControlFeatureCard(
                    icon: "textformat.size",
                    title: "Adjustable Text",
                    description: "Customize font size for readability"
                )

                ControlFeatureCard(
                    icon: "rectangle.expand.vertical",
                    title: "Terminal Width",
                    description: "Optimize layout for your screen"
                )

                ControlFeatureCard(
                    icon: "hand.tap",
                    title: "Touch Gestures",
                    description: "Intuitive touch-based interactions"
                )
            }
            .padding(.horizontal, Theme.Spacing.large)

            Spacer()
            Spacer()
        }
    }
}

struct GetStartedPageView: View {
    var body: some View {
        VStack(spacing: Theme.Spacing.xlarge) {
            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 80))
                .foregroundColor(Theme.Colors.success)
                .padding(.bottom, Theme.Spacing.medium)

            Text("You're All Set!")
                .font(Theme.Typography.title())
                .multilineTextAlignment(.center)

            VStack(spacing: Theme.Spacing.medium) {
                Text("Start by connecting to your VibeTunnel server")
                    .font(Theme.Typography.terminalSystem(size: 17))
                    .foregroundColor(Theme.Colors.secondaryText)
                    .multilineTextAlignment(.center)

                VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                    HStack {
                        Image(systemName: "1.circle.fill")
                            .foregroundColor(Theme.Colors.primaryAccent)
                        Text("Enter your server URL")
                            .font(Theme.Typography.terminalSystem(size: 15))
                    }

                    HStack {
                        Image(systemName: "2.circle.fill")
                            .foregroundColor(Theme.Colors.primaryAccent)
                        Text("Add credentials if needed")
                            .font(Theme.Typography.terminalSystem(size: 15))
                    }

                    HStack {
                        Image(systemName: "3.circle.fill")
                            .foregroundColor(Theme.Colors.primaryAccent)
                        Text("Start managing your terminals")
                            .font(Theme.Typography.terminalSystem(size: 15))
                    }
                }
                .padding(.top, Theme.Spacing.large)
            }
            .padding(.horizontal, Theme.Spacing.xlarge)

            Spacer()
            Spacer()
        }
    }
}

// MARK: - Helper Views

struct FeatureRow: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: Theme.Spacing.medium) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundColor(Theme.Colors.primaryAccent)
                .frame(width: 30)

            Text(text)
                .font(Theme.Typography.terminalSystem(size: 16))
                .foregroundColor(Theme.Colors.terminalForeground)

            Spacer()
        }
    }
}

struct ThemePreviewCard: View {
    let theme: TerminalTheme
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        VStack(spacing: 4) {
            // Mini terminal preview
            VStack(spacing: 2) {
                ForEach(0..<3) { _ in
                    HStack(spacing: 2) {
                        Rectangle()
                            .fill(theme.green)
                            .frame(width: 20, height: 2)
                        Rectangle()
                            .fill(theme.blue)
                            .frame(width: 30, height: 2)
                        Spacer()
                    }
                }
            }
            .padding(8)
            .background(theme.background)
            .cornerRadius(6)
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(
                        isSelected ? Theme.Colors.primaryAccent : Color.clear,
                        lineWidth: 2
                    )
            )

            Text(theme.name)
                .font(Theme.Typography.terminalSystem(size: 12))
                .foregroundColor(isSelected ? Theme.Colors.primaryAccent : Theme.Colors.secondaryText)
        }
        .frame(width: 80, height: 80)
        .onTapGesture {
            let impactFeedback = UIImpactFeedbackGenerator(style: .light)
            impactFeedback.impactOccurred()
            onTap()
        }
    }
}

struct ControlFeatureCard: View {
    let icon: String
    let title: String
    let description: String

    var body: some View {
        VStack(spacing: Theme.Spacing.small) {
            Image(systemName: icon)
                .font(.system(size: 30))
                .foregroundColor(Theme.Colors.primaryAccent)

            Text(title)
                .font(Theme.Typography.terminalSystem(size: 14, weight: .semibold))
                .multilineTextAlignment(.center)

            Text(description)
                .font(Theme.Typography.terminalSystem(size: 12))
                .foregroundColor(Theme.Colors.secondaryText)
                .multilineTextAlignment(.center)
        }
        .padding(Theme.Spacing.medium)
        .frame(maxWidth: .infinity)
        .background(Theme.Colors.secondaryBackground)
        .cornerRadius(Theme.Layout.cornerRadius)
    }
}

// MARK: - Preview

#Preview {
    WelcomeView()
}
