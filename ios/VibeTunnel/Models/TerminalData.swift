import Foundation

struct TerminalEvent {
    let timestamp: Double
    let type: EventType
    let data: String
    
    enum EventType: String {
        case output = "o"
        case input = "i"
        case resize = "r"
        case marker = "m"
    }
    
    init?(from line: String) {
        // Parse Asciinema v2 format: [timestamp, "type", "data"]
        guard let data = line.data(using: .utf8),
              let array = try? JSONSerialization.jsonObject(with: data) as? [Any],
              array.count >= 3,
              let timestamp = array[0] as? Double,
              let typeString = array[1] as? String,
              let type = EventType(rawValue: typeString),
              let eventData = array[2] as? String else {
            return nil
        }
        
        self.timestamp = timestamp
        self.type = type
        self.data = eventData
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
        case arrowUp = "arrow_up"
        case arrowDown = "arrow_down"
        case arrowLeft = "arrow_left"
        case arrowRight = "arrow_right"
        case escape = "escape"
        case enter = "enter"
        case ctrlEnter = "ctrl_enter"
        case shiftEnter = "shift_enter"
        case tab = "\t"
        case ctrlC = "\u{0003}"
        case ctrlD = "\u{0004}"
        case ctrlZ = "\u{001A}"
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