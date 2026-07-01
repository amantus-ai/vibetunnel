import AppKit
import Foundation
import Observation
import os

enum PangolinError: LocalizedError, Equatable {
    case notInstalled
    case credentialsMissing
    case alreadyRunning
    case connectionFailed(String)

    var errorDescription: String? {
        switch self {
        case .notInstalled:
            "Newt is not installed"
        case .credentialsMissing:
            "Pangolin site credentials are missing"
        case .alreadyRunning:
            "A Pangolin Newt connection is already running"
        case let .connectionFailed(message):
            "Failed to start Pangolin Newt: \(message)"
        }
    }
}

struct PangolinCredentials: Codable, Equatable {
    let endpoint: String
    let siteID: String
    let secret: String
}

/// Manages the Newt process that connects this Mac to a Pangolin site.
@Observable
@MainActor
final class PangolinService {
    static let shared = PangolinService()
    static var isTestMode = false

    static var newtSearchPaths: [String] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return [
            "\(FilePathConstants.optHomebrewBin)/newt",
            "\(FilePathConstants.usrLocalBin)/newt",
            "\(FilePathConstants.usrBin)/newt",
            "/etc/profiles/per-user/\(NSUserName())/bin/newt",
            "\(home)/.local/bin/newt",
        ]
    }

    private(set) var isInstalled = false
    private(set) var isRunning = false
    private(set) var isConnected = false
    private(set) var statusError: String?
    private(set) var newtPath: String?

    var credentials: PangolinCredentials? {
        PangolinKeychain.getCredentials()
    }

    var hasCredentials: Bool {
        self.credentials != nil
    }

    private var newtProcess: Process?
    private var outputHandles: [FileHandle] = []
    private var outputBuffer = ""
    private var isStopping = false
    private var configURL: URL?

    private let logger = Logger(subsystem: BundleIdentifiers.main, category: "PangolinService")

    private init() {
        _ = self.checkCLIInstallation()
    }

    @discardableResult
    func checkCLIInstallation() -> Bool {
        for path in Self.newtSearchPaths where FileManager.default.isExecutableFile(atPath: path) {
            self.newtPath = path
            self.isInstalled = true
            return true
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: FilePathConstants.which)
        process.arguments = ["newt"]

        var environment = ProcessInfo.processInfo.environment
        let currentPath = environment[EnvironmentKeys.path] ?? "\(FilePathConstants.usrBin):\(FilePathConstants.bin)"
        let extraPaths = Self.newtSearchPaths
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
                self.newtPath = path
                self.isInstalled = true
                return true
            }
        } catch {
            self.logger.debug("Failed to locate newt with which: \(error.localizedDescription)")
        }

        self.newtPath = nil
        self.isInstalled = false
        return false
    }

    @discardableResult
    func saveCredentials(endpoint: String, siteID: String, secret: String) -> Bool {
        guard let credentials = Self.normalizeCredentials(
            endpoint: endpoint,
            siteID: siteID,
            secret: secret)
        else {
            return false
        }
        return PangolinKeychain.setCredentials(credentials)
    }

    func deleteCredentials() {
        PangolinKeychain.deleteCredentials()
    }

    func start() async throws {
        guard self.checkCLIInstallation(), let binaryPath = newtPath else {
            throw PangolinError.notInstalled
        }
        guard let credentials else {
            throw PangolinError.credentialsMissing
        }
        guard !self.isRunning else {
            throw PangolinError.alreadyRunning
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: binaryPath)

        do {
            self.configURL = try Self.createTemporaryConfig(credentials: credentials)
        } catch {
            throw PangolinError.connectionFailed("Could not prepare site credentials: \(error.localizedDescription)")
        }
        process.arguments = Self.startArguments(configPath: self.configURL?.path)

        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        process.terminationHandler = { [weak self] terminatedProcess in
            Task { @MainActor in
                guard let self, self.newtProcess === terminatedProcess else { return }
                let stoppedIntentionally = self.isStopping
                let status = terminatedProcess.terminationStatus
                self.clearProcessState()
                if !stoppedIntentionally {
                    self.statusError = "Newt exited with status \(status)"
                }
            }
        }

        do {
            self.isStopping = false
            self.newtProcess = process
            try process.run()
            guard process.isRunning else {
                let status = process.terminationStatus
                self.clearProcessState()
                throw PangolinError.connectionFailed("Newt exited with status \(status)")
            }
            self.isRunning = true
            self.isConnected = false
            self.statusError = nil
            self.startOutputMonitoring(outputPipe: outputPipe, errorPipe: errorPipe)
            self.logger.info("Started Pangolin Newt")
        } catch {
            self.clearProcessState()
            if let pangolinError = error as? PangolinError {
                throw pangolinError
            }
            throw PangolinError.connectionFailed(error.localizedDescription)
        }
    }

    func stop() async {
        guard let process = newtProcess else {
            self.clearProcessState()
            return
        }

        self.isStopping = true
        process.terminate()

        for _ in 0..<20 where process.isRunning {
            try? await Task.sleep(for: .milliseconds(100))
        }

        self.clearProcessState()
        self.logger.info("Stopped Pangolin Newt")
    }

    /// Fast app-termination path. Newt handles SIGTERM and closes its tunnel.
    func sendTerminationSignal() {
        self.isStopping = true
        self.newtProcess?.terminate()
        self.clearProcessState()
    }

    func copyInstallCommand() {
        guard !Self.isTestMode else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(
            "curl -fsSL https://static.pangolin.net/get-newt.sh | bash",
            forType: .string)
    }

    func openSetupGuide() {
        guard !Self.isTestMode, let url = URL(string: URLConstants.pangolinDocs) else { return }
        NSWorkspace.shared.open(url)
    }

    func openDashboard() {
        guard !Self.isTestMode else { return }
        let endpoint = self.credentials?.endpoint ?? URLConstants.pangolinCloud
        guard let url = URL(string: endpoint) else { return }
        NSWorkspace.shared.open(url)
    }

    nonisolated static func normalizeCredentials(
        endpoint: String,
        siteID: String,
        secret: String)
        -> PangolinCredentials?
    {
        let endpoint = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let siteID = siteID.trimmingCharacters(in: .whitespacesAndNewlines)
        let secret = secret.trimmingCharacters(in: .whitespacesAndNewlines)

        guard let url = URL(string: endpoint),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host != nil,
              !siteID.isEmpty,
              !secret.isEmpty
        else {
            return nil
        }
        return PangolinCredentials(endpoint: endpoint, siteID: siteID, secret: secret)
    }

    nonisolated static func startArguments(configPath: String?) -> [String] {
        guard let configPath, !configPath.isEmpty else { return [] }
        return ["--config-file", configPath]
    }

    nonisolated static func createTemporaryConfig(credentials: PangolinCredentials) throws -> URL {
        let fileManager = FileManager.default
        let directory = fileManager.temporaryDirectory
            .appendingPathComponent("VibeTunnel", isDirectory: true)
            .appendingPathComponent("Pangolin", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fileManager.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)

        let configURL = directory.appendingPathComponent("config.json")
        let data = try JSONSerialization.data(withJSONObject: [
            "endpoint": credentials.endpoint,
            "id": credentials.siteID,
            "secret": credentials.secret,
            "tlsClientCert": "",
        ])
        guard fileManager.createFile(
            atPath: configURL.path,
            contents: data,
            attributes: [.posixPermissions: 0o600])
        else {
            throw CocoaError(.fileWriteUnknown)
        }
        return configURL
    }

    nonisolated static func connectionState(from output: String) -> Bool? {
        let connected = [
            "Tunnel connection to server established successfully!",
            "Connection to server restored after",
        ]
            .compactMap { output.range(of: $0, options: .backwards)?.lowerBound }
            .max()
        let disconnected = [
            "Failed to connect:",
            "Connection to server lost after",
        ]
            .compactMap { output.range(of: $0, options: .backwards)?.lowerBound }
            .max()

        switch (connected, disconnected) {
        case let (.some(connected), .some(disconnected)):
            return connected > disconnected
        case (.some, .none):
            return true
        case (.none, .some):
            return false
        case (.none, .none):
            return nil
        }
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

        self.outputBuffer.append(output)
        if self.outputBuffer.count > 32768 {
            self.outputBuffer = String(self.outputBuffer.suffix(32768))
        }

        guard let isConnected = Self.connectionState(from: self.outputBuffer) else { return }
        self.isConnected = isConnected
        self.statusError = isConnected
            ? nil
            : "Newt could not connect. Check the Pangolin endpoint and site credentials."
    }

    private func clearOutputHandlers() {
        for handle in self.outputHandles {
            handle.readabilityHandler = nil
        }
        self.outputHandles.removeAll()
    }

    private func clearTemporaryConfig() {
        if let configURL {
            try? FileManager.default.removeItem(at: configURL.deletingLastPathComponent())
        }
        self.configURL = nil
    }

    private func clearProcessState() {
        self.clearOutputHandlers()
        self.clearTemporaryConfig()
        self.newtProcess = nil
        self.isRunning = false
        self.isConnected = false
        self.statusError = nil
        self.outputBuffer = ""
        self.isStopping = false
    }
}

private enum PangolinKeychain {
    private static let service = KeychainConstants.vibeTunnelService
    private static let account = KeychainConstants.pangolinSiteCredentials

    static func getCredentials() -> PangolinCredentials? {
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
        return try? JSONDecoder().decode(PangolinCredentials.self, from: data)
    }

    @discardableResult
    static func setCredentials(_ credentials: PangolinCredentials) -> Bool {
        guard let data = try? JSONEncoder().encode(credentials) else { return false }

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

    static func deleteCredentials() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: self.service,
            kSecAttrAccount as String: self.account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
