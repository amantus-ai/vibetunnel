import Foundation
import SwiftUI
import Combine

@MainActor
final class FileBrowserViewModel: ObservableObject {
    @Published var files: [FileInfo] = []
    @Published var currentPath = ""
    @Published var currentFullPath = ""
    @Published var gitStatus: GitStatusInfo?
    @Published var gitFilter = "all"
    @Published var showHidden = false
    @Published var isLoading = false
    @Published var isLoadingPreview = false
    @Published var currentPreview: FilePreview?
    @Published var currentDiff: FileDiff?
    @Published var errorMessage: String?
    
    private let fileSystemService = FileSystemService.shared
    
    func loadDirectory(_ path: String) async {
        isLoading = true
        errorMessage = nil
        
        do {
            let listing = try await fileSystemService.browseDirectory(
                path: path,
                showHidden: showHidden,
                gitFilter: gitFilter
            )
            
            await MainActor.run {
                self.currentPath = listing.path
                self.currentFullPath = listing.fullPath
                self.gitStatus = listing.gitStatus
                self.files = listing.files
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                self.errorMessage = error.localizedDescription
                self.isLoading = false
            }
        }
    }
    
    func loadPreview(for file: FileInfo) async {
        guard file.type == .file else { return }
        
        isLoadingPreview = true
        currentDiff = nil
        
        do {
            let preview = try await fileSystemService.previewFile(path: file.path)
            
            await MainActor.run {
                self.currentPreview = preview
                self.isLoadingPreview = false
            }
        } catch {
            await MainActor.run {
                self.errorMessage = "Failed to load preview: \(error.localizedDescription)"
                self.isLoadingPreview = false
            }
        }
    }
    
    func loadDiff(for file: FileInfo) async {
        guard file.type == .file,
              let gitStatus = file.gitStatus,
              gitStatus != .unchanged else { return }
        
        isLoadingPreview = true
        currentPreview = nil
        
        do {
            let diff = try await fileSystemService.getDiff(path: file.path)
            
            await MainActor.run {
                self.currentDiff = diff
                self.isLoadingPreview = false
            }
        } catch {
            await MainActor.run {
                self.errorMessage = "Failed to load diff: \(error.localizedDescription)"
                self.isLoadingPreview = false
            }
        }
    }
    
    func navigateToParent() {
        guard currentFullPath != "/" else { return }
        
        let components = currentFullPath.split(separator: "/").dropLast()
        let parentPath = components.isEmpty ? "/" : "/" + components.joined(separator: "/")
        
        Task {
            await loadDirectory(parentPath)
        }
    }
    
    func toggleGitFilter() {
        gitFilter = gitFilter == "all" ? "changed" : "all"
        Task {
            await loadDirectory(currentPath)
        }
    }
    
    func toggleHidden() {
        showHidden.toggle()
        Task {
            await loadDirectory(currentPath)
        }
    }
    
    func clearError() {
        errorMessage = nil
    }
}

// Helper for file icons
struct FileIconHelper {
    static func getIcon(for filename: String, type: FileType) -> String {
        if type == .directory {
            return "folder.fill"
        }
        
        let ext = (filename as NSString).pathExtension.lowercased()
        
        switch ext {
        case "txt", "md", "markdown":
            return "doc.text"
        case "pdf":
            return "doc.fill"
        case "jpg", "jpeg", "png", "gif", "svg", "webp":
            return "photo"
        case "mp4", "mov", "avi":
            return "video"
        case "mp3", "wav", "m4a":
            return "music.note"
        case "zip", "tar", "gz", "bz2", "xz":
            return "doc.zipper"
        case "js", "ts", "jsx", "tsx":
            return "curlybraces"
        case "swift":
            return "swift"
        case "py":
            return "chevron.left.forwardslash.chevron.right"
        case "json", "xml", "yaml", "yml":
            return "doc.badge.gearshape"
        case "html", "htm":
            return "globe"
        case "css", "scss", "sass", "less":
            return "paintbrush"
        case "sh", "bash", "zsh", "fish":
            return "terminal"
        case "java", "kt", "scala":
            return "cup.and.saucer"
        case "c", "cpp", "cc", "cxx", "h", "hpp":
            return "chevron.left.forwardslash.chevron.right"
        case "rs":
            return "shippingbox"
        case "go":
            return "arrow.right.circle"
        case "rb":
            return "gem"
        case "php":
            return "globe"
        case "sql":
            return "cylinder"
        case "dockerfile":
            return "shippingbox"
        default:
            return "doc"
        }
    }
}