import Foundation

struct Session: Identifiable, Codable, Hashable {
    typealias ID = String
    
    let id: String
    let name: String?
    let command: String
    let cwd: String
    let createdAt: Date
    var status: SessionStatus
    var exitCode: Int?
    var pid: Int?
    
    var displayName: String {
        if let name = name, !name.isEmpty {
            return name
        }
        
        // Generate human-readable name from timestamp
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, h:mm a"
        return formatter.string(from: createdAt)
    }
    
    var isRunning: Bool {
        status == .running
    }
    
    enum SessionStatus: String, Codable {
        case running
        case exited
    }
}

// API response models
struct SessionsResponse: Codable {
    let sessions: [Session]
}

struct CreateSessionRequest: Codable {
    let command: String
    let cwd: String
    let name: String?
    
    init(command: String, cwd: String, name: String? = nil) {
        self.command = command
        self.cwd = cwd
        self.name = name?.isEmpty == true ? nil : name
    }
}

struct CreateSessionResponse: Codable {
    let sessionId: String
    let spawnedInNativeTerminal: Bool?
}
