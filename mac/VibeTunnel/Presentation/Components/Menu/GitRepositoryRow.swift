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

    private var gitAppName: String {
        GitAppHelper.getPreferredGitAppName()
    }

    private var branchInfo: some View {
        Text("[\(self.repository.currentBranch ?? "detached")]\(self.repository.isWorktree ? "+" : "")")
            .font(.system(size: 10))
            .foregroundColor(AppColors.Fallback.gitBranch(for: self.colorScheme))
            .lineLimit(1)
            .truncationMode(.middle)
    }

    private var changeIndicators: some View {
        Group {
            if self.repository.hasChanges {
                HStack(spacing: 3) {
                    if self.repository.modifiedCount > 0 {
                        HStack(spacing: 1) {
                            Image(systemName: "arrow.trianglehead.2.clockwise.rotate.90")
                                .font(.system(size: 8))
                                .foregroundColor(AppColors.Fallback.gitModified(for: self.colorScheme))
                            Text("\(self.repository.modifiedCount)")
                                .font(.system(size: 9, weight: .medium))
                                .foregroundColor(AppColors.Fallback.gitModified(for: self.colorScheme))
                        }
                    }
                    if self.repository.untrackedCount > 0 {
                        HStack(spacing: 1) {
                            Image(systemName: "plus")
                                .font(.system(size: 8, weight: .medium))
                                .foregroundColor(AppColors.Fallback.gitAdded(for: self.colorScheme))
                            Text("\(self.repository.untrackedCount)")
                                .font(.system(size: 9, weight: .medium))
                                .foregroundColor(AppColors.Fallback.gitAdded(for: self.colorScheme))
                        }
                    }
                    if self.repository.deletedCount > 0 {
                        HStack(spacing: 1) {
                            Image(systemName: "minus")
                                .font(.system(size: 8, weight: .medium))
                                .foregroundColor(AppColors.Fallback.gitDeleted(for: self.colorScheme))
                            Text("\(self.repository.deletedCount)")
                                .font(.system(size: 9, weight: .medium))
                                .foregroundColor(AppColors.Fallback.gitDeleted(for: self.colorScheme))
                        }
                    }
                }
            }
        }
    }

    private var backgroundView: some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(self.backgroundFillColor)
    }

    private var backgroundFillColor: Color {
        // Show background on hover - stronger in light mode
        if self.isHovering {
            return self.colorScheme == .light
                ? AppColors.Fallback.controlBackground(for: self.colorScheme).opacity(0.25)
                : AppColors.Fallback.controlBackground(for: self.colorScheme).opacity(0.15)
        }
        return Color.clear
    }

    private var borderView: some View {
        RoundedRectangle(cornerRadius: 4)
            .strokeBorder(self.borderColor, lineWidth: 0.5)
    }

    private var borderColor: Color {
        // Show border on hover - stronger in light mode
        if self.isHovering {
            return self.colorScheme == .light
                ? AppColors.Fallback.gitBorder(for: self.colorScheme).opacity(0.3)
                : AppColors.Fallback.gitBorder(for: self.colorScheme).opacity(0.2)
        }
        return Color.clear
    }

    var body: some View {
        HStack(spacing: 4) {
            // Branch info - highest priority
            self.branchInfo
                .layoutPriority(2)

            if self.repository.hasChanges {
                self.changeIndicators
                    .layoutPriority(1)
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
        .background(self.backgroundView)
        .overlay(self.borderView)
        .onHover { hovering in
            self.isHovering = hovering
        }
        .onTapGesture {
            self.openInGitApp()
        }
        .help("Open in \(self.gitAppName)")
        .animation(.easeInOut(duration: 0.15), value: self.isHovering)
    }

    private func openInGitApp() {
        GitAppLauncher.shared.openRepository(at: self.repository.path)
    }
}
