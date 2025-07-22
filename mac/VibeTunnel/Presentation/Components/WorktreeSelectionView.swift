import SwiftUI
import OSLog

/// View for selecting or creating Git worktrees
struct WorktreeSelectionView: View {
    let gitRepoPath: String
    @Binding var selectedWorktreePath: String?
    @State private var worktreeService: WorktreeService
    @State private var showCreateWorktree = false
    @State private var newBranchName = ""
    @State private var createFromBranch = ""
    @State private var isCreating = false
    @State private var showError = false
    @State private var errorMessage = ""
    
    private let logger = Logger(subsystem: "ai.vibe.VibeTunnel", category: "WorktreeSelectionView")
    
    init(gitRepoPath: String, selectedWorktreePath: Binding<String?>, serverManager: ServerManager) {
        self.gitRepoPath = gitRepoPath
        self._selectedWorktreePath = selectedWorktreePath
        self._worktreeService = State(initialValue: WorktreeService(serverManager: serverManager))
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Git Repository Detected", systemImage: "git")
                .font(.headline)
                .foregroundColor(.secondary)
            
            if worktreeService.isLoading {
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
                    if let currentBranch = worktreeService.worktrees.first(where: { $0.isCurrentBranch }) {
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
                    if !worktreeService.worktrees.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Select Worktree")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            
                            ForEach(worktreeService.worktrees) { worktree in
                                WorktreeRow(
                                    worktree: worktree,
                                    isSelected: selectedWorktreePath == worktree.path,
                                    onSelect: {
                                        selectedWorktreePath = worktree.path
                                    }
                                )
                            }
                        }
                    }
                    
                    // Action buttons
                    HStack(spacing: 8) {
                        Button(action: { showCreateWorktree.toggle() }) {
                            Label("New Worktree", systemImage: "plus.circle")
                                .font(.caption)
                        }
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
        .padding(12)
        .background(Color(NSColor.controlBackgroundColor))
        .cornerRadius(8)
        .task {
            await worktreeService.fetchWorktrees(for: gitRepoPath)
        }
        .sheet(isPresented: $showCreateWorktree) {
            CreateWorktreeView(
                gitRepoPath: gitRepoPath,
                worktreeService: worktreeService,
                newBranchName: $newBranchName,
                createFromBranch: $createFromBranch,
                isCreating: $isCreating,
                onCreated: { worktreePath in
                    selectedWorktreePath = worktreePath
                    showCreateWorktree = false
                }
            )
        }
        .alert("Error", isPresented: $showError) {
            Button("OK") { }
        } message: {
            Text(errorMessage)
        }
    }
}

/// Row view for displaying a single worktree
struct WorktreeRow: View {
    let worktree: Worktree
    let isSelected: Bool
    let onSelect: () -> Void
    
    var body: some View {
        Button(action: onSelect) {
            HStack {
                Image(systemName: worktree.isCurrentBranch ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 10))
                    .foregroundColor(worktree.isCurrentBranch ? .accentColor : .secondary)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(worktree.branch)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundColor(isSelected ? .white : .primary)
                    
                    Text(shortenPath(worktree.path))
                        .font(.system(size: 10))
                        .foregroundColor(isSelected ? .white.opacity(0.8) : .secondary)
                }
                
                Spacer()
                
                if worktree.isLocked {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 10))
                        .foregroundColor(.orange)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(isSelected ? Color.accentColor : Color.clear)
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

/// View for creating a new worktree
struct CreateWorktreeView: View {
    let gitRepoPath: String
    let worktreeService: WorktreeService
    @Binding var newBranchName: String
    @Binding var createFromBranch: String
    @Binding var isCreating: Bool
    let onCreated: (String) -> Void
    
    @Environment(\.dismiss) private var dismiss
    @State private var showError = false
    @State private var errorMessage = ""
    
    var body: some View {
        VStack(spacing: 16) {
            Text("Create New Worktree")
                .font(.headline)
            
            VStack(alignment: .leading, spacing: 8) {
                TextField("Branch name", text: $newBranchName)
                    .textFieldStyle(.roundedBorder)
                
                TextField("Base branch (optional)", text: $createFromBranch)
                    .textFieldStyle(.roundedBorder)
                    .font(.caption)
                
                Text("Leave empty to create from current branch")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            
            HStack {
                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.escape)
                
                Spacer()
                
                Button("Create") {
                    createWorktree()
                }
                .keyboardShortcut(.return)
                .disabled(newBranchName.isEmpty || isCreating)
            }
        }
        .padding()
        .frame(width: 300)
        .alert("Error", isPresented: $showError) {
            Button("OK") { }
        } message: {
            Text(errorMessage)
        }
    }
    
    private func createWorktree() {
        isCreating = true
        
        Task {
            do {
                let baseBranch = createFromBranch.isEmpty ? nil : createFromBranch
                try await worktreeService.createWorktree(
                    gitRepoPath: gitRepoPath,
                    branch: newBranchName,
                    createBranch: true,
                    baseBranch: baseBranch
                )
                
                // Find the newly created worktree and return its path
                if let newWorktree = worktreeService.worktrees.first(where: { $0.branch == newBranchName }) {
                    await MainActor.run {
                        onCreated(newWorktree.path)
                    }
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showError = true
                    isCreating = false
                }
            }
        }
    }
}