import Foundation
import Network

/// Utility for network-related operations.
///
/// Provides helper functions for network interface discovery and IP address resolution.
/// Primarily used to determine the local machine's network addresses for display
/// in the dashboard settings.
enum NetworkUtility {
    /// Get the primary IPv4 address of the local machine
    static func getLocalIPAddress() -> String? {
        // Check common network interfaces in priority order
        let preferredInterfaces = ["en0", "en1", "en2", "en3", "en4", "en5"]
        
        for interfaceName in preferredInterfaces {
            if let address = getIPAddress(for: interfaceName) {
                return address
            }
        }
        
        // Fallback: check any "en" interface
        return getIPAddressForAnyInterface()
    }
    
    /// Get IP address for a specific interface
    private static func getIPAddress(for interfaceName: String) -> String? {
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        
        guard getifaddrs(&ifaddr) == 0 else { return nil }
        defer { freeifaddrs(ifaddr) }
        
        var ptr = ifaddr
        while ptr != nil {
            defer { ptr = ptr?.pointee.ifa_next }
            
            guard let interface = ptr?.pointee else { continue }
            
            // Skip loopback addresses
            if interface.ifa_flags & UInt32(IFF_LOOPBACK) != 0 { continue }
            
            // Check for IPv4 interface
            let addrFamily = interface.ifa_addr.pointee.sa_family
            if addrFamily == UInt8(AF_INET) {
                // Get interface name
                let name = String(cString: interface.ifa_name)
                
                if name == interfaceName {
                    var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                    if getnameinfo(
                        interface.ifa_addr,
                        socklen_t(interface.ifa_addr.pointee.sa_len),
                        &hostname,
                        socklen_t(hostname.count),
                        nil,
                        0,
                        NI_NUMERICHOST
                    ) == 0 {
                        let ipAddress = String(cString: &hostname)
                        
                        // Prefer addresses that look like local network addresses
                        if ipAddress.hasPrefix("192.168.") ||
                            ipAddress.hasPrefix("10.") ||
                            ipAddress.hasPrefix("172.") {
                            return ipAddress
                        }
                    }
                }
            }
        }
        
        return nil
    }
    
    /// Get IP address for any available interface
    private static func getIPAddressForAnyInterface() -> String? {
        var address: String?

        var ifaddr: UnsafeMutablePointer<ifaddrs>?

        guard getifaddrs(&ifaddr) == 0 else { return nil }
        defer { freeifaddrs(ifaddr) }

        var ptr = ifaddr
        while ptr != nil {
            defer { ptr = ptr?.pointee.ifa_next }

            guard let interface = ptr?.pointee else { continue }

            // Skip loopback addresses
            if interface.ifa_flags & UInt32(IFF_LOOPBACK) != 0 { continue }

            // Check for IPv4 interface
            let addrFamily = interface.ifa_addr.pointee.sa_family
            if addrFamily == UInt8(AF_INET) {
                // Get interface name
                let name = String(cString: interface.ifa_name)

                // Accept any non-loopback IPv4 address from "en" interfaces
                if name.hasPrefix("en") {
                    var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                    if getnameinfo(
                        interface.ifa_addr,
                        socklen_t(interface.ifa_addr.pointee.sa_len),
                        &hostname,
                        socklen_t(hostname.count),
                        nil,
                        0,
                        NI_NUMERICHOST
                    ) == 0 {
                        let ipAddress = String(cString: &hostname)

                        // Prefer addresses that look like local network addresses
                        if ipAddress.hasPrefix("192.168.") ||
                            ipAddress.hasPrefix("10.") ||
                            ipAddress.hasPrefix("172.")
                        {
                            return ipAddress
                        }

                        // Store as fallback if we don't find a better one
                        if address == nil {
                            address = ipAddress
                        }
                    }
                }
            }
        }

        return address
    }

    /// Get all IPv4 addresses
    static func getAllIPAddresses() -> [String] {
        var addresses: [String] = []

        var ifaddr: UnsafeMutablePointer<ifaddrs>?

        guard getifaddrs(&ifaddr) == 0 else { return addresses }
        defer { freeifaddrs(ifaddr) }

        var ptr = ifaddr
        while ptr != nil {
            defer { ptr = ptr?.pointee.ifa_next }

            guard let interface = ptr?.pointee else { continue }

            // Skip loopback addresses
            if interface.ifa_flags & UInt32(IFF_LOOPBACK) != 0 { continue }

            // Check for IPv4 interface
            let addrFamily = interface.ifa_addr.pointee.sa_family
            if addrFamily == UInt8(AF_INET) {
                var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                if getnameinfo(
                    interface.ifa_addr,
                    socklen_t(interface.ifa_addr.pointee.sa_len),
                    &hostname,
                    socklen_t(hostname.count),
                    nil,
                    0,
                    NI_NUMERICHOST
                ) == 0 {
                    let ipAddress = String(cString: &hostname)
                    addresses.append(ipAddress)
                }
            }
        }

        return addresses
    }
}
