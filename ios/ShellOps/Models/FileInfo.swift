import Foundation

/// Detailed file metadata including MIME type and permissions.
/// Extended version of FileEntry with additional properties for file operations.
struct FileInfo: Codable {
    let name: String
    let path: String
    let isDir: Bool
    let size: Int64
    let mode: String
    let modTime: Date
    let mimeType: String
    let readable: Bool
    let executable: Bool

    enum CodingKeys: String, CodingKey {
        case name
        case path
        case isDir = "is_dir"
        case size
        case mode
        case modTime = "mod_time"
        case mimeType = "mime_type"
        case readable
        case executable
    }
}
