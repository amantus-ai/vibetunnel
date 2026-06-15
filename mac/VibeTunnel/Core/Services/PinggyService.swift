import AppKit
import Foundation
import Observation
import os

enum PinggyError: LocalizedError, Equatable {
    case notInstalled
    case tunnelAlreadyRunning
    case tunnelCreationFailed(String)

    var errorDescription: String? {
        switch self {
        case .notInstalled:
            "pinggy is not installed"
        case .tunnelAlreadyRunning:
            "A Pinggy tunnel is already running"
        case let .tunnelCreationFailed(message):
            "Failed to create Pinggy tunnel: \(message)"
        }
    }
}

/// Manages a Pinggy CLI process that exposes the local VibeTunnel dashboard.
@Observable
@MainActor
final class PinggyService {
    static let shared = PinggyService()
    static var isTestMode = false

    static var pinggySearchPaths: [String] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return [
            "\(FilePathConstants.optHomebrewBin)/pinggy",
            "\(FilePathConstants.usrLocalBin)/pinggy",
            "\(FilePathConstants.usrBin)/pinggy",
            "/etc/profiles/per-user/\(NSUserName())/bin/pinggy",
            "\(home)/.local/bin/pinggy",
            "\(home)/.npm-global/bin/pinggy",
        ]
    }

    private(set) var isInstalled = false
    private(set) var isRunning = false
    private(set) var publicUrl: String?
    private(set) var statusError: String?
    private(set) var pinggyPath: String?

    var accessToken: String? {
        PinggyKeychain.getToken()
    }

    var hasAccessToken: Bool {
        PinggyKeychain.hasToken()
    }

    private var pinggyProcess: Process?
    private var outputHandles: [FileHandle] = []
    private var outputBuffer = ""
    private var isStopping = false
    private var tokenConfigURL: URL?
    private var tokenConfigCleanupTask: Task<Void, Never>?

    private let logger = Logger(subsystem: BundleIdentifiers.main, category: "PinggyService")

    private init() {
        _ = self.checkCLIInstallation()
    }

    @discardableResult
    func checkCLIInstallation() -> Bool {
        for path in Self.pinggySearchPaths where FileManager.default.isExecutableFile(atPath: path) {
            self.pinggyPath = path
            self.isInstalled = true
            return true
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: FilePathConstants.which)
        process.arguments = ["pinggy"]

        var environment = ProcessInfo.processInfo.environment
        let currentPath = environment[EnvironmentKeys.path] ?? "\(FilePathConstants.usrBin):\(FilePathConstants.bin)"
        let extraPaths = Self.pinggySearchPaths
            .map { URL(fileURLWithPath: $0).deletingLastPathComponent().path }
            .joined(separator: ":")
        environment[EnvironmentKeys.path] = "\(extraPaths):\(currentPath)"
        process.environment = environment

        let outputPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = Pipe()

        do {
            try process.run()
            process.waitUntilExit()
            let data = try outputPipe.fileHandleForReading.readToEnd() ?? Data()
            let path = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)

            if process.terminationStatus == 0,
               let path,
               !path.isEmpty,
               FileManager.default.isExecutableFile(atPath: path)
            {
                self.pinggyPath = path
                self.isInstalled = true
                return true
            }
        } catch {
            self.logger.debug("Failed to locate pinggy with which: \(error.localizedDescription)")
        }

        self.pinggyPath = nil
        self.isInstalled = false
        return false
    }

    @discardableResult
    func saveAccessToken(_ token: String) -> Bool {
        PinggyKeychain.setToken(token)
    }

    func deleteAccessToken() {
        PinggyKeychain.deleteToken()
    }

    func startTunnel(port: Int) async throws {
        guard self.checkCLIInstallation(), let binaryPath = pinggyPath else {
            throw PinggyError.notInstalled
        }
        guard !self.isRunning else {
            throw PinggyError.tunnelAlreadyRunning
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: binaryPath)

        do {
            self.tokenConfigURL = try Self.createTemporaryTokenConfig(token: self.accessToken)
        } catch {
            throw PinggyError.tunnelCreationFailed("Could not prepare access token: \(error.localizedDescription)")
        }
        process.arguments = Self.startArguments(port: port, configPath: self.tokenConfigURL?.path)

        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        process.terminationHandler = { [weak self] terminatedProcess in
            Task { @MainActor in
                guard let self, self.pinggyProcess === terminatedProcess else { return }
                let stoppedIntentionally = self.isStopping
                self.clearProcessState()
                if !stoppedIntentionally, terminatedProcess.terminationStatus != 0 {
                    self.statusError = "Pinggy exited with status \(terminatedProcess.terminationStatus)"
                }
            }
        }

        do {
            self.isStopping = false
            self.pinggyProcess = process
            try process.run()
            guard process.isRunning else {
                let status = process.terminationStatus
                self.clearProcessState()
                throw PinggyError.tunnelCreationFailed("Pinggy exited with status \(status)")
            }
            self.isRunning = true
            self.publicUrl = nil
            self.statusError = nil
            self.startOutputMonitoring(outputPipe: outputPipe, errorPipe: errorPipe)
            self.scheduleTokenConfigCleanup()
            self.logger.info("Started Pinggy tunnel on port \(port)")
        } catch {
            self.clearProcessState()
            if let pinggyError = error as? PinggyError {
                throw pinggyError
            }
            throw PinggyError.tunnelCreationFailed(error.localizedDescription)
        }
    }

    func stopTunnel() async {
        guard let process = pinggyProcess else {
            self.clearProcessState()
            return
        }

        self.isStopping = true
        process.terminate()

        for _ in 0..<20 where process.isRunning {
            try? await Task.sleep(for: .milliseconds(100))
        }

        self.clearProcessState()
        self.logger.info("Stopped Pinggy tunnel")
    }

    /// Fast app-termination path. Pinggy handles SIGTERM by stopping its foreground tunnel.
    func sendTerminationSignal() {
        self.isStopping = true
        self.pinggyProcess?.terminate()
        self.clearProcessState()
    }

    func copyInstallCommand() {
        guard !Self.isTestMode else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString("npm install -g pinggy", forType: .string)
    }

    func openSetupGuide() {
        guard !Self.isTestMode, let url = URL(string: URLConstants.pinggyDocs) else { return }
        NSWorkspace.shared.open(url)
    }

    func openDashboard() {
        guard !Self.isTestMode, let url = URL(string: URLConstants.pinggyDashboard) else { return }
        NSWorkspace.shared.open(url)
    }

    nonisolated static func extractPublicURL(from output: String) -> String? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
            return nil
        }

        let range = NSRange(output.startIndex..., in: output)
        let ignoredHosts = ["pinggy.io", "dashboard.pinggy.io", "npmjs.com", "www.npmjs.com"]

        return detector
            .matches(in: output, options: [], range: range)
            .compactMap(\.url)
            .first { url in
                guard url.scheme == "https", let host = url.host?.lowercased() else { return false }
                return !ignoredHosts.contains(host) && !host.hasSuffix(".pinggy.io")
            }?
            .absoluteString
    }

    nonisolated static func startArguments(port: Int, configPath: String?) -> [String] {
        var arguments = ["--noTui", "-l", "http://localhost:\(port)"]
        if let configPath, !configPath.isEmpty {
            arguments.append(contentsOf: ["--conf", configPath])
        }
        return arguments
    }

    nonisolated static func createTemporaryTokenConfig(token: String?) throws -> URL? {
        guard let token = token?.trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else {
            return nil
        }

        let fileManager = FileManager.default
        let directory = fileManager.temporaryDirectory
            .appendingPathComponent("VibeTunnel", isDirectory: true)
            .appendingPathComponent("Pinggy", isDirectory: true)
        try fileManager.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)

        let configURL = directory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("json")
        let data = try JSONSerialization.data(withJSONObject: ["token": token])
        guard fileManager.createFile(
            atPath: configURL.path,
            contents: data,
            attributes: [.posixPermissions: 0o600])
        else {
            throw CocoaError(.fileWriteUnknown)
        }
        return configURL
    }

    private func startOutputMonitoring(outputPipe: Pipe, errorPipe: Pipe) {
        self.clearOutputHandlers()

        let handles = [outputPipe.fileHandleForReading, errorPipe.fileHandleForReading]
        self.outputHandles = handles

        for handle in handles {
            handle.readabilityHandler = { [weak self] readableHandle in
                let data = readableHandle.availableData
                guard !data.isEmpty else {
                    readableHandle.readabilityHandler = nil
                    return
                }
                guard let output = String(data: data, encoding: .utf8) else { return }

                Task { @MainActor in
                    self?.processOutput(output)
                }
            }
        }
    }

    private func processOutput(_ output: String) {
        guard self.isRunning else { return }

        self.clearTemporaryTokenConfig()
        self.outputBuffer.append(output)
        if self.outputBuffer.count > 32768 {
            self.outputBuffer = String(self.outputBuffer.suffix(32768))
        }

        if let url = Self.extractPublicURL(from: self.outputBuffer) {
            self.publicUrl = url
            self.statusError = nil
            self.logger.info("Pinggy public URL: \(url)")
        }
    }

    private func clearOutputHandlers() {
        for handle in self.outputHandles {
            handle.readabilityHandler = nil
        }
        self.outputHandles.removeAll()
    }

    private func scheduleTokenConfigCleanup() {
        guard let tokenConfigURL else { return }

        self.tokenConfigCleanupTask?.cancel()
        self.tokenConfigCleanupTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            self?.clearTemporaryTokenConfig(ifMatching: tokenConfigURL)
        }
    }

    private func clearTemporaryTokenConfig(ifMatching expectedURL: URL? = nil) {
        guard expectedURL == nil || self.tokenConfigURL == expectedURL else { return }

        self.tokenConfigCleanupTask?.cancel()
        self.tokenConfigCleanupTask = nil
        if let tokenConfigURL {
            try? FileManager.default.removeItem(at: tokenConfigURL)
        }
        self.tokenConfigURL = nil
    }

    private func clearProcessState() {
        self.clearOutputHandlers()
        self.clearTemporaryTokenConfig()
        self.pinggyProcess = nil
        self.isRunning = false
        self.publicUrl = nil
        self.statusError = nil
        self.outputBuffer = ""
        self.isStopping = false
    }
}

private enum PinggyKeychain {
    private static let service = KeychainConstants.vibeTunnelService
    private static let account = KeychainConstants.pinggyAccessToken

    static func getToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: self.service,
            kSecAttrAccount as String: self.account,
            kSecReturnData as String: true,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess,
              let data = result as? Data
        else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    static func hasToken() -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: self.service,
            kSecAttrAccount as String: self.account,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: false,
        ]

        var result: AnyObject?
        return SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess
    }

    @discardableResult
    static func setToken(_ token: String) -> Bool {
        guard let data = token.data(using: .utf8) else { return false }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: self.service,
            kSecAttrAccount as String: self.account,
        ]
        let update = [kSecValueData as String: data]
        var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)

        if status == errSecItemNotFound {
            var addQuery = query
            addQuery[kSecValueData as String] = data
            status = SecItemAdd(addQuery as CFDictionary, nil)
        }
        return status == errSecSuccess
    }

    static func deleteToken() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: self.service,
            kSecAttrAccount as String: self.account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
