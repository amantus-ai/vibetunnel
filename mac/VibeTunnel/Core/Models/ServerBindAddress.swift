import Darwin
import Foundation

/// A validated IPv4 or IPv6 literal used for server binding and dashboard URLs.
struct ServerBindAddress: Equatable {
    enum Family: Equatable {
        case ipv4
        case ipv6
    }

    let value: String
    let family: Family

    init?(_ rawValue: String) {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)

        var ipv4Address = in_addr()
        if value.withCString({ inet_pton(AF_INET, $0, &ipv4Address) }) == 1 {
            self.value = value
            self.family = .ipv4
            return
        }

        var ipv6Address = in6_addr()
        if value.withCString({ inet_pton(AF_INET6, $0, &ipv6Address) }) == 1 {
            self.value = value
            self.family = .ipv6
            return
        }

        return nil
    }

    var connectableAddress: Self {
        switch self.value {
        case "0.0.0.0":
            Self("127.0.0.1")!
        case "::":
            Self("::1")!
        default:
            self
        }
    }

    var urlHost: String {
        switch self.family {
        case .ipv4:
            self.value
        case .ipv6:
            "[\(self.value)]"
        }
    }

    func endpoint(port: String) -> String {
        "\(self.urlHost):\(port)"
    }

    func url(port: String, endpoint: String = "/") -> URL? {
        guard let portNumber = Int(port) else {
            return nil
        }

        var components = URLComponents()
        components.scheme = "http"
        // Foundation on supported macOS versions returns nil for raw IPv6 literals here.
        components.host = self.urlHost
        components.port = portNumber
        components.path = endpoint.hasPrefix("/") ? endpoint : "/\(endpoint)"
        return components.url
    }
}
