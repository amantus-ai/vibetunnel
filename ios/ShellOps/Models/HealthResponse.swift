import Foundation

struct HealthResponse: Decodable {
    struct Connections: Decodable {
        struct Tailscale: Decodable {
            let httpsAvailable: Bool?
            let httpsUrl: String?
            let isPublic: Bool?
            let funnel: Bool?
        }

        let tailscale: Tailscale?
        let sslAvailable: Bool?
        let isPublic: Bool?
    }

    let connections: Connections?
    let tailscaleUrl: String?
}
