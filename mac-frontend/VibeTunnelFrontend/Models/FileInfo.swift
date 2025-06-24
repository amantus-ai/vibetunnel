import Foundation

enum FileType: String, Codable {
    case file
    case directory
}

enum GitStatus: String, Codable {
    case modified
    case added
    case deleted
    case untracked
    case unchanged
}

struct FileInfo: Codable, Identifiable {
    let id = UUID()
    let name: String
    let path: String
    let type: FileType
    let size: Int64
    let modified: Date
    let permissions: String?
    let isGitTracked: Bool?
    let gitStatus: GitStatus?
    
    enum CodingKeys: String, CodingKey {
        case name, path, type, size, modified, permissions, isGitTracked, gitStatus
    }
}

struct DirectoryListing: Codable {
    let path: String
    let fullPath: String
    let gitStatus: GitStatusInfo?
    let files: [FileInfo]
}

struct GitStatusInfo: Codable {
    let isGitRepo: Bool
    let branch: String?
    let modified: [String]
    let added: [String]
    let deleted: [String]
    let untracked: [String]
}

struct FilePreview: Codable {
    let type: FilePreviewType
    let content: String?
    let language: String?
    let url: String?
    let mimeType: String?
    let size: Int64
    let humanSize: String?
}

enum FilePreviewType: String, Codable {
    case image
    case text
    case binary
}

struct FileDiff: Codable {
    let path: String
    let diff: String
    let hasDiff: Bool
}

struct FileDiffContent: Codable {
    let path: String
    let originalContent: String
    let modifiedContent: String
    let language: String?
}