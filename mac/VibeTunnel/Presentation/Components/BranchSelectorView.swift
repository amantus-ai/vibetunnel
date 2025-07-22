import SwiftUI

/// A dropdown view for selecting Git branches
struct BranchSelectorView: View {
    let repoPath: String
    let currentBranch: String?
    let onSelectBranch: (String) -> Void
    
    @Environment(GitRepositoryMonitor.self) private var gitMonitor
    @State private var branches: [String] = []
    @State private var isLoading = true
    @State private var showDropdown = false
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Dropdown button
            Button(action: {
                showDropdown.toggle()
            }) {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.triangle.branch")
                        .font(.system(size: 10))
                    
                    Text(currentBranch ?? "Select branch")
                        .font(.system(size: 11))
                        .lineLimit(1)
                    
                    Image(systemName: showDropdown ? "chevron.up" : "chevron.down")
                        .font(.system(size: 8))
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.secondary.opacity(0.1))
                .cornerRadius(4)
            }
            .buttonStyle(.plain)
            
            // Dropdown menu
            if showDropdown {
                VStack(alignment: .leading, spacing: 0) {
                    if isLoading {
                        HStack {
                            ProgressView()
                                .scaleEffect(0.6)
                            Text("Loading branches...")
                                .font(.system(size: 10))
                                .foregroundColor(.secondary)
                        }
                        .padding(8)
                    } else {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 0) {
                                ForEach(branches, id: \.self) { branch in
                                    Button(action: {
                                        onSelectBranch(branch)
                                        showDropdown = false
                                    }) {
                                        HStack {
                                            if branch == currentBranch {
                                                Image(systemName: "checkmark")
                                                    .font(.system(size: 10))
                                                    .frame(width: 14)
                                            } else {
                                                Color.clear
                                                    .frame(width: 14)
                                            }
                                            
                                            Text(branch)
                                                .font(.system(size: 11))
                                                .foregroundColor(branch == currentBranch ? .accentColor : .primary)
                                            
                                            Spacer()
                                        }
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 4)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .background(
                                        branch == currentBranch ? Color.accentColor.opacity(0.1) : Color.clear
                                    )
                                    
                                    if branch != branches.last {
                                        Divider()
                                            .padding(.horizontal, 8)
                                    }
                                }
                            }
                        }
                        .frame(maxHeight: 200)
                    }
                }
                .background(.regularMaterial)
                .cornerRadius(6)
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color.primary.opacity(0.1), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.1), radius: 4, x: 0, y: 2)
                .offset(y: 4)
            }
        }
        .task {
            await loadBranches()
        }
    }
    
    private func loadBranches() async {
        isLoading = true
        let expandedPath = NSString(string: repoPath).expandingTildeInPath
        branches = await gitMonitor.getBranches(for: expandedPath)
        isLoading = false
    }
}