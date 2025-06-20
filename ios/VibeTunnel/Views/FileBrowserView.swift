import SwiftUI

struct FileBrowserView: View {
    @StateObject private var viewModel = FileBrowserViewModel()
    @Environment(\.dismiss) private var dismiss
    
    let onSelect: (String) -> Void
    let initialPath: String
    
    init(initialPath: String = "~", onSelect: @escaping (String) -> Void) {
        self.initialPath = initialPath
        self.onSelect = onSelect
    }
    
    var body: some View {
        NavigationStack {
            ZStack {
                // Background
                Color.black.ignoresSafeArea()
                
                VStack(spacing: 0) {
                    // Current path display
                    HStack(spacing: 12) {
                        Image(systemName: "folder.fill")
                            .foregroundColor(Theme.Colors.terminalAccent)
                            .font(.system(size: 16))
                        
                        Text(viewModel.currentPath)
                            .font(.custom("SF Mono", size: 14))
                            .foregroundColor(Theme.Colors.terminalGray)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .background(Theme.Colors.terminalDarkGray)
                    
                    // File list
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            // Parent directory
                            if viewModel.canGoUp {
                                FileBrowserRow(
                                    name: "..",
                                    isDirectory: true,
                                    isParent: true,
                                    onTap: {
                                        viewModel.navigateToParent()
                                    }
                                )
                                .transition(.opacity)
                            }
                            
                            // Directories first, then files
                            ForEach(viewModel.sortedEntries) { entry in
                                FileBrowserRow(
                                    name: entry.name,
                                    isDirectory: entry.isDir,
                                    size: entry.isDir ? nil : entry.formattedSize,
                                    modifiedTime: entry.formattedDate,
                                    onTap: {
                                        if entry.isDir {
                                            viewModel.navigate(to: entry.path)
                                        }
                                    }
                                )
                                .transition(.opacity)
                            }
                        }
                        .padding(.vertical, 8)
                    }
                    .overlay(alignment: .center) {
                        if viewModel.isLoading {
                            VStack(spacing: 16) {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: Theme.Colors.terminalAccent))
                                    .scaleEffect(1.2)
                                
                                Text("Loading...")
                                    .font(.custom("SF Mono", size: 14))
                                    .foregroundColor(Theme.Colors.terminalGray)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(Color.black.opacity(0.8))
                        }
                    }
                    
                    // Bottom toolbar
                    HStack(spacing: 20) {
                        // Cancel button
                        Button(action: { dismiss() }) {
                            Text("cancel")
                                .font(.custom("SF Mono", size: 14))
                                .foregroundColor(Theme.Colors.terminalGray)
                                .padding(.horizontal, 20)
                                .padding(.vertical, 10)
                                .background(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(Theme.Colors.terminalGray.opacity(0.3), lineWidth: 1)
                                )
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(TerminalButtonStyle())
                        
                        Spacer()
                        
                        // Create folder button
                        Button(action: { viewModel.showCreateFolder = true }) {
                            Label("new folder", systemImage: "folder.badge.plus")
                                .font(.custom("SF Mono", size: 14))
                                .foregroundColor(Theme.Colors.terminalAccent)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)
                                .background(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(Theme.Colors.terminalAccent.opacity(0.5), lineWidth: 1)
                                )
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(TerminalButtonStyle())
                        
                        // Select button
                        Button(action: { 
                            onSelect(viewModel.currentPath)
                            dismiss()
                        }) {
                            Text("select")
                                .font(.custom("SF Mono", size: 14))
                                .foregroundColor(.black)
                                .padding(.horizontal, 24)
                                .padding(.vertical, 10)
                                .background(
                                    RoundedRectangle(cornerRadius: 8)
                                        .fill(Theme.Colors.terminalAccent)
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .fill(Theme.Colors.terminalAccent.opacity(0.3))
                                        .blur(radius: 10)
                                )
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(TerminalButtonStyle())
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .background(Theme.Colors.terminalDarkGray)
                }
            }
            .navigationBarHidden(true)
            .alert("Create Folder", isPresented: $viewModel.showCreateFolder) {
                TextField("Folder name", text: $viewModel.newFolderName)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                
                Button("Cancel", role: .cancel) {
                    viewModel.newFolderName = ""
                }
                
                Button("Create") {
                    viewModel.createFolder()
                }
                .disabled(viewModel.newFolderName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } message: {
                Text("Enter a name for the new folder")
            }
            .alert("Error", isPresented: $viewModel.showError, presenting: viewModel.errorMessage) { _ in
                Button("OK") { }
            } message: { error in
                Text(error)
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            viewModel.loadDirectory(path: initialPath)
        }
    }
}

struct FileBrowserRow: View {
    let name: String
    let isDirectory: Bool
    let isParent: Bool
    let size: String?
    let modifiedTime: String?
    let onTap: () -> Void
    
    init(name: String, isDirectory: Bool, isParent: Bool = false, size: String? = nil, modifiedTime: String? = nil, onTap: @escaping () -> Void) {
        self.name = name
        self.isDirectory = isDirectory
        self.isParent = isParent
        self.size = size
        self.modifiedTime = modifiedTime
        self.onTap = onTap
    }
    
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                // Icon
                Image(systemName: isDirectory ? "folder.fill" : "doc.text.fill")
                    .foregroundColor(isDirectory ? Theme.Colors.terminalAccent : Theme.Colors.terminalGray.opacity(0.6))
                    .font(.system(size: 16))
                    .frame(width: 24)
                
                // Name
                Text(name)
                    .font(.custom("SF Mono", size: 14))
                    .foregroundColor(isParent ? Theme.Colors.terminalAccent : (isDirectory ? Theme.Colors.terminalWhite : Theme.Colors.terminalGray))
                    .lineLimit(1)
                    .truncationMode(.middle)
                
                Spacer()
                
                // Details
                if !isParent {
                    VStack(alignment: .trailing, spacing: 2) {
                        if let size = size {
                            Text(size)
                                .font(.custom("SF Mono", size: 11))
                                .foregroundColor(Theme.Colors.terminalGray.opacity(0.6))
                        }
                        
                        if let modifiedTime = modifiedTime {
                            Text(modifiedTime)
                                .font(.custom("SF Mono", size: 11))
                                .foregroundColor(Theme.Colors.terminalGray.opacity(0.5))
                        }
                    }
                }
                
                // Chevron for directories
                if isDirectory && !isParent {
                    Image(systemName: "chevron.right")
                        .foregroundColor(Theme.Colors.terminalGray.opacity(0.4))
                        .font(.system(size: 12, weight: .medium))
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(PlainButtonStyle())
        .background(
            Theme.Colors.terminalGray.opacity(0.05)
                .opacity(isDirectory ? 1 : 0)
        )
    }
}

struct TerminalButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
            .opacity(configuration.isPressed ? 0.8 : 1.0)
            .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
    }
}

@MainActor
class FileBrowserViewModel: ObservableObject {
    @Published var currentPath = "~"
    @Published var entries: [FileEntry] = []
    @Published var isLoading = false
    @Published var showCreateFolder = false
    @Published var newFolderName = ""
    @Published var showError = false
    @Published var errorMessage: String?
    
    private let apiClient = APIClient.shared
    
    var sortedEntries: [FileEntry] {
        entries.sorted { entry1, entry2 in
            // Directories come first
            if entry1.isDir != entry2.isDir {
                return entry1.isDir
            }
            // Then sort by name
            return entry1.name.localizedCaseInsensitiveCompare(entry2.name) == .orderedAscending
        }
    }
    
    var canGoUp: Bool {
        currentPath != "/" && currentPath != "~"
    }
    
    func loadDirectory(path: String) {
        Task {
            await loadDirectoryAsync(path: path)
        }
    }
    
    @MainActor
    private func loadDirectoryAsync(path: String) async {
        isLoading = true
        defer { isLoading = false }
        
        do {
            let result = try await apiClient.browseDirectory(path: path)
            // Use the absolute path returned by the server
            currentPath = result.absolutePath
            withAnimation(.easeInOut(duration: 0.2)) {
                entries = result.files
            }
        } catch {
            print("[FileBrowser] Failed to load directory: \(error)")
            errorMessage = "Failed to load directory: \(error.localizedDescription)"
            showError = true
        }
    }
    
    func navigate(to path: String) {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        loadDirectory(path: path)
    }
    
    func navigateToParent() {
        let parentPath = URL(fileURLWithPath: currentPath).deletingLastPathComponent().path
        navigate(to: parentPath)
    }
    
    func createFolder() {
        let folderName = newFolderName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !folderName.isEmpty else { return }
        
        Task {
            await createFolderAsync(name: folderName)
        }
    }
    
    @MainActor
    private func createFolderAsync(name: String) async {
        do {
            let fullPath = currentPath + "/" + name
            try await apiClient.createDirectory(path: fullPath)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            newFolderName = ""
            // Reload directory to show new folder
            await loadDirectoryAsync(path: currentPath)
        } catch {
            print("[FileBrowser] Failed to create folder: \(error)")
            errorMessage = "Failed to create folder: \(error.localizedDescription)"
            showError = true
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }
}

#Preview {
    FileBrowserView { path in
        print("Selected path: \(path)")
    }
}