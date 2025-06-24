import SwiftUI

/// First page of the welcome flow introducing VibeTunnel.
///
/// This view presents the initial onboarding screen with the app icon,
/// welcome message, and brief description of VibeTunnel's capabilities.
/// It serves as the entry point to the onboarding experience.
///
/// ## Topics
///
/// ### Overview
/// The welcome page displays:
/// - VibeTunnel app icon with shadow effect
/// - Welcome title and tagline
/// - Brief explanation of the onboarding process
struct WelcomePageView: View {
    var body: some View {
        VStack(spacing: 40) {
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
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}

// MARK: - Preview

#Preview("Welcome Page") {
    WelcomePageView()
        .frame(width: 640, height: 480)
        .background(Color(NSColor.windowBackgroundColor))
}
