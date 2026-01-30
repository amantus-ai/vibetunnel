import Foundation
import Observation

/// Service for discovering VibeTunnel servers available via Tailscale network
@Observable
@MainActor
final class TailscaleDiscoveryService {
    static let shared = TailscaleDiscoveryService()

    // MARK: - Types

    /// Represents a discovered Tailscale server
    struct TailscaleServer: Identifiable, Equatable {
        let id = UUID()
        let hostname: String
        let ip: String?
        let port: Int
        let deviceName: String
        let isReachable: Bool
        let lastSeen: Date
        let httpsUrl: String?
        let isPublic: Bool

        var displayName: String {
            deviceName.replacingOccurrences(of: "-", with: " ")
                .split(separator: ".")
                .first
                .map(String.init) ?? deviceName
        }
    }

    // MARK: - Properties

    private let logger = Logger(category: "TailscaleDiscovery")

    /// Currently discovered Tailscale servers
    private(set) var discoveredServers: [TailscaleServer] = []

    /// Whether discovery is currently in progress
    private(set) var isDiscovering = false

    /// Error from last discovery attempt
    private(set) var lastError: String?

    /// Known server hostnames to probe (persisted)
    private var knownHostnames: Set<String> {
        get {
            let saved = UserDefaults.standard.array(forKey: "TailscaleKnownServers") as? [String] ?? []
            return Set(saved)
        }
        set {
            UserDefaults.standard.set(Array(newValue), forKey: "TailscaleKnownServers")
        }
    }

    private let tailscaleService = TailscaleService.shared
    private var discoveryTask: Task<Void, Never>?
    private var refreshTimer: Timer?

    /// The next scheduled refresh time
    private(set) var nextRefreshTime: Date?

    /// Indicates if auto-refresh is currently active
    private(set) var isAutoRefreshing = false

    // MARK: - Constants

    private enum Constants {
        static let defaultPort = 4_020
        static let probeTimeout: TimeInterval = 3.0
        static let discoveryInterval: TimeInterval = 30.0
    }

    // MARK: - Initialization

    private init() {}

    // MARK: - Public Methods

    /// Starts discovering Tailscale servers
    func startDiscovery() {
        guard !isDiscovering else {
            logger.debug("Discovery already in progress")
            return
        }

        guard tailscaleService.isRunning else {
            logger.info("Tailscale not running, skipping discovery")
            lastError = "Tailscale is not running"
            return
        }

        isDiscovering = true
        lastError = nil

        discoveryTask = Task {
            await discoverServers()
        }
    }

    /// Stops the discovery process
    func stopDiscovery() {
        discoveryTask?.cancel()
        discoveryTask = nil
        isDiscovering = false
    }

    /// Starts the auto-refresh timer for periodic discovery
    func startAutoRefresh() {
        // Check if auto-refresh is enabled in settings
        guard UserDefaults.standard.bool(forKey: "tailscaleAutoRefresh") else {
            logger.debug("Auto-refresh is disabled in settings")
            return
        }

        // Don't start if already running
        guard refreshTimer == nil else {
            logger.debug("Auto-refresh timer already running")
            return
        }

        // Must have discovery enabled and Tailscale running
        guard UserDefaults.standard.bool(forKey: "enableTailscaleDiscovery"),
              tailscaleService.isRunning
        else {
            logger.info("Cannot start auto-refresh: discovery disabled or Tailscale not running")
            return
        }

        logger.info("Starting auto-refresh timer with \(Constants.discoveryInterval)s interval")
        isAutoRefreshing = true

        // Schedule the timer on the main run loop
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }

            self.refreshTimer = Timer
                .scheduledTimer(withTimeInterval: Constants.discoveryInterval, repeats: true) { [weak self] _ in
                    guard let self else { return }

                    Task {
                        // Update next refresh time
                        await MainActor.run {
                            self.nextRefreshTime = Date().addingTimeInterval(Constants.discoveryInterval)
                        }

                        // Perform the refresh
                        await self.refresh()
                    }
                }

            // Set initial next refresh time
            self.nextRefreshTime = Date().addingTimeInterval(Constants.discoveryInterval)

            // Fire immediately for first refresh
            self.refreshTimer?.fire()
        }
    }

    /// Stops the auto-refresh timer
    func stopAutoRefresh() {
        refreshTimer?.invalidate()
        refreshTimer = nil
        isAutoRefreshing = false
        nextRefreshTime = nil
        logger.info("Stopped auto-refresh timer")
    }

    /// Adds a known server hostname for future discovery
    func addKnownServer(hostname: String) {
        var known = knownHostnames
        known.insert(hostname)
        knownHostnames = known

        // Immediately probe this server
        Task {
            if let server = await probeServer(hostname: hostname) {
                if !discoveredServers.contains(where: { $0.hostname == hostname }) {
                    discoveredServers.append(server)
                }
            }
        }
    }

    /// Removes a server from known servers
    func removeKnownServer(hostname: String) {
        var known = knownHostnames
        known.remove(hostname)
        knownHostnames = known

        discoveredServers.removeAll { $0.hostname == hostname }
    }

    /// Manually refreshes the server list
    func refresh() async {
        guard !isDiscovering else { return }

        isDiscovering = true
        defer { isDiscovering = false }

        await discoverServers()
    }

    /// Resets the entire discovery environment, clearing all state
    func resetEnvironment() {
        // Stop any ongoing discovery
        stopDiscovery()
        stopAutoRefresh()

        // Clear discovered servers
        discoveredServers = []

        // Clear known hostnames from UserDefaults
        knownHostnames = []

        // Reset error states
        lastError = nil
        isDiscovering = false

        logger.info("Tailscale discovery environment reset")
    }

    // MARK: - Private Methods

    private func discoverServers() async {
        logger.info("Starting Tailscale server discovery using API")

        // Check if Tailscale is configured and running
        guard tailscaleService.isConfigured else {
            logger.warning("Tailscale OAuth token not configured")
            lastError = "No OAuth token configured"
            isDiscovering = false
            return
        }

        // Refresh device list from API
        await tailscaleService.refreshStatus()

        guard tailscaleService.isRunning else {
            logger.warning("Tailscale API not accessible")
            lastError = tailscaleService.statusError ?? "API not accessible"
            isDiscovering = false
            return
        }

        logger.info("Processing \(tailscaleService.devices.count) devices from Tailscale API")

        // Filter devices that could be VibeTunnel servers
        var newServers: [TailscaleServer] = []

        for device in tailscaleService.devices {
            logger
                .info(
                    "Checking device: \(device.name), OS: '\(device.os ?? "nil")', isOnline: \(device.isOnline), isVibeTunnelServer: \(device.isVibeTunnelServer), lastSeen: \(device.lastSeen ?? "nil")"
                )

            // Only check online devices that could be servers
            guard device.isOnline && device.isVibeTunnelServer else {
                logger
                    .info(
                        "Skipping device \(device.name): online=\(device.isOnline), server=\(device.isVibeTunnelServer), OS='\(device.os ?? "nil")'"
                    )
                continue
            }

            logger.info("Probing VibeTunnel on \(device.name) (\(device.ipv4Address ?? "no IP"))")

            // Check if this device has VibeTunnel running on port 4020
            if let server = await probeServer(hostname: device.name, ip: device.ipv4Address) {
                newServers.append(server)
                logger.info("Found VibeTunnel server: \(device.name)")
            } else {
                logger.info("No VibeTunnel response from \(device.name)")
            }
        }

        // Update discovered servers
        discoveredServers = newServers.sorted { $0.deviceName < $1.deviceName }

        logger.info("Discovery complete. Found \(discoveredServers.count) VibeTunnel servers")
        isDiscovering = false
    }

    private func probeServer(
        hostname: String,
        ip: String? = nil,
        port: Int = Constants.defaultPort
    )
        async -> TailscaleServer?
    {
        logger.debug("Probing server: \(hostname):\(port)")

        // Use provided IP or try to resolve the hostname
        let resolvedIP: String? = if let providedIP = ip {
            providedIP
        } else {
            await resolveHostname(hostname)
        }

        // Construct URL for health check - VibeTunnel uses /api/health endpoint
        let urlString: String = if let resolvedIP {
            "http://\(resolvedIP):\(port)/api/health"
        } else {
            "http://\(hostname):\(port)/api/health"
        }
        guard let url = URL(string: urlString) else {
            logger.debug("Invalid URL for \(hostname)")
            return nil
        }

        // Perform health check
        do {
            let configuration = URLSessionConfiguration.default
            configuration.timeoutIntervalForRequest = Constants.probeTimeout
            let session = URLSession(configuration: configuration)

            logger.debug("Probing URL: \(url.absoluteString)")
            let (data, response) = try await session.data(from: url)

            if let httpResponse = response as? HTTPURLResponse {
                logger.debug("Probe response from \(hostname): HTTP \(httpResponse.statusCode)")
                if httpResponse.statusCode == 200 {
                    // Parse the health response to get Tailscale information
                    var httpsUrl: String?
                    var isPublic = false

                    if let health = try? JSONDecoder().decode(HealthResponse.self, from: data) {
                        // Check for Tailscale HTTPS URL
                        if let tailscaleUrl = health.tailscaleUrl {
                            httpsUrl = tailscaleUrl
                            logger.info("Found Tailscale HTTPS URL: \(tailscaleUrl)")
                        }

                        // Check connections object for more details
                        if let tailscale = health.connections?.tailscale {
                            if let tsHttpsUrl = tailscale.httpsUrl {
                                httpsUrl = tsHttpsUrl
                            }

                            // Check if Funnel (public access) is enabled
                            if let funnel = tailscale.funnel {
                                isPublic = funnel
                                logger.info("Tailscale Funnel enabled: \(funnel)")
                            }
                        }
                    }

                    // Extract device name from hostname
                    let deviceName = hostname
                        .replacingOccurrences(of: ".ts.net", with: "")
                        .replacingOccurrences(of: ".tailscale.net", with: "")
                        .split(separator: ".")
                        .first
                        .map(String.init) ?? hostname

                    return TailscaleServer(
                        hostname: hostname,
                        ip: resolvedIP,
                        port: port,
                        deviceName: deviceName,
                        isReachable: true,
                        lastSeen: Date(),
                        httpsUrl: httpsUrl,
                        isPublic: isPublic
                    )
                }
            }
        } catch {
            logger.debug("Failed to probe \(hostname): \(error.localizedDescription)")
        }

        return nil
    }

    private func resolveHostname(_ hostname: String) async -> String? {
        // Try to resolve hostname to IP address
        guard let host = hostname.cString(using: .utf8) else { return nil }

        var hints = addrinfo()
        hints.ai_family = AF_INET // IPv4
        hints.ai_socktype = SOCK_STREAM

        var result: UnsafeMutablePointer<addrinfo>?
        let status = getaddrinfo(host, nil, &hints, &result)

        guard status == 0, let res = result else {
            return nil
        }

        defer { freeaddrinfo(result) }

        var ipAddress: String?
        var ptr: UnsafeMutablePointer<addrinfo>? = res

        while let currentPtr = ptr {
            let info = currentPtr.pointee
            if info.ai_family == AF_INET, let aiAddr = info.ai_addr {
                var addr = aiAddr.pointee
                var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))

                if getnameinfo(
                    &addr,
                    info.ai_addrlen,
                    &hostname,
                    socklen_t(hostname.count),
                    nil,
                    0,
                    NI_NUMERICHOST
                ) == 0 {
                    // Use the recommended String initializer to avoid deprecation warning
                    let hostnameData = hostname.withUnsafeBufferPointer { buffer in
                        guard let baseAddress = buffer.baseAddress else { return Data() }
                        return Data(bytes: baseAddress, count: strlen(hostname))
                    }
                    ipAddress = String(data: hostnameData, encoding: .utf8) ?? ""
                    break
                }
            }
            ptr = currentPtr.pointee.ai_next
        }

        return ipAddress
    }

    /// Creates a ServerConfig from a discovered Tailscale server
    func serverConfig(from tailscaleServer: TailscaleServer) -> ServerConfig {
        ServerConfig(
            host: tailscaleServer.ip ?? tailscaleServer.hostname,
            port: tailscaleServer.port,
            name: tailscaleServer.displayName,
            tailscaleHostname: tailscaleServer.hostname,
            tailscaleIP: tailscaleServer.ip,
            isTailscaleEnabled: true,
            preferTailscale: true,
            httpsAvailable: tailscaleServer.httpsUrl != nil,
            isPublic: tailscaleServer.isPublic,
            preferSSL: tailscaleServer.httpsUrl != nil
        )
    }
}
