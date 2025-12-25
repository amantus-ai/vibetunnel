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
                Text(self.label)
                    .font(.caption)
                    .foregroundColor(.secondary)

                Spacer()

                Button(action: self.copyURL) {
                    Image(systemName: self.showCopiedFeedback ? "checkmark" : "doc.on.doc")
                        .foregroundColor(self.showCopiedFeedback ? .green : .accentColor)
                }
                .buttonStyle(.borderless)
                .help("Copy URL")
            }

            HStack {
                if let nsUrl = URL(string: url) {
                    Link(self.url, destination: nsUrl)
                        .font(.caption)
                        .foregroundStyle(.blue)
                        .lineLimit(1)
                        .truncationMode(.middle)
                } else {
                    Text(self.url)
                        .font(.caption)
                        .foregroundColor(.blue)
                        .textSelection(.enabled)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }

                Spacer()

                if self.showOpenButton {
                    Button(action: self.openURL) {
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
        NSPasteboard.general.setString(self.url, forType: .string)
        withAnimation {
            self.showCopiedFeedback = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            withAnimation {
                self.showCopiedFeedback = false
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
            Text(self.label)
                .font(.caption)
                .foregroundColor(.secondary)

            if let nsUrl = URL(string: url) {
                Link(self.url, destination: nsUrl)
                    .font(.caption)
                    .foregroundStyle(.blue)
                    .lineLimit(1)
                    .truncationMode(.middle)
            } else {
                Text(self.url)
                    .font(.caption)
                    .foregroundColor(.blue)
                    .textSelection(.enabled)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Button(action: self.copyURL) {
                Image(systemName: self.showCopiedFeedback ? "checkmark" : "doc.on.doc")
                    .foregroundColor(self.showCopiedFeedback ? .green : .accentColor)
            }
            .buttonStyle(.borderless)
            .help("Copy URL")
        }
    }

    private func copyURL() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(self.url, forType: .string)
        withAnimation {
            self.showCopiedFeedback = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            withAnimation {
                self.showCopiedFeedback = false
            }
        }
    }
}

#Preview("Clickable URL View") {
    VStack(spacing: 20) {
        ClickableURLView(
            label: "Public URL:",
            url: "https://example.ngrok.io")

        ClickableURLView(
            label: "Tailscale URL:",
            url: "http://my-machine.tailnet:4020",
            showOpenButton: false)

        InlineClickableURLView(
            label: "Inline URL:",
            url: "https://tunnel.cloudflare.com")
    }
    .padding()
    .frame(width: 400)
}
