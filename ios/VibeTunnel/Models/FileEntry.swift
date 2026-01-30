import Foundation

/// Git status for a file.
/// Represents the various states a file can have in a Git repository.
enum GitFileStatus: String, Codable {
    case modified
    case added
    case deleted
    case untracked
    case unchanged
}

/// Represents a file or directory entry in the file system.
///
/// FileEntry contains metadata about a file or directory, including
/// its name, path, size, permissions, and modification time.
/// This model is typically used for file browser functionality.
struct FileEntry: Codable, Identifiable {
    let name: String
    let path: String
    let isDir: Bool
    let size: Int64
    let mode: String
    let modTime: Date
    let isGitTracked: Bool?
    let gitStatus: GitFileStatus?

    var id: String { self.path }

    /// Creates a new FileEntry with the given parameters.
    init(
        name: String,
        path: String,
        isDir: Bool,
        size: Int64,
        mode: String,
        modTime: Date,
        isGitTracked: Bool? = nil,
        gitStatus: GitFileStatus? = nil)
    {
        self.name = name
        self.path = path
        self.isDir = isDir
        self.size = size
        self.mode = mode
        self.modTime = modTime
        self.isGitTracked = isGitTracked
        self.gitStatus = gitStatus
    }

    // Server sends: type, permissions, modified
    // We store as: isDir, mode, modTime
    enum CodingKeys: String, CodingKey {
        case name
        case path
        case type // Server sends "file" or "directory"
        case size
        case permissions // Server sends "permissions", we store as "mode"
        case modified // Server sends "modified", we store as "modTime"
        case isGitTracked
        case gitStatus
    }

    /// Custom decoder to handle server's field names and types.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.name = try container.decode(String.self, forKey: .name)
        self.path = try container.decode(String.self, forKey: .path)

        // Convert type string to isDir bool
        let typeString = try container.decode(String.self, forKey: .type)
        self.isDir = typeString == "directory"

        self.size = try container.decode(Int64.self, forKey: .size)

        // permissions → mode (optional, default to "000")
        self.mode = try container.decodeIfPresent(String.self, forKey: .permissions) ?? "000"

        self.isGitTracked = try container.decodeIfPresent(Bool.self, forKey: .isGitTracked)
        self.gitStatus = try container.decodeIfPresent(GitFileStatus.self, forKey: .gitStatus)

        // Decode modified string as Date
        let modTimeString = try container.decode(String.self, forKey: .modified)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: modTimeString) {
            self.modTime = date
        } else {
            // Fallback without fractional seconds
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: modTimeString) {
                self.modTime = date
            } else {
                throw DecodingError.dataCorruptedError(
                    forKey: .modified,
                    in: container,
                    debugDescription: "Invalid date format: \(modTimeString)")
            }
        }
    }

    /// Custom encoder to convert back to server format.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.name, forKey: .name)
        try container.encode(self.path, forKey: .path)
        try container.encode(self.isDir ? "directory" : "file", forKey: .type)
        try container.encode(self.size, forKey: .size)
        try container.encode(self.mode, forKey: .permissions)

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        try container.encode(formatter.string(from: self.modTime), forKey: .modified)

        try container.encodeIfPresent(self.isGitTracked, forKey: .isGitTracked)
        try container.encodeIfPresent(self.gitStatus, forKey: .gitStatus)
    }

    /// Returns a human-readable file size string.
    ///
    /// Uses binary units (KiB, MiB, GiB) for formatting.
    /// Example: "1.5 MiB" for a file of 1,572,864 bytes.
    var formattedSize: String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .binary
        return formatter.string(fromByteCount: self.size)
    }

    /// Returns a relative date string for the modification time.
    ///
    /// Formats the modification time relative to the current date.
    /// Examples: "2 hours ago", "yesterday", "3 days ago".
    var formattedDate: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: self.modTime, relativeTo: Date())
    }
}

/// Git status information for a directory.
/// Contains repository state including branch and file change lists.
struct GitStatus: Codable {
    let isGitRepo: Bool
    let branch: String?
    let modified: [String]
    let added: [String]
    let deleted: [String]
    let untracked: [String]
}

/// Represents a directory listing with its contents.
///
/// DirectoryListing contains the absolute path of a directory
/// and an array of FileEntry objects representing its contents.
struct DirectoryListing: Codable {
    /// The absolute path of the directory being listed.
    let absolutePath: String

    /// Array of file and subdirectory entries in this directory.
    let files: [FileEntry]

    /// Git status information for the directory
    let gitStatus: GitStatus?

    enum CodingKeys: String, CodingKey {
        case absolutePath = "fullPath"
        case files
        case gitStatus
    }
}
