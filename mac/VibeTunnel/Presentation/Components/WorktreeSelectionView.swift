import OSLog
import SwiftUI

/// View for selecting or creating Git worktrees
struct WorktreeSelectionView: View {
    let gitRepoPath: String
    @Binding var selectedWorktreePath: String?
    let worktreeService: WorktreeService
    @State private var showCreateWorktree = false
    @Binding var newBranchName: String
    @Binding var createFromBranch: String
    @Binding var shouldCreateNewWorktree: Bool
    @State private var showError = false
    @State private var errorMessage = ""
    @FocusState private var focusedField: Field?

    enum Field: Hashable {
        case branchName
        case baseBranch
    }

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "WorktreeSelectionView")

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: "point.3.connected.trianglepath.dotted")
                    .font(.system(size: 13))
                    .foregroundColor(.accentColor)
                Text("Git Repository Detected")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.secondary)
            }

            if self.worktreeService.isLoading {
                HStack {
                    ProgressView()
                        .scaleEffect(0.8)
                    Text("Loading worktrees...")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.vertical, 8)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    // Current branch info
                    if let currentBranch = worktreeService.worktrees.first(where: { $0.isCurrentWorktree ?? false }) {
                        HStack {
                            Label("Current Branch", systemImage: "arrow.branch")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text(currentBranch.branch)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundColor(.accentColor)
                        }
                    }

                    // Worktree selection
                    if !self.worktreeService.worktrees.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(self.selectedWorktreePath != nil ? "Selected Worktree" : "Select Worktree")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            ScrollView {
                                VStack(spacing: 2) {
                                    ForEach(self.worktreeService.worktrees) { worktree in
                                        WorktreeRow(
                                            worktree: worktree,
                                            isSelected: self.selectedWorktreePath == worktree.path)
                                        {
                                            self.selectedWorktreePath = worktree.path
                                            self.shouldCreateNewWorktree = false
                                            self.showCreateWorktree = false
                                            self.newBranchName = ""
                                            self.createFromBranch = ""
                                        }
                                    }
                                }
                            }
                            .frame(maxHeight: 120)
                        }
                    }

                    // Action buttons or create form
                    if self.showCreateWorktree {
                        // Inline create worktree form
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text("Create New Worktree")
                                    .font(.caption)
                                    .fontWeight(.medium)
                                    .foregroundColor(.secondary)

                                Spacer()

                                Button(action: {
                                    self.showCreateWorktree = false
                                    self.shouldCreateNewWorktree = false
                                    self.newBranchName = ""
                                    self.createFromBranch = ""
                                }, label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.system(size: 12))
                                        .foregroundColor(.secondary)
                                })
                                .buttonStyle(.plain)
                            }

                            TextField("Branch name", text: self.$newBranchName)
                                .textFieldStyle(.roundedBorder)
                                .font(.system(size: 11))
                                .focused(self.$focusedField, equals: .branchName)

                            TextField("Base branch (optional)", text: self.$createFromBranch)
                                .textFieldStyle(.roundedBorder)
                                .font(.system(size: 11))
                                .focused(self.$focusedField, equals: .baseBranch)

                            Text("Leave empty to create from current branch")
                                .font(.system(size: 10))
                                .foregroundColor(.secondary.opacity(0.8))
                        }
                        .padding(.top, 8)
                        .padding(10)
                        .background(Color(NSColor.controlBackgroundColor).opacity(0.5))
                        .cornerRadius(6)
                        .onAppear {
                            self.focusedField = .branchName
                        }
                    } else {
                        HStack(spacing: 8) {
                            Button(action: {
                                self.showCreateWorktree = true
                                self.shouldCreateNewWorktree = true
                            }, label: {
                                Label("New Worktree", systemImage: "plus.circle")
                                    .font(.caption)
                            })
                            .buttonStyle(.link)

                            if let followMode = worktreeService.followMode {
                                Toggle(isOn: .constant(followMode.enabled)) {
                                    Label("Follow Mode", systemImage: "arrow.triangle.2.circlepath")
                                        .font(.caption)
                                }
                                .toggleStyle(.button)
                                .buttonStyle(.link)
                                .disabled(true) // For now, just display status
                            }
                        }
                        .padding(.top, 4)
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(NSColor.controlBackgroundColor).opacity(0.05)))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(Color.accentColor.opacity(0.2), lineWidth: 1))
        .task {
            await self.worktreeService.fetchWorktrees(for: self.gitRepoPath)
        }
        .alert("Error", isPresented: self.$showError) {
            Button("OK") {}
        } message: {
            Text(self.errorMessage)
        }
    }
}

/// Row view for displaying a single worktree
struct WorktreeRow: View {
    let worktree: Worktree
    let isSelected: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: self.onSelect) {
            HStack {
                Image(systemName: (self.worktree.isCurrentWorktree ?? false) ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 10))
                    .foregroundColor((self.worktree.isCurrentWorktree ?? false) ? .accentColor : .secondary)

                VStack(alignment: .leading, spacing: 2) {
                    Text(self.worktree.branch)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundColor(self.isSelected ? .white : .primary)

                    Text(self.shortenPath(self.worktree.path))
                        .font(.system(size: 10))
                        .foregroundColor(self.isSelected ? .white.opacity(0.8) : .secondary)
                }

                Spacer()

                if self.worktree.locked ?? false {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 10))
                        .foregroundColor(.orange)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(self.isSelected ? Color.accentColor : Color.clear)
            .cornerRadius(4)
        }
        .buttonStyle(.plain)
    }

    private func shortenPath(_ path: String) -> String {
        let components = path.components(separatedBy: "/")
        if components.count > 3 {
            return ".../" + components.suffix(2).joined(separator: "/")
        }
        return path
    }
}
