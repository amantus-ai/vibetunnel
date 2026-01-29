import Foundation

/// Constants for remote access features
enum RemoteAccessConstants {
    static let defaultPort = 4020
    static let statusCheckInterval: TimeInterval = 15.0 // Reduced frequency to prevent UI flickering
    static let tailscaleCheckInterval: TimeInterval = 10.0 // Reduced frequency to match TailscaleServeStatusService
    static let cloudflareCheckInterval: TimeInterval = 10.0
    static let startTimeoutInterval: TimeInterval = 15.0
}
