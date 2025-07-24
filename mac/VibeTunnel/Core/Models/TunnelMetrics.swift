import Foundation

/// Traffic metrics for the ngrok tunnel.
///
/// Tracks connection count and bandwidth usage.
struct TunnelMetrics: Codable {
    let connectionsCount: Int
    let bytesIn: Int64
    let bytesOut: Int64
}