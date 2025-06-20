import Foundation

enum TerminalEvent {
    case header(AsciinemaHeader)
    case output(timestamp: Double, data: String)
    case resize(timestamp: Double, dimensions: String)
    case exit(code: Int, sessionId: String)
    
    init?(from line: String) {
        guard let data = line.data(using: .utf8) else { return nil }
        
        // Try to parse as header first
        if let header = try? JSONDecoder().decode(AsciinemaHeader.self, from: data) {
            self = .header(header)
            return
        }
        
        // Try to parse as array event
        guard let array = try? JSONSerialization.jsonObject(with: data) as? [Any] else {
            return nil
        }
        
        // Check for exit event: ["exit", exitCode, sessionId]
        if array.count == 3,
           let exitString = array[0] as? String,
           exitString == "exit",
           let exitCode = array[1] as? Int,
           let sessionId = array[2] as? String {
            self = .exit(code: exitCode, sessionId: sessionId)
            return
        }
        
        // Parse normal events: [timestamp, "type", "data"]
        guard array.count >= 3,
              let timestamp = array[0] as? Double,
              let typeString = array[1] as? String,
              let eventData = array[2] as? String else {
            return nil
        }
        
        switch typeString {
        case "o":
            self = .output(timestamp: timestamp, data: eventData)
        case "r":
            self = .resize(timestamp: timestamp, dimensions: eventData)
        default:
            return nil
        }
    }
}

struct AsciinemaHeader: Codable {
    let version: Int
    let width: Int
    let height: Int
    let timestamp: Double?
    let env: [String: String]?
}

struct TerminalInput: Codable {
    let text: String
    
    enum SpecialKey: String {
        // Arrow keys use ANSI escape sequences
        case arrowUp = "\u{001B}[A"
        case arrowDown = "\u{001B}[B"
        case arrowRight = "\u{001B}[C"
        case arrowLeft = "\u{001B}[D"
        
        // Special keys
        case escape = "\u{001B}"
        case enter = "\r"
        case tab = "\t"
        
        // Control keys
        case ctrlC = "\u{0003}"
        case ctrlD = "\u{0004}"
        case ctrlZ = "\u{001A}"
        case ctrlL = "\u{000C}"
        case ctrlA = "\u{0001}"
        case ctrlE = "\u{0005}"
        
        // For compatibility with web frontend
        case ctrlEnter = "ctrl_enter"
        case shiftEnter = "shift_enter"
    }
    
    init(specialKey: SpecialKey) {
        self.text = specialKey.rawValue
    }
    
    init(text: String) {
        self.text = text
    }
}

struct TerminalResize: Codable {
    let cols: Int
    let rows: Int
}