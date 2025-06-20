import Foundation

struct Session: Codable, Identifiable, Equatable {
    let id: String
    let command: String
    let workingDir: String
    let name: String?
    let status: SessionStatus
    let exitCode: Int?
    let startedAt: String
    let lastModified: String?
    let pid: Int?
    let waiting: Bool?
    let width: Int?
    let height: Int?
    
    enum CodingKeys: String, CodingKey {
        case id
        case command = "cmdline"
        case workingDir = "cwd"
        case name
        case status
        case exitCode = "exit_code"
        case startedAt = "started_at"
        case lastModified = "last_modified"
        case pid
        case waiting
        case width
        case height
    }
    
    var displayName: String {
        name ?? command
    }
    
    var isRunning: Bool {
        status == .running
    }
    
    var formattedStartTime: String {
        // Parse and format the startedAt string
        // Try ISO8601 first
        let iso8601Formatter = ISO8601DateFormatter()
        if let date = iso8601Formatter.date(from: startedAt) {
            let displayFormatter = DateFormatter()
            displayFormatter.dateStyle = .none
            displayFormatter.timeStyle = .short
            return displayFormatter.string(from: date)
        }
        
        // Try RFC3339 format (what Go uses)
        let rfc3339Formatter = DateFormatter()
        rfc3339Formatter.locale = Locale(identifier: "en_US_POSIX")
        rfc3339Formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXXXX"
        if let date = rfc3339Formatter.date(from: startedAt) {
            let displayFormatter = DateFormatter()
            displayFormatter.dateStyle = .none
            displayFormatter.timeStyle = .short
            return displayFormatter.string(from: date)
        }
        
        // Try without fractional seconds
        rfc3339Formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ssXXXXX"
        if let date = rfc3339Formatter.date(from: startedAt) {
            let displayFormatter = DateFormatter()
            displayFormatter.dateStyle = .none
            displayFormatter.timeStyle = .short
            return displayFormatter.string(from: date)
        }
        
        return startedAt
    }
}

enum SessionStatus: String, Codable {
    case starting
    case running
    case exited
}

struct SessionCreateData: Codable {
    let command: [String]
    let workingDir: String
    let name: String?
    let spawn_terminal: Bool?
    let cols: Int?
    let rows: Int?
    
    init(command: String = "zsh", workingDir: String, name: String? = nil, spawnTerminal: Bool = false, cols: Int = 120, rows: Int = 30) {
        self.command = [command]
        self.workingDir = workingDir
        self.name = name
        self.spawn_terminal = spawnTerminal
        self.cols = cols
        self.rows = rows
    }
}