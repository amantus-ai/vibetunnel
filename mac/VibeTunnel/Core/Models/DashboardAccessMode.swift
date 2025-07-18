import Foundation

/// Dashboard access mode.
///
/// Determines the network binding configuration for the VibeTunnel server.
/// Controls whether the web interface is accessible only locally or
/// from other devices on the network.
enum DashboardAccessMode: String, CaseIterable {
    // Raw values are automatically inferred as "localhost" and "network"
    // These must match AppConstants.DashboardAccessModeRawValues
    case localhost
    case network

    var displayName: String {
        switch self {
        case .localhost: "Localhost only"
        case .network: "Network"
        }
    }

    var bindAddress: String {
        switch self {
        case .localhost: "127.0.0.1"
        case .network: "0.0.0.0"
        }
    }

    var description: String {
        switch self {
        case .localhost: "Only accessible from this Mac."
        case .network: "Accessible from other devices on this network."
        }
    }
}
