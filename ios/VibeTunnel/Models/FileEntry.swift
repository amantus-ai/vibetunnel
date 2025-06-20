import Foundation

struct FileEntry: Codable, Identifiable {
    let name: String
    let path: String
    let isDir: Bool
    let size: Int64
    let mode: String
    let modTime: Date
    
    var id: String { path }
    
    enum CodingKeys: String, CodingKey {
        case name
        case path
        case isDir = "is_dir"
        case size
        case mode
        case modTime = "mod_time"
    }
    
    var formattedSize: String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .binary
        return formatter.string(fromByteCount: size)
    }
    
    var formattedDate: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: modTime, relativeTo: Date())
    }
}

struct DirectoryListing: Codable {
    let absolutePath: String
    let files: [FileEntry]
}