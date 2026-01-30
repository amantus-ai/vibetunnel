import Foundation

/// Traffic metrics for the ngrok tunnel.
///
/// This struct provides real-time metrics about tunnel usage, including
/// active connections and bandwidth consumption in both directions.
struct TunnelMetrics: Codable {
    /// The current number of active connections through the tunnel.
    ///
    /// This represents the number of clients currently connected to
    /// the tunnel endpoint.
    let connectionsCount: Int

    /// Total bytes received through the tunnel.
    ///
    /// This cumulative value represents all data received from external
    /// clients since the tunnel was established.
    let bytesIn: Int64

    /// Total bytes sent through the tunnel.
    ///
    /// This cumulative value represents all data sent to external
    /// clients since the tunnel was established.
    let bytesOut: Int64
}
