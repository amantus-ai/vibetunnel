import Foundation

/// Constants for remote access features
enum RemoteAccessConstants {
    static let defaultPort = 4020
    static let statusCheckInterval: TimeInterval = 5.0
    static let tailscaleCheckInterval: TimeInterval = 5.0
    static let cloudflareCheckInterval: TimeInterval = 10.0
    static let startTimeoutInterval: TimeInterval = 15.0
}