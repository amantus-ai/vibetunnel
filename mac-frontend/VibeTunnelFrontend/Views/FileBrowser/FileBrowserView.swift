import SwiftUI

// MARK: - FileBrowserView Components

struct FileBrowserHeader: View {
    @Binding var isEditingPath: Bool
    @Binding var pathInput: String
    let currentFullPath: String
    let onDismiss: () -> Void
    let onNavigateToPath: () -> Void
    let onNavigateToBreadcrumb: (String) -> Void
    
    var body: some View {
        HStack(spacing: 12) {
            Button(action: onDismiss) {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 14, weight: .medium))
                    Text("Back")
                        .font(.system(size: 12, weight: .medium))
                }
                .foregroundColor(Theme.Colors.tertiaryText)
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.escape)
            
            Divider()
                .frame(height: 20)
            
            // Path display/editor
            if isEditingPath {
                TextField("Enter path", text: $pathInput, onCommit: onNavigateToPath)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundColor(Theme.Colors.accentBlue)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Theme.Colors.secondaryBackground)
                    .cornerRadius(4)
                    .onAppear {
                        pathInput = currentFullPath
                    }
                    .onExitCommand {
                        isEditingPath = false
                        pathInput = ""
                    }
            } else {
                ClickablePathView(
                    currentPath: currentFullPath.isEmpty ? "/" : currentFullPath,
                    onNavigate: onNavigateToBreadcrumb
                )
            }
            
            // Edit path button
            Button(action: { isEditingPath = true }) {
                Image(systemName: "pencil.circle")
                    .font(.system(size: 14))
                    .foregroundColor(Theme.Colors.tertiaryText)
            }
            .buttonStyle(.plain)
            .help("Edit path directly")
            .opacity(isEditingPath ? 0 : 1)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Theme.Colors.secondaryBackground)
    }
}

// MARK: - Main FileBrowserView

struct FileBrowserView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = FileBrowserViewModel()
    @State private var selectedFile: FileInfo?
    @State private var showDiff = false
    @State private var isEditingPath = false
    @State private var pathInput = ""
    @State private var errorMessage = ""
    @State private var showError = false
    
    let mode: FileBrowserMode
    let session: Session?
    let onSelectPath: ((String, FileType) -> Void)?
    
    enum FileBrowserMode {
        case browse
        case select
    }
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            FileBrowserHeader(
                isEditingPath: $isEditingPath,
                pathInput: $pathInput,
                currentFullPath: viewModel.currentFullPath,
                onDismiss: { dismiss() },
                onNavigateToPath: navigateToPath,
                onNavigateToBreadcrumb: { path in
                    Task {
                        await viewModel.loadDirectory(path)
                    }
                }
            )
            
            Divider()
            
            // Main content
            HStack(spacing: 0) {
                // File list
                FileBrowserSidebar(
                    viewModel: viewModel,
                    selectedFile: $selectedFile,
                    showDiff: $showDiff
                )
                
                Divider()
                
                // Preview pane
                FileBrowserPreviewPane(
                    viewModel: viewModel,
                    selectedFile: selectedFile,
                    showDiff: $showDiff,
                    mode: mode,
                    onSelectPath: onSelectPath,
                    onDismiss: { dismiss() }
                )
            }
            
            // Bottom bar for select mode
            if mode == .select {
                Divider()
                
                HStack(spacing: 16) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .buttonStyle(GhostButtonStyle())
                    
                    Spacer()
                    
                    Button("Select Directory") {
                        // TODO: Implement directory selection
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }
                .padding(16)
                .background(Theme.Colors.secondaryBackground)
            }
        }
        .frame(width: 900, height: 600)
        .background(Theme.Colors.background)
        .alert("Error", isPresented: $showError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(errorMessage)
        }
        .onAppear {
            Task {
                await viewModel.loadDirectory(session?.cwd ?? "~/")
            }
        }
        .onChange(of: viewModel.errorMessage) { _, newValue in
            if let error = newValue {
                errorMessage = error
                showError = true
                viewModel.clearError()
            }
        }
        .onKeyPress { press in
            if press.key == KeyEquivalent("c") && press.modifiers.contains(.command) {
                if let selected = selectedFile {
                    let absolutePath = viewModel.currentFullPath.hasSuffix("/") ?
                        viewModel.currentFullPath + selected.name :
                        viewModel.currentFullPath + "/" + selected.name
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(absolutePath, forType: .string)
                    return .handled
                }
            }
            return .ignored
        }
    }
    
    private func navigateToPath() {
        isEditingPath = false
        let path = pathInput.trimmingCharacters(in: .whitespacesAndNewlines)
        if !path.isEmpty {
            Task {
                await viewModel.loadDirectory(path)
            }
        }
        pathInput = ""
    }
}

struct APIFileRowView: View {
    let name: String
    let type: FileType
    let gitStatus: GitStatus?
    let isSelected: Bool
    let onTap: () -> Void
    
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: FileIconHelper.getIcon(for: name, type: type))
                .font(.system(size: 14))
                .foregroundColor(type == .directory ? Theme.Colors.accentBlue : Theme.Colors.tertiaryText)
                .frame(width: 20)
            
            Text(name)
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(type == .directory ? Theme.Colors.accentBlue : Theme.Colors.primaryText)
                .lineLimit(1)
                .truncationMode(.middle)
            
            Spacer()
            
            if let status = gitStatus {
                APIGitStatusBadge(status: status)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(isSelected ? Theme.Colors.tertiaryBackground : Color.clear)
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
    }
}

struct APIGitStatusBadge: View {
    let status: GitStatus
    
    var statusColor: Color {
        switch status {
        case .modified:
            return .orange
        case .added:
            return .green
        case .deleted:
            return .red
        case .untracked:
            return .gray
        case .unchanged:
            return .clear
        }
    }
    
    var statusText: String {
        switch status {
        case .modified:
            return "M"
        case .added:
            return "A"
        case .deleted:
            return "D"
        case .untracked:
            return "?"
        case .unchanged:
            return ""
        }
    }
    
    var body: some View {
        if status != .unchanged {
            Text(statusText)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(.white)
                .padding(.horizontal, 4)
                .padding(.vertical, 2)
                .background(statusColor)
                .cornerRadius(3)
        }
    }
}

struct APIFilePreviewView: View {
    let preview: FilePreview
    let fileName: String
    
    var body: some View {
        switch preview.type {
        case .image:
            if let urlString = preview.url,
               let url = URL(string: urlString) {
                AsyncImage(url: url) { image in
                    image
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding()
                } placeholder: {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            
        case .text:
            ScrollView {
                Text(preview.content ?? "")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(Theme.Colors.primaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
            .background(Theme.Colors.secondaryBackground)
            
        case .binary:
            VStack(spacing: 16) {
                Image(systemName: "doc.fill")
                    .font(.system(size: 48))
                    .foregroundColor(Theme.Colors.tertiaryText.opacity(0.3))
                
                Text("Binary File")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(Theme.Colors.primaryText)
                
                Text(preview.humanSize ?? "\(preview.size) bytes")
                    .font(.system(size: 14))
                    .foregroundColor(Theme.Colors.tertiaryText)
                
                if let mimeType = preview.mimeType {
                    Text(mimeType)
                        .font(.system(size: 12))
                        .foregroundColor(Theme.Colors.tertiaryText)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct APIGitDiffView: View {
    let diff: FileDiff
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(diff.diff.components(separatedBy: "\n"), id: \.self) { line in
                    HStack(spacing: 0) {
                        Text(line)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(lineColor(for: line))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(lineBackground(for: line))
                }
            }
        }
        .background(Theme.Colors.secondaryBackground)
    }
    
    private func lineColor(for line: String) -> Color {
        if line.hasPrefix("+") {
            return Theme.Colors.success
        } else if line.hasPrefix("-") {
            return Theme.Colors.error
        } else if line.hasPrefix("@@") {
            return Theme.Colors.accentBlue
        } else {
            return Theme.Colors.tertiaryText
        }
    }
    
    private func lineBackground(for line: String) -> Color {
        if line.hasPrefix("+") {
            return Theme.Colors.success.opacity(0.1)
        } else if line.hasPrefix("-") {
            return Theme.Colors.error.opacity(0.1)
        } else {
            return Color.clear
        }
    }
}

// MARK: - FileBrowserSidebar

struct FileBrowserSidebar: View {
    @ObservedObject var viewModel: FileBrowserViewModel
    @Binding var selectedFile: FileInfo?
    @Binding var showDiff: Bool
    
    var body: some View {
        VStack(spacing: 0) {
            // Filter controls
            HStack(spacing: 8) {
                Button(action: { viewModel.toggleGitFilter() }) {
                    Text("Git Changes")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(viewModel.gitFilter == "changed" ? Theme.Colors.background : Theme.Colors.primaryText)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4)
                        .background(viewModel.gitFilter == "changed" ? Theme.Colors.accent : Theme.Colors.tertiaryBackground)
                        .cornerRadius(4)
                }
                .buttonStyle(.plain)
                
                Button(action: { viewModel.toggleHidden() }) {
                    Text("Hidden Files")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(viewModel.showHidden ? Theme.Colors.background : Theme.Colors.primaryText)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4)
                        .background(viewModel.showHidden ? Theme.Colors.accent : Theme.Colors.tertiaryBackground)
                        .cornerRadius(4)
                }
                .buttonStyle(.plain)
                
                Spacer()
                
                if let branch = viewModel.gitStatus?.branch {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.branch")
                            .font(.system(size: 10))
                        Text(branch)
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                    }
                    .foregroundColor(Theme.Colors.tertiaryText)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Theme.Colors.secondaryBackground)
            
            Divider()
            
            // File list
            ScrollView {
                VStack(spacing: 0) {
                    if viewModel.currentFullPath != "/" {
                        APIFileRowView(
                            name: "..",
                            type: .directory,
                            gitStatus: nil,
                            isSelected: false,
                            onTap: { viewModel.navigateToParent() }
                        )
                    }
                    
                    ForEach(viewModel.files) { file in
                        APIFileRowView(
                            name: file.name,
                            type: file.type,
                            gitStatus: file.gitStatus,
                            isSelected: selectedFile?.id == file.id,
                            onTap: {
                                if file.type == .directory {
                                    Task {
                                        await viewModel.loadDirectory(file.path)
                                    }
                                } else {
                                    selectedFile = file
                                    showDiff = viewModel.gitFilter == "changed" && file.gitStatus != nil && file.gitStatus != .unchanged
                                    Task {
                                        if showDiff {
                                            await viewModel.loadDiff(for: file)
                                        } else {
                                            await viewModel.loadPreview(for: file)
                                        }
                                    }
                                }
                            }
                        )
                        .contextMenu {
                            Button("Copy Path") {
                                let absolutePath = viewModel.currentFullPath.hasSuffix("/") ?
                                    viewModel.currentFullPath + file.name :
                                    viewModel.currentFullPath + "/" + file.name
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(absolutePath, forType: .string)
                            }
                            .keyboardShortcut("c", modifiers: .command)
                        }
                    }
                }
            }
            .frame(width: 320)
            .background(Theme.Colors.secondaryBackground)
        }
    }
}

// MARK: - FileBrowserPreviewPane

struct FileBrowserPreviewPane: View {
    @ObservedObject var viewModel: FileBrowserViewModel
    let selectedFile: FileInfo?
    @Binding var showDiff: Bool
    let mode: FileBrowserView.FileBrowserMode
    let onSelectPath: ((String, FileType) -> Void)?
    let onDismiss: () -> Void
    
    var body: some View {
        VStack(spacing: 0) {
            if let file = selectedFile {
                // Preview header
                FileBrowserPreviewHeader(
                    file: file,
                    viewModel: viewModel,
                    showDiff: $showDiff,
                    mode: mode,
                    onSelectPath: onSelectPath,
                    onDismiss: onDismiss
                )
                
                Divider()
            }
            
            // Preview content
            if viewModel.isLoadingPreview {
                Spacer()
                ProgressView()
                    .scaleEffect(0.8)
                Text("Loading preview...")
                    .font(.system(size: 12))
                    .foregroundColor(Theme.Colors.tertiaryText)
                Spacer()
            } else if showDiff, let diff = viewModel.currentDiff {
                APIGitDiffView(diff: diff)
            } else if let preview = viewModel.currentPreview {
                APIFilePreviewView(preview: preview, fileName: selectedFile?.name ?? "")
            } else {
                Spacer()
                Image(systemName: "doc.text.magnifyingglass")
                    .font(.system(size: 48))
                    .foregroundColor(Theme.Colors.tertiaryText.opacity(0.3))
                Text("Select a file to preview")
                    .font(.system(size: 14))
                    .foregroundColor(Theme.Colors.tertiaryText)
                    .padding(.top, 8)
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.Colors.background)
    }
}

// MARK: - FileBrowserPreviewHeader

struct FileBrowserPreviewHeader: View {
    let file: FileInfo
    let viewModel: FileBrowserViewModel
    @Binding var showDiff: Bool
    let mode: FileBrowserView.FileBrowserMode
    let onSelectPath: ((String, FileType) -> Void)?
    let onDismiss: () -> Void
    
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: FileIconHelper.getIcon(for: file.name, type: file.type))
                .font(.system(size: 14))
                .foregroundColor(Theme.Colors.tertiaryText)
            
            Text(file.name)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .lineLimit(1)
            
            if let gitStatus = file.gitStatus {
                APIGitStatusBadge(status: gitStatus)
            }
            
            Spacer()
            
            if file.type == .file {
                HStack(spacing: 8) {
                    CopyButton(
                        text: file.path,
                        label: "Copy Path",
                        fontSize: 11
                    )
                    .buttonStyle(SecondaryButtonStyle(fontSize: 11, padding: EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12)))
                    
                    if mode == .browse, let onSelectPath = onSelectPath {
                        Button(action: {
                            let absolutePath = viewModel.currentFullPath.hasSuffix("/") ?
                                viewModel.currentFullPath + file.name :
                                viewModel.currentFullPath + "/" + file.name
                            onSelectPath(absolutePath, file.type)
                            onDismiss()
                        }) {
                            Text("Insert Path")
                                .font(.system(size: 11, weight: .medium))
                        }
                        .buttonStyle(PrimaryButtonStyle(fontSize: 11, padding: EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12)))
                    }
                    
                    if file.gitStatus != nil && file.gitStatus != .unchanged {
                        if showDiff {
                            Button(action: {
                                showDiff = false
                                Task {
                                    await viewModel.loadPreview(for: file)
                                }
                            }) {
                                Text("View File")
                                    .font(.system(size: 11, weight: .medium))
                            }
                            .buttonStyle(PrimaryButtonStyle(fontSize: 11, padding: EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12)))
                        } else {
                            Button(action: {
                                showDiff = true
                                Task {
                                    await viewModel.loadDiff(for: file)
                                }
                            }) {
                                Text("View Diff")
                                    .font(.system(size: 11, weight: .medium))
                            }
                            .buttonStyle(SecondaryButtonStyle(fontSize: 11, padding: EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12)))
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Theme.Colors.secondaryBackground)
    }
}

#Preview {
    FileBrowserView(
        mode: .browse,
        session: nil,
        onSelectPath: { path, type in
            print("Selected: \(path) (\(type))")
        }
    )
    .frame(width: 900, height: 600)
}