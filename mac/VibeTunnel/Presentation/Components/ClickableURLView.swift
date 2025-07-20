import AppKit
import SwiftUI

/// A reusable component for displaying clickable URLs with copy and open functionality
struct ClickableURLView: View {
    let label: String
    let url: String
    let showOpenButton: Bool

    @State private var showCopiedFeedback = false

    init(label: String = "URL:", url: String, showOpenButton: Bool = true) {
        self.label = label
        self.url = url
        self.showOpenButton = showOpenButton
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label)
                    .font(.caption)
                    .foregroundColor(.secondary)

                Spacer()

                Button(action: copyURL) {
                    Image(systemName: showCopiedFeedback ? "checkmark" : "doc.on.doc")
                        .foregroundColor(showCopiedFeedback ? .green : .accentColor)
                }
                .buttonStyle(.borderless)
                .help("Copy URL")
            }

            HStack {
                if let nsUrl = URL(string: url) {
                    Link(url, destination: nsUrl)
                        .font(.caption)
                        .foregroundStyle(.blue)
                        .lineLimit(1)
                        .truncationMode(.middle)
                } else {
                    Text(url)
                        .font(.caption)
                        .foregroundColor(.blue)
                        .textSelection(.enabled)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }

                Spacer()

                if showOpenButton {
                    Button(action: openURL) {
                        Image(systemName: "arrow.up.right.square")
                            .foregroundColor(.accentColor)
                    }
                    .buttonStyle(.borderless)
                    .help("Open in Browser")
                }
            }
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 8)
        .background(Color.gray.opacity(0.1))
        .cornerRadius(6)
    }

    private func copyURL() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url, forType: .string)
        withAnimation {
            showCopiedFeedback = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            withAnimation {
                showCopiedFeedback = false
            }
        }
    }

    private func openURL() {
        if let nsUrl = URL(string: url) {
            NSWorkspace.shared.open(nsUrl)
        }
    }
}

/// A simplified inline version for compact display
struct InlineClickableURLView: View {
    let label: String
    let url: String

    @State private var showCopiedFeedback = false

    init(label: String = "URL:", url: String) {
        self.label = label
        self.url = url
    }

    var body: some View {
        HStack(spacing: 5) {
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)

            if let nsUrl = URL(string: url) {
                Link(url, destination: nsUrl)
                    .font(.caption)
                    .foregroundStyle(.blue)
                    .lineLimit(1)
                    .truncationMode(.middle)
            } else {
                Text(url)
                    .font(.caption)
                    .foregroundColor(.blue)
                    .textSelection(.enabled)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Button(action: copyURL) {
                Image(systemName: showCopiedFeedback ? "checkmark" : "doc.on.doc")
                    .foregroundColor(showCopiedFeedback ? .green : .accentColor)
            }
            .buttonStyle(.borderless)
            .help("Copy URL")
        }
    }

    private func copyURL() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url, forType: .string)
        withAnimation {
            showCopiedFeedback = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            withAnimation {
                showCopiedFeedback = false
            }
        }
    }
}

#Preview("Clickable URL View") {
    VStack(spacing: 20) {
        ClickableURLView(
            label: "Public URL:",
            url: "https://example.ngrok.io"
        )

        ClickableURLView(
            label: "Tailscale URL:",
            url: "http://my-machine.tailnet:4020",
            showOpenButton: false
        )

        InlineClickableURLView(
            label: "Inline URL:",
            url: "https://tunnel.cloudflare.com"
        )
    }
    .padding()
    .frame(width: 400)
}
