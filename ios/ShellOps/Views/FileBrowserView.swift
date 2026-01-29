import Observation
import QuickLook
import SwiftUI

/// File browser for navigating the server's file system.
///
/// Provides a hierarchical view of directories and files with
/// navigation, selection, and directory creation capabilities.
struct FileBrowserView: View {
    @State private var viewModel = FileBrowserViewModel()
    @Environment(\.dismiss)
    private var dismiss
    @State private var showingFileEditor = false
    @State private var showingNewFileAlert = false
    @State private var newFileName = ""
    @State private var selectedFile: FileEntry?
    @State private var showingDeleteAlert = false
    @StateObject private var quickLookManager = QuickLookManager.shared
    @State private var showingQuickLook = false
    @State private var showingFilePreview = false
    @State private var previewPath: String?

    let onSelect: (String) -> Void
    let initialPath: String
    let mode: FileBrowserMode
    let onInsertPath: ((String, Bool) -> Void)? // Path and isDirectory

    enum FileBrowserMode {
        case selectDirectory
        case browseFiles
        case insertPath // New mode for inserting paths into terminal
    }

    init(
        initialPath: String = "~",
        mode: FileBrowserMode = .selectDirectory,
        onSelect: @escaping (String) -> Void,
        onInsertPath: ((String, Bool) -> Void)? = nil)
    {
        self.initialPath = initialPath
        self.mode = mode
        self.onSelect = onSelect
        self.onInsertPath = onInsertPath
    }

    private var navigationHeader: some View {
        HStack(spacing: 16) {
            // Back button
            if self.viewModel.canGoUp {
                Button {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    self.viewModel.navigateToParent()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 14, weight: .semibold))
                        Text("Back")
                            .font(.custom("SF Mono", size: 14))
                    }
                    .foregroundColor(Theme.Colors.terminalAccent)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .fill(Theme.Colors.terminalAccent.opacity(0.1)))
                }
                .buttonStyle(TerminalButtonStyle())
            }

            // Current path display
            HStack(spacing: 8) {
                Image(systemName: "folder.fill")
                    .foregroundColor(Theme.Colors.terminalAccent)
                    .font(.system(size: 16))

                Text(self.viewModel.displayPath)
                    .font(.custom("SF Mono", size: 14))
                    .foregroundColor(Theme.Colors.terminalGray)
                    .lineLimit(1)
                    .truncationMode(.middle)

                // Git branch indicator
                if let gitStatus = viewModel.gitStatus, gitStatus.isGitRepo, let branch = gitStatus.branch {
                    Text("📍 \(branch)")
                        .font(.custom("SF Mono", size: 12))
                        .foregroundColor(Theme.Colors.terminalGray.opacity(0.8))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .background(Theme.Colors.terminalDarkGray)
    }

    private var filterToolbar: some View {
        HStack(spacing: 12) {
            // Git filter toggle
            Button {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                self.viewModel.gitFilter = self.viewModel.gitFilter == .all ? .changed : .all
                self.viewModel.loadDirectory(path: self.viewModel.currentPath)
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.triangle.branch")
                        .font(.system(size: 12))
                    Text(self.viewModel.gitFilter == .changed ? "Git Changes" : "All Files")
                        .font(.custom("SF Mono", size: 12))
                }
                .foregroundColor(
                    self.viewModel.gitFilter == .changed ? Theme.Colors.successAccent : Theme.Colors
                        .terminalGray)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(
                            self.viewModel.gitFilter == .changed ? Theme.Colors.successAccent.opacity(0.2) : Theme
                                .Colors
                                .terminalGray.opacity(0.1)))
            }
            .buttonStyle(TerminalButtonStyle())

            // Hidden files toggle
            Button {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                self.viewModel.showHidden.toggle()
                self.viewModel.loadDirectory(path: self.viewModel.currentPath)
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: self.viewModel.showHidden ? "eye" : "eye.slash")
                        .font(.system(size: 12))
                    Text("Hidden")
                        .font(.custom("SF Mono", size: 12))
                }
                .foregroundColor(self.viewModel.showHidden ? Theme.Colors.terminalAccent : Theme.Colors.terminalGray)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(
                            self.viewModel.showHidden ? Theme.Colors.terminalAccent.opacity(0.2) : Theme.Colors
                                .terminalGray.opacity(0.1)))
            }
            .buttonStyle(TerminalButtonStyle())

            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(Theme.Colors.terminalDarkGray.opacity(0.5))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                // Background
                Theme.Colors.terminalBackground.ignoresSafeArea()

                VStack(spacing: 0) {
                    self.navigationHeader
                    self.filterToolbar

                    // File list
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            // Directories first, then files
                            ForEach(self.viewModel.sortedEntries) { entry in
                                FileBrowserRow(
                                    name: entry.name,
                                    isDirectory: entry.isDir,
                                    size: entry.isDir ? nil : entry.formattedSize,
                                    modifiedTime: entry.formattedDate,
                                    gitStatus: entry.gitStatus)
                                {
                                    if entry.isDir, self.mode != .insertPath {
                                        self.viewModel.navigate(to: entry.path)
                                    } else if self.mode == .browseFiles {
                                        // Preview file with our custom preview
                                        self.previewPath = entry.path
                                        self.showingFilePreview = true
                                    } else if self.mode == .insertPath {
                                        // Insert the path into terminal
                                        self.insertPath(entry.path, isDirectory: entry.isDir)
                                    }
                                }
                                .transition(.opacity)
                                // Context menu disabled - file operations not implemented in backend
                                // .contextMenu {
                                //    if mode == .browseFiles && !entry.isDir {
                                //        Button(action: {
                                //            selectedFile = entry
                                //            showingFileEditor = true
                                //        }) {
                                //            Label("Edit", systemImage: "pencil")
                                //        }
                                //
                                //        Button(role: .destructive, action: {
                                //            selectedFile = entry
                                //            showingDeleteAlert = true
                                //        }) {
                                //            Label("Delete", systemImage: "trash")
                                //        }
                                //    }
                                // }
                            }
                        }
                        .padding(.vertical, 8)
                    }
                    .overlay(alignment: .center) {
                        if self.viewModel.isLoading {
                            VStack(spacing: 16) {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: Theme.Colors.terminalAccent))
                                    .scaleEffect(1.2)

                                Text("Loading...")
                                    .font(.custom("SF Mono", size: 14))
                                    .foregroundColor(Theme.Colors.terminalGray)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(Theme.Colors.terminalBackground.opacity(0.8))
                        }
                    }

                    // Bottom toolbar
                    HStack(spacing: 20) {
                        // Cancel button
                        Button(action: { self.dismiss() }, label: {
                            Text("cancel")
                                .font(.custom("SF Mono", size: 14))
                                .foregroundColor(Theme.Colors.terminalGray)
                                .padding(.horizontal, 20)
                                .padding(.vertical, 10)
                                .background(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(Theme.Colors.terminalGray.opacity(0.3), lineWidth: 1))
                                .contentShape(Rectangle())
                        })
                        .buttonStyle(TerminalButtonStyle())

                        Spacer()

                        // Create folder button
                        Button(action: { self.viewModel.showCreateFolder = true }, label: {
                            Label("new folder", systemImage: "folder.badge.plus")
                                .font(.custom("SF Mono", size: 14))
                                .foregroundColor(Theme.Colors.terminalAccent)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 10)
                                .background(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(Theme.Colors.terminalAccent.opacity(0.5), lineWidth: 1))
                                .contentShape(Rectangle())
                        })
                        .buttonStyle(TerminalButtonStyle())

                        // Create file button (disabled - not implemented in backend)
                        // Uncomment when file operations are implemented
                        // if mode == .browseFiles {
                        //    Button(action: { showingNewFileAlert = true }, label: {
                        //        Label("new file", systemImage: "doc.badge.plus")
                        //            .font(.custom("SF Mono", size: 14))
                        //            .foregroundColor(Theme.Colors.terminalAccent)
                        //            .padding(.horizontal, 16)
                        //            .padding(.vertical, 10)
                        //            .background(
                        //                RoundedRectangle(cornerRadius: 8)
                        //                    .stroke(Theme.Colors.terminalAccent.opacity(0.5), lineWidth: 1)
                        //            )
                        //            .contentShape(Rectangle())
                        //    })
                        //    .buttonStyle(TerminalButtonStyle())
                        // }

                        // Select button (only in selectDirectory mode)
                        if self.mode == .selectDirectory {
                            Button(action: {
                                self.onSelect(self.viewModel.currentPath)
                                self.dismiss()
                            }, label: {
                                Text("select")
                                    .font(.custom("SF Mono", size: 14))
                                    .foregroundColor(Theme.Colors.terminalBackground)
                                    .padding(.horizontal, 24)
                                    .padding(.vertical, 10)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(Theme.Colors.terminalAccent))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(Theme.Colors.terminalAccent.opacity(0.3))
                                            .blur(radius: 10))
                                    .contentShape(Rectangle())
                            })
                            .buttonStyle(TerminalButtonStyle())
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 16)
                    .background(Theme.Colors.terminalDarkGray)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .alert("Create Folder", isPresented: self.$viewModel.showCreateFolder) {
                TextField("Folder name", text: self.$viewModel.newFolderName)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                Button("Cancel", role: .cancel) {
                    self.viewModel.newFolderName = ""
                }

                Button("Create") {
                    self.viewModel.createFolder()
                }
                .disabled(self.viewModel.newFolderName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } message: {
                Text("Enter a name for the new folder")
            }
            .alert("Error", isPresented: self.$viewModel.showError, presenting: self.viewModel.errorMessage) { _ in
                Button("OK") {}
            } message: { error in
                Text(error)
            }
            .alert("Create File", isPresented: self.$showingNewFileAlert) {
                TextField("File name", text: self.$newFileName)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                Button("Cancel", role: .cancel) {
                    self.newFileName = ""
                }

                Button("Create") {
                    let path = self.viewModel.currentPath + "/" + self.newFileName
                    self.selectedFile = FileEntry(
                        name: self.newFileName,
                        path: path,
                        isDir: false,
                        size: 0,
                        mode: "0644",
                        modTime: Date())
                    self.showingFileEditor = true
                    self.newFileName = ""
                }
                .disabled(self.newFileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } message: {
                Text("Enter a name for the new file")
            }
            .alert("Delete File", isPresented: self.$showingDeleteAlert, presenting: self.selectedFile) { file in
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) {
                    Task {
                        await self.viewModel.deleteFile(path: file.path)
                    }
                }
            } message: { file in
                Text("Are you sure you want to delete '\(file.name)'? This action cannot be undone.")
            }
            .sheet(isPresented: self.$showingFileEditor) {
                if let file = selectedFile {
                    FileEditorView(
                        path: file.path,
                        isNewFile: !self.viewModel.entries.contains { $0.path == file.path })
                        .onDisappear {
                            // Reload directory to show any new files
                            self.viewModel.loadDirectory(path: self.viewModel.currentPath)
                        }
                }
            }
            .fullScreenCover(isPresented: self.$quickLookManager.isPresenting) {
                QuickLookWrapper(quickLookManager: self.quickLookManager)
                    .ignoresSafeArea()
            }
            .sheet(isPresented: self.$showingFilePreview) {
                if let path = previewPath {
                    FilePreviewView(path: path)
                }
            }
            .overlay {
                if self.quickLookManager.isDownloading {
                    ZStack {
                        Theme.Colors.overlayBackground
                            .ignoresSafeArea()

                        VStack(spacing: 20) {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: Theme.Colors.terminalAccent))
                                .scaleEffect(1.5)

                            Text("Downloading file...")
                                .font(.custom("SF Mono", size: 16))
                                .foregroundColor(Theme.Colors.terminalWhite)

                            if self.quickLookManager.downloadProgress > 0 {
                                ProgressView(value: self.quickLookManager.downloadProgress)
                                    .progressViewStyle(LinearProgressViewStyle(tint: Theme.Colors.terminalAccent))
                                    .frame(width: 200)
                            }
                        }
                        .padding(40)
                        .background(Theme.Colors.terminalDarkGray)
                        .cornerRadius(12)
                    }
                }
            }
        }
        .onAppear {
            self.viewModel.loadDirectory(path: self.initialPath)
        }
    }

    // MARK: - Helper Methods

    private func insertPath(_ path: String, isDirectory: Bool) {
        // Escape the path if it contains spaces
        let escapedPath = path.contains(" ") ? "\"\(path)\"" : path

        // Call the insertion handler
        self.onInsertPath?(escapedPath, isDirectory)

        // Provide haptic feedback
        HapticFeedback.impact(.light)

        // Dismiss the file browser
        self.dismiss()
    }
}

/// Row component for displaying file or directory information.
///
/// Shows file/directory icon, name, size, and modification time
/// with appropriate styling for directories and parent navigation.
/// Row component for displaying a file or directory in the browser.
/// Shows icon, name, and optional Git status with appropriate styling.
struct FileBrowserRow: View {
    let name: String
    let isDirectory: Bool
    let isParent: Bool
    let size: String?
    let modifiedTime: String?
    let gitStatus: GitFileStatus?
    let onTap: () -> Void

    init(
        name: String,
        isDirectory: Bool,
        isParent: Bool = false,
        size: String? = nil,
        modifiedTime: String? = nil,
        gitStatus: GitFileStatus? = nil,
        onTap: @escaping () -> Void)
    {
        self.name = name
        self.isDirectory = isDirectory
        self.isParent = isParent
        self.size = size
        self.modifiedTime = modifiedTime
        self.gitStatus = gitStatus
        self.onTap = onTap
    }

    var iconName: String {
        if self.isDirectory {
            return "folder.fill"
        }

        // Get file extension
        let ext = self.name.split(separator: ".").last?.lowercased() ?? ""

        switch ext {
        case "js", "jsx", "ts", "tsx", "mjs", "cjs":
            return "doc.text.fill"
        case "json", "yaml", "yml", "toml":
            return "doc.text.fill"
        case "md", "markdown", "txt", "log":
            return "doc.plaintext.fill"
        case "html", "htm", "xml":
            return "globe"
        case "css", "scss", "sass", "less":
            return "paintbrush.fill"
        case "png", "jpg", "jpeg", "gif", "svg", "ico", "webp":
            return "photo.fill"
        case "pdf":
            return "doc.richtext.fill"
        case "zip", "tar", "gz", "bz2", "xz", "7z", "rar":
            return "archivebox.fill"
        case "mp4", "mov", "avi", "mkv", "webm":
            return "play.rectangle.fill"
        case "mp3", "wav", "flac", "aac", "ogg":
            return "music.note"
        case "sh", "bash", "zsh", "fish":
            return "terminal.fill"
        case "py", "pyc", "pyo":
            return "doc.text.fill"
        case "swift":
            return "swift"
        case "c", "cpp", "cc", "h", "hpp":
            return "chevron.left.forwardslash.chevron.right"
        case "go":
            return "doc.text.fill"
        case "rs":
            return "doc.text.fill"
        case "java", "class", "jar":
            return "cup.and.saucer.fill"
        default:
            return "doc.fill"
        }
    }

    var iconColor: Color {
        if self.isDirectory {
            return Theme.Colors.terminalAccent
        }

        let ext = self.name.split(separator: ".").last?.lowercased() ?? ""

        switch ext {
        case "js", "jsx", "mjs", "cjs":
            return Theme.Colors.fileTypeJS
        case "ts", "tsx":
            return Theme.Colors.fileTypeTS
        case "json":
            return Theme.Colors.fileTypeJSON
        case "html", "htm":
            return Theme.Colors.fileTypeJSON
        case "css", "scss", "sass", "less":
            return Theme.Colors.fileTypeCSS
        case "md", "markdown":
            return Theme.Colors.terminalGray
        case "png", "jpg", "jpeg", "gif", "svg", "ico", "webp":
            return Theme.Colors.fileTypeImage
        case "swift":
            return Theme.Colors.fileTypeJSON
        case "py":
            return Theme.Colors.fileTypePython
        case "go":
            return Theme.Colors.fileTypeGo
        case "rs":
            return Theme.Colors.fileTypeJSON
        case "sh", "bash", "zsh", "fish":
            return Theme.Colors.fileTypeImage
        default:
            return Theme.Colors.terminalGray.opacity(0.6)
        }
    }

    var body: some View {
        Button(action: self.onTap) {
            HStack(spacing: 12) {
                // Icon
                Image(systemName: self.iconName)
                    .foregroundColor(self.iconColor)
                    .font(.system(size: 16))
                    .frame(width: 24)

                // Name
                Text(self.name)
                    .font(.custom("SF Mono", size: 14))
                    .foregroundColor(
                        self.isParent ? Theme.Colors
                            .terminalAccent :
                            (self.isDirectory ? Theme.Colors.terminalWhite : Theme.Colors.terminalGray))
                    .lineLimit(1)
                    .truncationMode(.middle)

                Spacer()

                // Git status indicator
                if let gitStatus, gitStatus != .unchanged {
                    GitStatusBadge(status: gitStatus)
                        .padding(.trailing, 8)
                }

                // Details
                if !self.isParent {
                    VStack(alignment: .trailing, spacing: 2) {
                        if let size {
                            Text(size)
                                .font(.custom("SF Mono", size: 11))
                                .foregroundColor(Theme.Colors.terminalGray.opacity(0.6))
                        }

                        if let modifiedTime {
                            Text(modifiedTime)
                                .font(.custom("SF Mono", size: 11))
                                .foregroundColor(Theme.Colors.terminalGray.opacity(0.5))
                        }
                    }
                }

                // Chevron for directories
                if self.isDirectory, !self.isParent {
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
                .opacity(self.isDirectory ? 1 : 0))
        .contextMenu {
            if !self.isParent {
                Button {
                    UIPasteboard.general.string = self.name
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                } label: {
                    Label("Copy Name", systemImage: "doc.on.doc")
                }

                Button {
                    UIPasteboard.general.string = self.isDirectory ? "\(self.name)/" : self.name
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                } label: {
                    Label("Copy Path", systemImage: "doc.on.doc.fill")
                }
            }
        }
    }
}

/// Button style with terminal-themed press effects.
///
/// Provides subtle scale and opacity animations on press
/// for a responsive terminal-like interaction feel.
/// Custom button style matching terminal aesthetics.
/// Provides consistent appearance for interactive elements in the file browser.
struct TerminalButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
            .opacity(configuration.isPressed ? 0.8 : 1.0)
            .animation(.easeInOut(duration: 0.1), value: configuration.isPressed)
    }
}

/// View model for file browser navigation and operations.
/// View model for file browser operations.
/// Manages file system navigation, file operations, and Git status tracking.
@MainActor
@Observable
class FileBrowserViewModel {
    var currentPath = "~"
    var entries: [FileEntry] = []
    var isLoading = false
    var showCreateFolder = false
    var newFolderName = ""
    var showError = false
    var errorMessage: String?
    var gitStatus: GitStatus?
    var showHidden = false
    var gitFilter: GitFilterOption = .all

    enum GitFilterOption: String {
        case all
        case changed
    }

    private let apiClient = APIClient.shared

    var sortedEntries: [FileEntry] {
        self.entries.sorted { entry1, entry2 in
            // Directories come first
            if entry1.isDir != entry2.isDir {
                return entry1.isDir
            }
            // Then sort by name
            return entry1.name.localizedCaseInsensitiveCompare(entry2.name) == .orderedAscending
        }
    }

    var canGoUp: Bool {
        self.currentPath != "/" && self.currentPath != "~"
    }

    var displayPath: String {
        // Show a more user-friendly path
        if self.currentPath == "/" {
            return "/"
        } else if self.currentPath.hasPrefix("/Users/") {
            // Extract username from path like /Users/username/...
            let components = self.currentPath.components(separatedBy: "/")
            if components.count > 2 {
                let username = components[2]
                let homePath = "/Users/\(username)"
                if self.currentPath == homePath || self.currentPath.hasPrefix(homePath + "/") {
                    return self.currentPath.replacingOccurrences(of: homePath, with: "~")
                }
            }
        }
        return self.currentPath
    }

    func loadDirectory(path: String) {
        Task {
            await self.loadDirectoryAsync(path: path)
        }
    }

    @MainActor
    private func loadDirectoryAsync(path: String) async {
        self.isLoading = true
        defer { isLoading = false }

        do {
            let result = try await apiClient.browseDirectory(
                path: path,
                showHidden: self.showHidden,
                gitFilter: self.gitFilter.rawValue)
            // Use the absolute path returned by the server
            self.currentPath = result.absolutePath
            self.gitStatus = result.gitStatus
            withAnimation(.easeInOut(duration: 0.2)) {
                self.entries = result.files
            }
        } catch {
            // Failed to load directory: \(error)
            self.errorMessage = "Failed to load directory: \(error.localizedDescription)"
            self.showError = true
        }
    }

    func navigate(to path: String) {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        self.loadDirectory(path: path)
    }

    func navigateToParent() {
        let parentPath = URL(fileURLWithPath: currentPath).deletingLastPathComponent().path
        self.navigate(to: parentPath)
    }

    func createFolder() {
        let folderName = self.newFolderName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !folderName.isEmpty else { return }

        Task {
            await self.createFolderAsync(name: folderName)
        }
    }

    @MainActor
    private func createFolderAsync(name: String) async {
        do {
            let fullPath = self.currentPath + "/" + name
            try await self.apiClient.createDirectory(path: fullPath)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            self.newFolderName = ""
            // Reload directory to show new folder
            await self.loadDirectoryAsync(path: self.currentPath)
        } catch {
            // Failed to create folder: \(error)
            self.errorMessage = "Failed to create folder: \(error.localizedDescription)"
            self.showError = true
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }

    func deleteFile(path: String) async {
        // File deletion is not yet implemented in the backend
        self.errorMessage = "File deletion is not available in the current server version"
        self.showError = true
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }

    func previewFile(_ file: FileEntry) async {
        do {
            try await QuickLookManager.shared.previewFile(file, apiClient: self.apiClient)
        } catch {
            await MainActor.run {
                self.errorMessage = "Failed to preview file: \(error.localizedDescription)"
                self.showError = true
            }
        }
    }
}

/// Git status badge component for displaying file status
/// Badge component displaying Git file status.
/// Shows visual indicators for modified, new, deleted, or renamed files.
struct GitStatusBadge: View {
    let status: GitFileStatus

    var label: String {
        switch self.status {
        case .modified: "M"
        case .added: "A"
        case .deleted: "D"
        case .untracked: "?"
        case .unchanged: ""
        }
    }

    var color: Color {
        switch self.status {
        case .modified: .yellow
        case .added: .green
        case .deleted: .red
        case .untracked: .gray
        case .unchanged: .clear
        }
    }

    var body: some View {
        if self.status != .unchanged {
            Text(self.label)
                .font(.custom("SF Mono", size: 10))
                .fontWeight(.bold)
                .foregroundColor(self.color)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(self.color.opacity(0.2))
                .cornerRadius(4)
        }
    }
}

#Preview {
    FileBrowserView { _ in
        // Selected path
    }
}
