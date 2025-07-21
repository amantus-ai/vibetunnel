import Foundation
import SystemConfiguration

/// A utility for network-related operations.
public enum NetworkUtility {
    /// Retrieves the local IP address of the device, typically on the "en0" interface.
    ///
    /// This function iterates through the network interfaces of the device to find the IPv4 or IPv6 address
    /// for the primary Wi-Fi interface (`en0`).
    ///
    /// - Returns: A string containing the local IP address if found; otherwise, `nil`.
    public static func getLocalIPAddress() -> String? {
        var address: String?
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0 else { return nil }
        guard let firstAddr = ifaddr else { return nil }

        for ptr in sequence(first: firstAddr, next: { $0.pointee.ifa_next }) {
            let interface = ptr.pointee
            let addrFamily = interface.ifa_addr.pointee.sa_family

            // Check for IPv4 or IPv6 address on the en0 interface
            if addrFamily == UInt8(AF_INET) || addrFamily == UInt8(AF_INET6) {
                if let name = String(cString: interface.ifa_name, encoding: .utf8), name == "en0" {
                    var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                    getnameinfo(
                        interface.ifa_addr,
                        socklen_t(interface.ifa_addr.pointee.sa_len),
                        &hostname,
                        socklen_t(hostname.count),
                        nil,
                        socklen_t(0),
                        NI_NUMERICHOST
                    )
                    address = String(cString: hostname)
                }
            }
        }
        freeifaddrs(ifaddr)
        return address
    }
}
