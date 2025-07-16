import AppKit
import SwiftUI

// MARK: - Repository Settings Section

struct RepositorySettingsSection: View {
    @Binding var repositoryBasePath: String

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    TextField("Default base path", text: $repositoryBasePath)
                        .textFieldStyle(.roundedBorder)

                    Button(action: selectDirectory) {
                        Image(systemName: "folder")
                            .font(.system(size: 12))
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.borderless)
                    .help("Choose directory")
                }

                Text("Base path where VibeTunnel will search for Git repositories to show in the New Session form.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("Repository Discovery")
                .font(.headline)
        } footer: {
            Text("Git repositories found in this directory will appear in the New Session form for quick access.")
                .font(.caption)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
    }

    private func selectDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = URL(fileURLWithPath: NSString(string: repositoryBasePath).expandingTildeInPath)

        if panel.runModal() == .OK, let url = panel.url {
            let path = url.path
            let homeDir = NSHomeDirectory()
            if path.hasPrefix(homeDir) {
                repositoryBasePath = "~" + path.dropFirst(homeDir.count)
            } else {
                repositoryBasePath = path
            }
        }
    }
}
