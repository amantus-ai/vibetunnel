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
            self.deviceName.replacingOccurrences(of: "-", with: " ")
                .split(separator: ".")
                .first
                .map(String.init) ?? self.deviceName
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

    /// Shared URLSession for health probes, reused across all probe calls
    private let probeSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 3.0
        return URLSession(configuration: configuration)
    }()

    /// The next scheduled refresh time
    private(set) var nextRefreshTime: Date?

    /// Indicates if auto-refresh is currently active
    private(set) var isAutoRefreshing = false

    // MARK: - Constants

    private enum Constants {
        static let defaultPort = 4020
        static let probeTimeout: TimeInterval = 3.0
        static let discoveryInterval: TimeInterval = 30.0
    }

    // MARK: - Initialization

    private init() {}

    // MARK: - Public Methods

    /// Starts discovering Tailscale servers
    func startDiscovery() {
        guard !self.isDiscovering else {
            self.logger.debug("Discovery already in progress")
            return
        }

        guard self.tailscaleService.isRunning else {
            self.logger.info("Tailscale not running, skipping discovery")
            self.lastError = "Tailscale is not running"
            return
        }

        self.isDiscovering = true
        self.lastError = nil

        self.discoveryTask = Task {
            await self.discoverServers()
        }
    }

    /// Stops the discovery process
    func stopDiscovery() {
        self.discoveryTask?.cancel()
        self.discoveryTask = nil
        self.isDiscovering = false
    }

    /// Starts the auto-refresh timer for periodic discovery
    func startAutoRefresh() {
        // Check if auto-refresh is enabled in settings
        guard UserDefaults.standard.bool(forKey: "tailscaleAutoRefresh") else {
            self.logger.debug("Auto-refresh is disabled in settings")
            return
        }

        // Don't start if already running
        guard self.refreshTimer == nil else {
            self.logger.debug("Auto-refresh timer already running")
            return
        }

        // Must have discovery enabled and Tailscale running
        guard UserDefaults.standard.bool(forKey: "enableTailscaleDiscovery"),
              self.tailscaleService.isRunning
        else {
            self.logger.info("Cannot start auto-refresh: discovery disabled or Tailscale not running")
            return
        }

        self.logger.info("Starting auto-refresh timer with \(Constants.discoveryInterval)s interval")
        self.isAutoRefreshing = true

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
        self.refreshTimer?.invalidate()
        self.refreshTimer = nil
        self.isAutoRefreshing = false
        self.nextRefreshTime = nil
        self.logger.info("Stopped auto-refresh timer")
    }

    /// Adds a known server hostname for future discovery
    func addKnownServer(hostname: String) {
        var known = self.knownHostnames
        known.insert(hostname)
        self.knownHostnames = known

        // Immediately probe this server
        Task {
            if let server = await probeServer(hostname: hostname) {
                if !self.discoveredServers.contains(where: { $0.hostname == hostname }) {
                    self.discoveredServers.append(server)
                }
            }
        }
    }

    /// Removes a server from known servers
    func removeKnownServer(hostname: String) {
        var known = self.knownHostnames
        known.remove(hostname)
        self.knownHostnames = known

        self.discoveredServers.removeAll { $0.hostname == hostname }
    }

    /// Manually refreshes the server list
    func refresh() async {
        guard !self.isDiscovering else { return }

        self.isDiscovering = true
        defer { self.isDiscovering = false }

        await self.discoverServers()
    }

    /// Resets the entire discovery environment, clearing all state
    func resetEnvironment() {
        // Stop any ongoing discovery
        self.stopDiscovery()
        self.stopAutoRefresh()

        // Clear discovered servers
        self.discoveredServers = []

        // Clear known hostnames from UserDefaults
        self.knownHostnames = []

        // Reset error states
        self.lastError = nil
        self.isDiscovering = false

        self.logger.info("Tailscale discovery environment reset")
    }

    // MARK: - Private Methods

    private func discoverServers() async {
        self.logger.info("Starting Tailscale server discovery using API")

        // Check if Tailscale is configured and running
        guard self.tailscaleService.isConfigured else {
            self.logger.warning("Tailscale OAuth token not configured")
            self.lastError = "No OAuth token configured"
            self.isDiscovering = false
            return
        }

        // Refresh device list from API
        await self.tailscaleService.refreshStatus()

        guard self.tailscaleService.isRunning else {
            self.logger.warning("Tailscale API not accessible")
            self.lastError = self.tailscaleService.statusError ?? "API not accessible"
            self.isDiscovering = false
            return
        }

        self.logger.info("Processing \(self.tailscaleService.devices.count) devices from Tailscale API")

        // Filter devices that could be VibeTunnel servers
        var newServers: [TailscaleServer] = []

        for device in self.tailscaleService.devices {
            self.logger
                .info(
                    "Checking device: \(device.name), OS: '\(device.os ?? "nil")', isOnline: \(device.isOnline), isVibeTunnelServer: \(device.isVibeTunnelServer), lastSeen: \(device.lastSeen ?? "nil")")

            // Only check online devices that could be servers
            guard device.isOnline, device.isVibeTunnelServer else {
                self.logger
                    .info(
                        "Skipping device \(device.name): online=\(device.isOnline), server=\(device.isVibeTunnelServer), OS='\(device.os ?? "nil")'")
                continue
            }

            self.logger.info("Probing VibeTunnel on \(device.name) (\(device.ipv4Address ?? "no IP"))")

            // Check if this device has VibeTunnel running on port 4020
            if let server = await probeServer(hostname: device.name, ip: device.ipv4Address) {
                newServers.append(server)
                self.logger.info("Found VibeTunnel server: \(device.name)")
            } else {
                self.logger.info("No VibeTunnel response from \(device.name)")
            }
        }

        // Update discovered servers
        self.discoveredServers = newServers.sorted { $0.deviceName < $1.deviceName }

        self.logger.info("Discovery complete. Found \(self.discoveredServers.count) VibeTunnel servers")
        self.isDiscovering = false
    }

    private func probeServer(
        hostname: String,
        ip: String? = nil,
        port: Int = Constants.defaultPort)
        async -> TailscaleServer?
    {
        self.logger.debug("Probing server: \(hostname):\(port)")

        // Use provided IP or try to resolve the hostname
        let resolvedIP: String? = if let providedIP = ip {
            providedIP
        } else {
            await self.resolveHostname(hostname)
        }

        // Probe both HTTP and HTTPS in parallel. Prefer HTTPS when available
        // because Tailscale Serve injects identity headers for automatic auth.
        // Without HTTPS, connections go direct and require password login.
        // Uses withTaskGroup so HTTPS success cancels the HTTP probe early.
        let result = await withTaskGroup(of: (Bool, TailscaleServer?).self, returning: TailscaleServer?.self) { group in
            // isHTTPS = true
            group.addTask { await (true, self.probeHTTPS(hostname: hostname, resolvedIP: resolvedIP)) }
            // isHTTPS = false
            group.addTask { await (false, self.probeHTTP(hostname: hostname, resolvedIP: resolvedIP, port: port)) }

            var httpResult: TailscaleServer?
            for await (isHTTPS, server) in group {
                if isHTTPS, let server {
                    // HTTPS found — cancel remaining HTTP probe and return immediately
                    group.cancelAll()
                    self.logger.info("HTTPS probe succeeded for \(hostname) — using Tailscale Serve")
                    return server
                }
                if !isHTTPS {
                    httpResult = server
                }
            }

            if httpResult != nil {
                self.logger.info("HTTP probe succeeded for \(hostname) on port \(port)")
            }
            return httpResult
        }

        if result == nil {
            self.logger.info("No VibeTunnel response from \(hostname) on HTTP or HTTPS")
        }
        return result
    }

    /// Probes a server via plain HTTP on the given port
    private func probeHTTP(
        hostname: String,
        resolvedIP: String?,
        port: Int) async -> TailscaleServer?
    {
        // Construct URL for health check - VibeTunnel uses /api/health endpoint
        let urlString = if let resolvedIP {
            "http://\(resolvedIP):\(port)/api/health"
        } else {
            "http://\(hostname):\(port)/api/health"
        }
        guard let url = URL(string: urlString) else {
            self.logger.debug("Invalid URL for \(hostname)")
            return nil
        }

        return await self.performHealthProbe(
            url: url,
            hostname: hostname,
            resolvedIP: resolvedIP,
            port: port,
            isHTTPS: false)
    }

    /// Probes a server via HTTPS on port 443 (Tailscale Serve).
    /// Note: `resolvedIP` is not used in the URL because Tailscale Serve TLS certs
    /// are issued for the MagicDNS hostname — connecting via IP would fail validation.
    /// The IP is passed through to `performHealthProbe` for the returned server metadata.
    private func probeHTTPS(
        hostname: String,
        resolvedIP: String?) async -> TailscaleServer?
    {
        // Tailscale Serve uses the MagicDNS hostname with HTTPS on port 443
        let httpsUrlString = "https://\(hostname)/api/health"
        guard let url = URL(string: httpsUrlString) else {
            self.logger.debug("Invalid HTTPS URL for \(hostname)")
            return nil
        }

        return await self.performHealthProbe(
            url: url,
            hostname: hostname,
            resolvedIP: resolvedIP,
            port: 443,
            isHTTPS: true)
    }

    /// Performs the actual health probe request and parses the response
    private func performHealthProbe(
        url: URL,
        hostname: String,
        resolvedIP: String?,
        port: Int,
        isHTTPS: Bool) async -> TailscaleServer?
    {
        do {
            self.logger.debug("Probing URL: \(url.absoluteString)")
            let (data, response) = try await self.probeSession.data(from: url)

            if let httpResponse = response as? HTTPURLResponse {
                self.logger.debug("Probe response from \(hostname): HTTP \(httpResponse.statusCode)")
                if httpResponse.statusCode == 200 {
                    // Parse the health response to get Tailscale information
                    var httpsUrl: String?
                    var isPublic = false

                    if let health = try? JSONDecoder().decode(HealthResponse.self, from: data) {
                        // Check for Tailscale HTTPS URL
                        if let tailscaleUrl = health.tailscaleUrl {
                            httpsUrl = tailscaleUrl
                            self.logger.info("Found Tailscale HTTPS URL: \(tailscaleUrl)")
                        }

                        // Check connections object for more details
                        if let tailscale = health.connections?.tailscale {
                            if let tsHttpsUrl = tailscale.httpsUrl {
                                httpsUrl = tsHttpsUrl
                            }

                            // Check if Funnel (public access) is enabled
                            if let funnel = tailscale.funnel {
                                isPublic = funnel
                                self.logger.info("Tailscale Funnel enabled: \(funnel)")
                            }
                        }
                    }

                    // If we reached the server via HTTPS, use that as the httpsUrl
                    if isHTTPS, httpsUrl == nil {
                        httpsUrl = "https://\(hostname)"
                        self.logger.info("Server reachable via Tailscale Serve HTTPS: \(httpsUrl!)")
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
                        port: isHTTPS ? Constants.defaultPort : port,
                        deviceName: deviceName,
                        isReachable: true,
                        lastSeen: Date(),
                        httpsUrl: httpsUrl,
                        isPublic: isPublic)
                }
            }
        } catch {
            self.logger
                .debug("Failed to probe \(hostname) (\(isHTTPS ? "HTTPS" : "HTTP")): \(error.localizedDescription)")
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
                    NI_NUMERICHOST) == 0
                {
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
            preferSSL: tailscaleServer.httpsUrl != nil)
    }
}
