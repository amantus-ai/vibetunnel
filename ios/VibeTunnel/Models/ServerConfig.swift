import Foundation

struct ServerConfig: Codable, Equatable {
    let host: String
    let port: Int
    let name: String?
    
    var baseURL: URL {
        URL(string: "http://\(host):\(port)")!
    }
    
    var displayName: String {
        name ?? "\(host):\(port)"
    }
}