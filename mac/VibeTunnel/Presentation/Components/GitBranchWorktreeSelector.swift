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
                    Text(self.selectedWorktree != nil ? "Base Branch for Worktree:" : "Switch to Branch:")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)

                    if self.hasUncommittedChanges, self.selectedWorktree == nil {
                        HStack(spacing: 2) {
                            Image(systemName: "circle.fill")
                                .font(.system(size: 6))
                                .foregroundColor(AppColors.Fallback.gitChanges(for: self.colorScheme))
                            Text("Uncommitted changes")
                                .font(.system(size: 9))
                                .foregroundColor(AppColors.Fallback.gitChanges(for: self.colorScheme))
                        }
                    }
                }

                Menu {
                    ForEach(self.availableBranches, id: \.self) { branch in
                        Button(action: {
                            self.selectedBranch = branch
                            self.onBranchChanged(branch)
                        }, label: {
                            HStack {
                                Text(branch)
                                if branch == self.getCurrentBranch() {
                                    Text("(current)")
                                        .foregroundColor(.secondary)
                                }
                            }
                        })
                    }
                } label: {
                    HStack {
                        Text(self.selectedBranch.isEmpty ? "Select branch" : self.selectedBranch)
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
                .disabled(self.isLoadingBranches || (self.hasUncommittedChanges && self.selectedWorktree == nil))
                .opacity((self.hasUncommittedChanges && self.selectedWorktree == nil) ? 0.5 : 1.0)

                // Status text
                if !self.isLoadingBranches {
                    self.statusText
                }
            }

            // Worktree Selection
            VStack(alignment: .leading, spacing: 4) {
                Text("Worktree:")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)

                if !self.showCreateWorktree {
                    Menu {
                        Button(action: {
                            self.selectedWorktree = nil
                            self.onWorktreeChanged(nil)
                        }, label: {
                            Text(self.worktreeNoneText)
                        })

                        Divider()

                        ForEach(self.availableWorktrees, id: \.id) { worktree in
                            Button(action: {
                                self.selectedWorktree = worktree.branch
                                self.onWorktreeChanged(worktree.branch)
                            }, label: {
                                HStack {
                                    Text(self.formatWorktreeName(worktree))
                                    if self.followMode, self.followBranch == worktree.branch {
                                        Text("⚡️")
                                    }
                                }
                            })
                        }
                    } label: {
                        HStack {
                            Text(self.selectedWorktreeText)
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
                    .disabled(self.isLoadingWorktrees)

                    Button(action: {
                        self.showCreateWorktree = true
                        self.newBranchName = ""
                        self.isNewBranchFieldFocused = true
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
                        TextField("New branch name", text: self.$newBranchName)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12))
                            .focused(self.$isNewBranchFieldFocused)
                            .disabled(self.isCreatingWorktree)
                            .onSubmit {
                                if !self.newBranchName.isEmpty {
                                    self.createWorktree()
                                }
                            }

                        HStack(spacing: 8) {
                            Button("Cancel") {
                                self.showCreateWorktree = false
                                self.newBranchName = ""
                                self.errorMessage = nil
                            }
                            .font(.system(size: 11))
                            .buttonStyle(.plain)
                            .disabled(self.isCreatingWorktree)

                            Button(self.isCreatingWorktree ? "Creating..." : "Create") {
                                self.createWorktree()
                            }
                            .font(.system(size: 11))
                            .buttonStyle(.borderedProminent)
                            .disabled(
                                self.newBranchName.trimmingCharacters(in: .whitespacesAndNewlines)
                                    .isEmpty || self.isCreatingWorktree)
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
            await self.loadGitData()
        }
    }

    // MARK: - Subviews

    @ViewBuilder
    private var statusText: some View {
        VStack(alignment: .leading, spacing: 2) {
            if self.hasUncommittedChanges, self.selectedWorktree == nil {
                Text("Branch switching is disabled due to uncommitted changes. Commit or stash changes first.")
                    .font(.system(size: 9))
                    .foregroundColor(AppColors.Fallback.gitChanges(for: self.colorScheme))
            } else if let worktree = selectedWorktree {
                Text("Session will use worktree: \(worktree)")
                    .font(.system(size: 9))
                    .foregroundColor(.secondary)
            } else if !self.selectedBranch.isEmpty, self.selectedBranch != self.getCurrentBranch() {
                Text("Session will start on \(self.selectedBranch)")
                    .font(.system(size: 9))
                    .foregroundColor(.secondary)
            }

            if self.followMode, let branch = followBranch {
                Text("Follow mode active: following \(branch)")
                    .font(.system(size: 9))
                    .foregroundColor(.accentColor)
            }
        }
    }

    private var worktreeNoneText: String {
        if self.selectedWorktree != nil {
            "No worktree (use main repository)"
        } else if self.availableWorktrees
            .contains(where: { $0.isCurrentWorktree == true && $0.isMainWorktree != true })
        {
            "Switch to main repository"
        } else {
            "No worktree (use main repository)"
        }
    }

    private var selectedWorktreeText: String {
        if let worktree = selectedWorktree,
           let info = availableWorktrees.first(where: { $0.branch == worktree })
        {
            return self.formatWorktreeName(info)
        }
        return self.worktreeNoneText
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
        if self.followMode, self.followBranch == worktree.branch {
            result += " ⚡️ following"
        }
        return result
    }

    private func getCurrentBranch() -> String {
        // Get the actual current branch from GitRepositoryMonitor
        self.gitMonitor.getCachedRepository(for: self.repoPath)?.currentBranch ?? self.selectedBranch
    }

    private func loadGitData() async {
        self.isLoadingBranches = true
        self.isLoadingWorktrees = true

        // Load branches
        let branches = await gitMonitor.getBranches(for: self.repoPath)
        self.availableBranches = branches
        if self.selectedBranch.isEmpty, let firstBranch = branches.first {
            self.selectedBranch = firstBranch
        }
        self.isLoadingBranches = false

        // Load worktrees
        await self.worktreeService.fetchWorktrees(for: self.repoPath)
        self.availableWorktrees = self.worktreeService.worktrees

        // Check follow mode status from the service
        if let followModeStatus = worktreeService.followMode {
            self.followMode = followModeStatus.enabled
            self.followBranch = followModeStatus.targetBranch
        } else {
            self.followMode = false
            self.followBranch = nil
        }

        if let error = worktreeService.error {
            logger.error("Failed to load worktrees: \(error)")
            self.errorMessage = "Failed to load worktrees"
        }
        self.isLoadingWorktrees = false

        // Check for uncommitted changes
        if let repo = await gitMonitor.findRepository(for: repoPath) {
            self.hasUncommittedChanges = repo.hasChanges
        }
    }

    private func createWorktree() {
        let trimmedName = self.newBranchName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else { return }

        self.isCreatingWorktree = true
        self.errorMessage = nil

        Task {
            do {
                try await self.onCreateWorktree(trimmedName, self.selectedBranch.isEmpty ? "main" : self.selectedBranch)
                self.isCreatingWorktree = false
                self.showCreateWorktree = false
                self.newBranchName = ""

                // Reload to show new worktree
                await self.loadGitData()
            } catch {
                self.isCreatingWorktree = false
                self.errorMessage = "Failed to create worktree: \(error.localizedDescription)"
            }
        }
    }
}
