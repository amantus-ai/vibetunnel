import Foundation

struct LogInfo: Codable {
    let size: Int64
    let lastModified: Date
    let clientLogSize: Int64?
    let serverLogSize: Int64?
    
    var totalSize: Int64 {
        return (clientLogSize ?? 0) + (serverLogSize ?? 0)
    }
}
