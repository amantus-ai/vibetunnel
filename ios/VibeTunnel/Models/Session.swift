import Foundation

struct Session: Codable, Identifiable {
    let id: String
    let command: String
    let workingDir: String
    let name: String?
    let status: SessionStatus
    let exitCode: Int?
    let startedAt: String
    let lastModified: String
    let pid: Int?
    let waiting: Bool?
    let width: Int?
    let height: Int?
    
    var displayName: String {
        name ?? command
    }
    
    var isRunning: Bool {
        status == .running
    }
    
    var formattedStartTime: String {
        // Parse and format the startedAt string
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: startedAt) {
            let displayFormatter = DateFormatter()
            displayFormatter.dateStyle = .none
            displayFormatter.timeStyle = .short
            return displayFormatter.string(from: date)
        }
        return startedAt
    }
}

enum SessionStatus: String, Codable {
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
    
    init(command: String = "zsh", workingDir: String, name: String? = nil, cols: Int = 80, rows: Int = 24) {
        self.command = [command]
        self.workingDir = workingDir
        self.name = name
        self.spawn_terminal = false
        self.cols = cols
        self.rows = rows
    }
}