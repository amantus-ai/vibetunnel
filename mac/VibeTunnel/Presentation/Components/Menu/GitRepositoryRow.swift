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

    var body: some View {
        HStack(spacing: 4) {
            // Git folder icon with hover effect
            Image(systemName: "folder.badge.gearshape")
                .font(.system(size: 10))
                .foregroundColor(isHovering ? AppColors.Fallback.gitFolderHover(for: colorScheme) : AppColors.Fallback
                    .gitFolder(for: colorScheme)
                )
                .scaleEffect(isHovering ? 1.05 : 1.0)
                .animation(.easeInOut(duration: 0.15), value: isHovering)

            // Branch icon and name
            HStack(spacing: 2) {
                Image(systemName: "arrow.branch")
                    .font(.system(size: 9))
                    .foregroundColor(AppColors.Fallback.gitBranch(for: colorScheme))

                Text(repository.branch)
                    .font(.system(size: 10))
                    .foregroundColor(AppColors.Fallback.gitBranch(for: colorScheme))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: 60)
            }

            // Change indicators
            if repository.hasChanges {
                HStack(spacing: 2) {
                    if repository.modifiedFiles > 0 {
                        Text("M:\(repository.modifiedFiles)")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(AppColors.Fallback.gitModified(for: colorScheme))
                    }
                    if repository.addedFiles > 0 {
                        Text("A:\(repository.addedFiles)")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(AppColors.Fallback.gitAdded(for: colorScheme))
                    }
                    if repository.deletedFiles > 0 {
                        Text("D:\(repository.deletedFiles)")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(AppColors.Fallback.gitDeleted(for: colorScheme))
                    }
                    if repository.untrackedFiles > 0 {
                        Text("U:\(repository.untrackedFiles)")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(AppColors.Fallback.gitUntracked(for: colorScheme))
                    }
                }
            } else {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 9))
                    .foregroundColor(AppColors.Fallback.gitClean(for: colorScheme))
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(isHovering ? AppColors.Fallback.gitBackground(for: colorScheme).opacity(0.5) : AppColors.Fallback
                    .gitBackground(for: colorScheme).opacity(0.3)
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .strokeBorder(
                    isHovering ? AppColors.Fallback.gitBorder(for: colorScheme).opacity(0.5) : AppColors.Fallback
                        .gitBorder(for: colorScheme).opacity(0.2),
                    lineWidth: 0.5
                )
        )
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
                NSPasteboard.general.setString(repository.branch, forType: .string)
            }

            Button("Copy Repository Path") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(repository.path, forType: .string)
            }
        }
        .animation(.easeInOut(duration: 0.15), value: isHovering)
    }
}
