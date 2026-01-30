import SwiftUI

/// Fifth page explaining how to manage multiple AI agent sessions.
///
/// This view provides information about controlling multiple terminal sessions
/// with AI agents, showing how to use the menu bar icon to see all instances,
/// update session names, and use the magic wand feature for automatic naming.
///
/// ## Topics
///
/// ### Overview
/// The agent army control page includes:
/// - Instructions for using the menu bar to view all sessions
/// - Information about session status tracking
/// - Details about renaming sessions and using the magic wand
/// - Explanation of session title display locations
///
/// ### Features
/// - Menu bar session overview
/// - Git change tracking per session
/// - Manual and automatic session naming
/// - Terminal window title management
struct ControlAgentArmyPageView: View {
    var body: some View {
        VStack(spacing: 30) {
            VStack(spacing: 16) {
                Text("Control Your Agent Army")
                    .font(.largeTitle)
                    .fontWeight(.semibold)

                Text(
                    "Click on the VibeTunnel icon in your menu bar to see all open terminal sessions. Track their status, working paths, and Git changes.")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 480)
                    .fixedSize(horizontal: false, vertical: true)

                // VT Title Command
                VStack(spacing: 12) {
                    Text("Update titles from inside your terminal:")
                        .font(.callout)
                        .foregroundColor(.secondary)

                    HStack {
                        Text("vt title \"Current action in project context\"")
                            .font(.system(.body, design: .monospaced))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Color(NSColor.controlBackgroundColor))
                            .cornerRadius(6)
                    }

                    VStack(spacing: 8) {
                        Text(
                            "Session titles appear in the menu bar and terminal windows.\nUse the dashboard to rename sessions manually, or use the magic wand with Claude/Gemini.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: 420)
                            .fixedSize(horizontal: false, vertical: true)

                        if let url = URL(string: "https://steipete.me/posts/command-your-claude-code-army-reloaded") {
                            Link(
                                "Learn more",
                                destination: url)
                                .font(.caption)
                                .foregroundColor(.accentColor)
                        }
                    }
                }
                .padding(.vertical, 12)
            }
            Spacer()
        }
        .padding()
    }
}

// MARK: - Preview

#Preview("Control Agent Army Page") {
    ControlAgentArmyPageView()
        .frame(width: 640, height: 480)
        .background(Color(NSColor.windowBackgroundColor))
}
