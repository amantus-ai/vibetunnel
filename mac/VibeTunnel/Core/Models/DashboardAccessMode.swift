import Foundation

/// Dashboard access mode for the VibeTunnel server.
///
/// Determines the network binding configuration for the VibeTunnel server.
/// Controls whether the web interface is accessible only locally or
/// from other devices on the network.
enum DashboardAccessMode: String, CaseIterable {
    // Raw values are automatically inferred as "localhost", "network", and "custom"
    // These must match AppConstants.DashboardAccessModeRawValues
    case localhost
    case network
    case custom

    var displayName: String {
        switch self {
        case .localhost: "Localhost only"
        case .network: "Network"
        case .custom: "Custom address"
        }
    }

    var fixedBindAddress: ServerBindAddress? {
        switch self {
        case .localhost: ServerBindAddress("127.0.0.1")
        case .network: ServerBindAddress("0.0.0.0")
        case .custom: nil
        }
    }

    func resolvedBindAddress(customAddress: String?) -> ServerBindAddress {
        self.fixedBindAddress ?? customAddress.flatMap(ServerBindAddress.init) ?? ServerBindAddress("127.0.0.1")!
    }

    var description: String {
        switch self {
        case .localhost: "Only accessible from this Mac."
        case .network: "Accessible from other devices on this network."
        case .custom: "Bind to a specific IPv4 or IPv6 address."
        }
    }
}
