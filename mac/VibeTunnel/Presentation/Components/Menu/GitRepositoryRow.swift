import SwiftUI

/// Displays git repository information in a compact row.
///
/// Shows repository folder name, current branch, and change status
/// with clickable navigation to open the repository in Finder.
struct GitRepositoryRow: View {
    let repository: GitRepository
    @State private var isHovering = false
    @Environment(\.colorScheme)
    private var colorScheme


    private var branchInfo: some View {
        HStack(spacing: 2) {
            Image(systemName: "arrow.branch")
                .font(.system(size: 9))
                .foregroundColor(AppColors.Fallback.gitBranch(for: colorScheme))

            Text(repository.currentBranch ?? "detached")
                .font(.system(size: 10))
                .foregroundColor(AppColors.Fallback.gitBranch(for: colorScheme))
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: 60)
        }
    }

    private var changeIndicators: some View {
        Group {
            if repository.hasChanges {
                HStack(spacing: 2) {
                    if repository.modifiedCount > 0 {
                        Text("M:\(repository.modifiedCount)")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(AppColors.Fallback.gitModified(for: colorScheme))
                    }
                    if repository.addedCount > 0 {
                        Text("A:\(repository.addedCount)")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(AppColors.Fallback.gitAdded(for: colorScheme))
                    }
                    if repository.deletedCount > 0 {
                        Text("D:\(repository.deletedCount)")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(AppColors.Fallback.gitDeleted(for: colorScheme))
                    }
                    if repository.untrackedCount > 0 {
                        Text("U:\(repository.untrackedCount)")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(AppColors.Fallback.gitUntracked(for: colorScheme))
                    }
                }
            }
        }
    }

    private var backgroundView: some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(backgroundFillColor)
    }

    private var backgroundFillColor: Color {
        let baseColor = AppColors.Fallback.gitBackground(for: colorScheme)
        return isHovering ? baseColor.opacity(0.5) : baseColor.opacity(0.3)
    }

    private var borderView: some View {
        RoundedRectangle(cornerRadius: 4)
            .strokeBorder(borderColor, lineWidth: 0.5)
    }

    private var borderColor: Color {
        let baseColor = AppColors.Fallback.gitBorder(for: colorScheme)
        return isHovering ? baseColor.opacity(0.5) : baseColor.opacity(0.2)
    }

    var body: some View {
        HStack(spacing: 4) {
            branchInfo
            changeIndicators
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(backgroundView)
        .overlay(borderView)
        .onHover { hovering in
            isHovering = hovering
        }
        .onTapGesture {
            NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: repository.path)
        }
        .help("Git: \(repository.path)")
        .contextMenu {
            Button("Open Repository in Finder") {
                NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: repository.path)
            }

            if repository.githubURL != nil {
                Button("Open on GitHub") {
                    if let url = repository.githubURL {
                        NSWorkspace.shared.open(url)
                    }
                }
            }

            Divider()

            Button("Copy Branch Name") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(repository.currentBranch ?? "detached", forType: .string)
            }

            Button("Copy Repository Path") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(repository.path, forType: .string)
            }
        }
        .animation(.easeInOut(duration: 0.15), value: isHovering)
    }
}
