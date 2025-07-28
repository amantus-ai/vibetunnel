import Combine
import os.log
import SwiftUI

private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "GitBranchWorktreeSelector")

/// A SwiftUI component for Git branch and worktree selection, mirroring the web UI functionality
struct GitBranchWorktreeSelector: View {
    // MARK: - Properties

    let repoPath: String
    let gitMonitor: GitRepositoryMonitor
    let worktreeService: WorktreeService
    let onBranchChanged: (String) -> Void
    let onWorktreeChanged: (String?) -> Void
    let onCreateWorktree: (String, String) async throws -> Void

    @State private var selectedBranch: String = ""
    @State private var selectedWorktree: String?
    @State private var availableBranches: [String] = []
    @State private var availableWorktrees: [Worktree] = []
    @State private var isLoadingBranches = false
    @State private var isLoadingWorktrees = false
    @State private var showCreateWorktree = false
    @State private var newBranchName = ""
    @State private var isCreatingWorktree = false
    @State private var hasUncommittedChanges = false
    @State private var followMode = false
    @State private var followBranch: String?
    @State private var errorMessage: String?

    @FocusState private var isNewBranchFieldFocused: Bool

    @Environment(\.colorScheme) private var colorScheme

    // MARK: - Body

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Base Branch Selection
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(selectedWorktree != nil ? "Base Branch for Worktree:" : "Switch to Branch:")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)

                    if hasUncommittedChanges && selectedWorktree == nil {
                        HStack(spacing: 2) {
                            Image(systemName: "circle.fill")
                                .font(.system(size: 6))
                                .foregroundColor(AppColors.Fallback.gitChanges(for: colorScheme))
                            Text("Uncommitted changes")
                                .font(.system(size: 9))
                                .foregroundColor(AppColors.Fallback.gitChanges(for: colorScheme))
                        }
                    }
                }

                Menu {
                    ForEach(availableBranches, id: \.self) { branch in
                        Button(action: {
                            selectedBranch = branch
                            onBranchChanged(branch)
                        }, label: {
                            HStack {
                                Text(branch)
                                if branch == getCurrentBranch() {
                                    Text("(current)")
                                        .foregroundColor(.secondary)
                                }
                            }
                        })
                    }
                } label: {
                    HStack {
                        Text(selectedBranch.isEmpty ? "Select branch" : selectedBranch)
                            .font(.system(size: 12))
                            .lineLimit(1)
                        Spacer()
                        Image(systemName: "chevron.down")
                            .font(.system(size: 10))
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(Color.secondary.opacity(0.1))
                    .cornerRadius(4)
                }
                .buttonStyle(.plain)
                .disabled(isLoadingBranches || (hasUncommittedChanges && selectedWorktree == nil))
                .opacity((hasUncommittedChanges && selectedWorktree == nil) ? 0.5 : 1.0)

                // Status text
                if !isLoadingBranches {
                    statusText
                }
            }

            // Worktree Selection
            VStack(alignment: .leading, spacing: 4) {
                Text("Worktree:")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)

                if !showCreateWorktree {
                    Menu {
                        Button(action: {
                            selectedWorktree = nil
                            onWorktreeChanged(nil)
                        }, label: {
                            Text(worktreeNoneText)
                        })

                        Divider()

                        ForEach(availableWorktrees, id: \.id) { worktree in
                            Button(action: {
                                selectedWorktree = worktree.branch
                                onWorktreeChanged(worktree.branch)
                            }, label: {
                                HStack {
                                    Text(formatWorktreeName(worktree))
                                    if followMode && followBranch == worktree.branch {
                                        Text("⚡️")
                                    }
                                }
                            })
                        }
                    } label: {
                        HStack {
                            Text(selectedWorktreeText)
                                .font(.system(size: 12))
                                .lineLimit(1)
                            Spacer()
                            Image(systemName: "chevron.down")
                                .font(.system(size: 10))
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(Color.secondary.opacity(0.1))
                        .cornerRadius(4)
                    }
                    .buttonStyle(.plain)
                    .disabled(isLoadingWorktrees)

                    Button(action: {
                        showCreateWorktree = true
                        newBranchName = ""
                        isNewBranchFieldFocused = true
                    }, label: {
                        HStack(spacing: 4) {
                            Image(systemName: "plus")
                                .font(.system(size: 10))
                            Text("Create new worktree")
                                .font(.system(size: 11))
                        }
                        .foregroundColor(.accentColor)
                    })
                    .buttonStyle(.plain)
                    .padding(.top, 4)
                } else {
                    // Create Worktree Mode
                    VStack(spacing: 8) {
                        TextField("New branch name", text: $newBranchName)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12))
                            .focused($isNewBranchFieldFocused)
                            .disabled(isCreatingWorktree)
                            .onSubmit {
                                if !newBranchName.isEmpty {
                                    createWorktree()
                                }
                            }

                        HStack(spacing: 8) {
                            Button("Cancel") {
                                showCreateWorktree = false
                                newBranchName = ""
                                errorMessage = nil
                            }
                            .font(.system(size: 11))
                            .buttonStyle(.plain)
                            .disabled(isCreatingWorktree)

                            Button(isCreatingWorktree ? "Creating..." : "Create") {
                                createWorktree()
                            }
                            .font(.system(size: 11))
                            .buttonStyle(.borderedProminent)
                            .disabled(
                                newBranchName.trimmingCharacters(in: .whitespacesAndNewlines)
                                    .isEmpty || isCreatingWorktree
                            )
                        }

                        if let error = errorMessage {
                            Text(error)
                                .font(.system(size: 9))
                                .foregroundColor(.red)
                        }
                    }
                }
            }
        }
        .task {
            await loadGitData()
        }
    }

    // MARK: - Subviews

    @ViewBuilder
    private var statusText: some View {
        VStack(alignment: .leading, spacing: 2) {
            if hasUncommittedChanges && selectedWorktree == nil {
                Text("Branch switching is disabled due to uncommitted changes. Commit or stash changes first.")
                    .font(.system(size: 9))
                    .foregroundColor(AppColors.Fallback.gitChanges(for: colorScheme))
            } else if let worktree = selectedWorktree {
                Text("Session will use worktree: \(worktree)")
                    .font(.system(size: 9))
                    .foregroundColor(.secondary)
            } else if !selectedBranch.isEmpty && selectedBranch != getCurrentBranch() {
                Text("Session will start on \(selectedBranch)")
                    .font(.system(size: 9))
                    .foregroundColor(.secondary)
            }

            if followMode, let branch = followBranch {
                Text("Follow mode active: following \(branch)")
                    .font(.system(size: 9))
                    .foregroundColor(.accentColor)
            }
        }
    }

    private var worktreeNoneText: String {
        if selectedWorktree != nil {
            "No worktree (use main repository)"
        } else if availableWorktrees.contains(where: { $0.isCurrentWorktree == true && $0.isMainWorktree != true }) {
            "Switch to main repository"
        } else {
            "No worktree (use main repository)"
        }
    }

    private var selectedWorktreeText: String {
        if let worktree = selectedWorktree,
           let info = availableWorktrees.first(where: { $0.branch == worktree })
        {
            return formatWorktreeName(info)
        }
        return worktreeNoneText
    }

    // MARK: - Methods

    private func formatWorktreeName(_ worktree: Worktree) -> String {
        let folderName = URL(fileURLWithPath: worktree.path).lastPathComponent
        // Strip refs/heads/ prefix from branch name for comparison and display
        let branchName = worktree.branch.replacingOccurrences(of: "refs/heads/", with: "")
        let showBranch = folderName.lowercased() != branchName.lowercased() &&
            !folderName.lowercased().hasSuffix("-\(branchName.lowercased())")

        var result = folderName
        if showBranch {
            result += " [\(branchName)]"
        }
        if worktree.isMainWorktree == true {
            result += " (main)"
        }
        if worktree.isCurrentWorktree == true {
            result += " (current)"
        }
        if followMode && followBranch == worktree.branch {
            result += " ⚡️ following"
        }
        return result
    }

    private func getCurrentBranch() -> String {
        // Get the actual current branch from GitRepositoryMonitor
        gitMonitor.getCachedRepository(for: repoPath)?.currentBranch ?? selectedBranch
    }

    private func loadGitData() async {
        isLoadingBranches = true
        isLoadingWorktrees = true

        // Load branches
        let branches = await gitMonitor.getBranches(for: repoPath)
        availableBranches = branches
        if selectedBranch.isEmpty, let firstBranch = branches.first {
            selectedBranch = firstBranch
        }
        isLoadingBranches = false

        // Load worktrees
        await worktreeService.fetchWorktrees(for: repoPath)
        availableWorktrees = worktreeService.worktrees

        // Check follow mode status from the service
        if let followModeStatus = worktreeService.followMode {
            followMode = followModeStatus.enabled
            followBranch = followModeStatus.targetBranch
        } else {
            followMode = false
            followBranch = nil
        }

        if let error = worktreeService.error {
            logger.error("Failed to load worktrees: \(error)")
            errorMessage = "Failed to load worktrees"
        }
        isLoadingWorktrees = false

        // Check for uncommitted changes
        if let repo = await gitMonitor.findRepository(for: repoPath) {
            hasUncommittedChanges = repo.hasChanges
        }
    }

    private func createWorktree() {
        let trimmedName = newBranchName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else { return }

        isCreatingWorktree = true
        errorMessage = nil

        Task {
            do {
                try await onCreateWorktree(trimmedName, selectedBranch.isEmpty ? "main" : selectedBranch)
                isCreatingWorktree = false
                showCreateWorktree = false
                newBranchName = ""

                // Reload to show new worktree
                await loadGitData()
            } catch {
                isCreatingWorktree = false
                errorMessage = "Failed to create worktree: \(error.localizedDescription)"
            }
        }
    }
}
