import AppKit
import SwiftUI

/// About view displaying application information, version details, and credits.
///
/// This view provides information about VibeTunnel including version numbers,
/// build details, developer credits, and links to external resources like
/// GitHub repository and support channels.
struct AboutView: View {
    var appName: String {
        Bundle.main.infoDictionary?["CFBundleDisplayName"] as? String ??
            Bundle.main.infoDictionary?["CFBundleName"] as? String ?? "VibeTunnel"
    }

    var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Unknown"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "Unknown"
        return "\(version) (\(build))"
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                appInfoSection
                descriptionSection
                linksSection

                Spacer(minLength: 10)

                copyrightSection
            }
            .frame(maxWidth: .infinity)
            .standardPadding()
        }
        .scrollContentBackground(.hidden)
    }

    private var appInfoSection: some View {
        VStack(spacing: 16) {
            GlowingAppIcon(
                size: 128,
                enableFloating: true,
                enableInteraction: true,
                glowIntensity: 0.3,
                action: openWebsite
            )
            .padding(.bottom, 20)

            Text(appName)
                .font(.largeTitle)
                .fontWeight(.medium)

            Text("Version \(appVersion)")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(.top, 40)
    }

    @MainActor
    private func openWebsite() {
        guard let url = URL(string: "https://vibetunnel.sh") else { return }
        NSWorkspace.shared.open(url)
    }

    private var descriptionSection: some View {
        Text("Turn any browser into your terminal & command your agents on the go.")
            .font(.body)
            .foregroundStyle(.secondary)
    }

    private var linksSection: some View {
        VStack(spacing: 12) {
            HoverableLink(url: "https://vibetunnel.sh", title: "Website", icon: "globe")
            HoverableLink(url: "https://github.com/amantus-ai/vibetunnel", title: "View on GitHub", icon: "link")
            HoverableLink(
                url: "https://github.com/amantus-ai/vibetunnel/issues",
                title: "Report an Issue",
                icon: "exclamationmark.bubble"
            )
            HoverableLink(url: "https://x.com/VibeTunnel", title: "Follow @VibeTunnel", icon: "bird")
        }
    }

    private var copyrightSection: some View {
        VStack(spacing: 16) {
            // Credits
            VStack(spacing: 4) {
                Text("Brought to you by")
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

            // Special Thanks
            VStack(spacing: 8) {
                Text("Special thanks")
                    .font(.caption)
                    .foregroundColor(.secondary)

                VStack(spacing: 4) {
                    HStack(spacing: 4) {
                        Text("Helmut Januschka")
                        Text("•")
                            .foregroundColor(.secondary)
                        Text("Manuel Maly")
                        Text("•")
                            .foregroundColor(.secondary)
                        Text("Piotr Gredowski")
                    }
                    .font(.caption)

                    HStack(spacing: 4) {
                        Text("Billy Irwin")
                        Text("•")
                            .foregroundColor(.secondary)
                        Text("Madhava Jay")
                        Text("•")
                            .foregroundColor(.secondary)
                        Text("Michi Hoffmann")
                    }
                    .font(.caption)

                    HStack(spacing: 4) {
                        Text("Chris Reynolds")
                        Text("•")
                            .foregroundColor(.secondary)
                        Text("Clay Warren")
                        Text("•")
                            .foregroundColor(.secondary)
                        Text("Davi Andrade")
                    }
                    .font(.caption)

                    HStack(spacing: 4) {
                        Text("Igor Tarasenko")
                        Text("•")
                            .foregroundColor(.secondary)
                        Text("Jeff Hurray")
                        Text("•")
                            .foregroundColor(.secondary)
                        Text("Nityesh Agarwal")
                    }
                    .font(.caption)

                    HStack(spacing: 4) {
                        Text("Zhiqiang Zhou")
                        Text("•")
                            .foregroundColor(.secondary)
                        Text("noppe")
                    }
                    .font(.caption)
                }
            }

            Text("© 2025 • MIT Licensed")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(.bottom, 32)
    }
}

/// Hoverable link component with underline animation.
///
/// This component displays a link with an icon that shows an underline on hover
/// and changes the cursor to a pointing hand for better user experience.
struct HoverableLink: View {
    let url: String
    let title: String
    let icon: String

    @State private var isHovering = false

    private var destinationURL: URL {
        URL(string: url) ?? URL(fileURLWithPath: "/")
    }

    var body: some View {
        Link(destination: destinationURL) {
            Label(title, systemImage: icon)
                .underline(isHovering, color: .accentColor)
        }
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

#Preview("About View") {
    AboutView()
        .frame(width: 570, height: 600)
}
