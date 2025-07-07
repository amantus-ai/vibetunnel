import Darwin.C
import Foundation
import OSLog

/// Information about a process that's using a port.
///
/// Contains detailed information about a process occupying a network port,
/// including identification details and helpers to determine if it's a VibeTunnel-related process.
struct ProcessDetails {
    let pid: Int
    let name: String
    let path: String?
    let parentPid: Int?
    let bundleIdentifier: String?

    /// Check if this is a VibeTunnel process
    var isVibeTunnel: Bool {
        if let bundleId = bundleIdentifier {
            return bundleId.contains("vibetunnel") || bundleId.contains("VibeTunnel")
        }
        if let path {
            return path.contains("VibeTunnel")
        }
        return name.contains("VibeTunnel")
    }

    /// Check if this is one of our managed servers
    var isManagedServer: Bool {
        // Direct vibetunnel binary
        if name == "vibetunnel" || name.contains("vibetunnel") {
            return true
        }
        // Node server with VibeTunnel in path
        if name.contains("node") && (path?.contains("VibeTunnel") ?? false) {
            return true
        }
        // Bun executable (our vibetunnel binary is a Bun executable)
        if name.contains("bun") && (path?.contains("VibeTunnel") ?? false) {
            return true
        }
        // Check if the path contains our bundle identifier
        if let path, path.contains("sh.vibetunnel") {
            return true
        }
        return false
    }
}

/// Information about a port conflict.
///
/// Encapsulates complete details about a port conflict including the blocking process,
/// suggested remediation actions, and alternative port options.
struct PortConflict {
    let port: Int
    let process: ProcessDetails
    let rootProcess: ProcessDetails?
    let suggestedAction: ConflictAction
    let alternativePorts: [Int]
}

/// Suggested action for resolving a port conflict.
///
/// Provides specific recommendations for how to handle different types of port conflicts,
/// from killing our own processes to suggesting user intervention.
enum ConflictAction {
    case killOurInstance(pid: Int, processName: String)
    case suggestAlternativePort
    case reportExternalApp(name: String)
}

/// Resolves port conflicts and suggests remediation.
///
/// Provides comprehensive port conflict detection and resolution capabilities,
/// including process identification, conflict analysis, and automated remediation
/// for VibeTunnel-owned processes. Uses system tools like lsof to detect port usage
/// and can automatically kill conflicting processes when appropriate.
@MainActor
final class PortConflictResolver {
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "PortConflictResolver")

    static let shared = PortConflictResolver()

    private init() {}

    /// Check if a port is available by attempting to bind to it
    func isPortAvailable(_ port: Int) async -> Bool {
        // First check if any process is using it
        if await detectConflict(on: port) != nil {
            return false
        }

        // Then try to actually bind to the port
        return await canBindToPort(port)
    }

    /// Attempt to bind to a port to verify it's truly available
    func canBindToPort(_ port: Int) async -> Bool {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let sock = socket(AF_INET, SOCK_STREAM, 0)
                guard sock >= 0 else {
                    self.logger.debug("Failed to create socket for port check")
                    continuation.resume(returning: false)
                    return
                }
                defer { close(sock) }

                // Enable SO_REUSEADDR to handle TIME_WAIT state
                var reuseAddr = 1
                if setsockopt(
                    sock,
                    SOL_SOCKET,
                    SO_REUSEADDR,
                    &reuseAddr,
                    socklen_t(MemoryLayout.size(ofValue: reuseAddr))
                ) < 0 {
                    self.logger.debug("Failed to set SO_REUSEADDR: \(errno)")
                }

                // Set SO_REUSEPORT for better compatibility
                var reusePort = 1
                if setsockopt(
                    sock,
                    SOL_SOCKET,
                    SO_REUSEPORT,
                    &reusePort,
                    socklen_t(MemoryLayout.size(ofValue: reusePort))
                ) < 0 {
                    self.logger.debug("Failed to set SO_REUSEPORT: \(errno)")
                }

                // Try to bind
                var addr = sockaddr_in()
                addr.sin_family = sa_family_t(AF_INET)
                addr.sin_port = in_port_t(port).bigEndian
                addr.sin_addr.s_addr = INADDR_ANY
                addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)

                let result = withUnsafePointer(to: &addr) { ptr in
                    ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                        bind(sock, sockPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
                    }
                }

                if result == 0 {
                    self.logger.debug("Port \(port) is available (bind succeeded)")
                    continuation.resume(returning: true)
                } else {
                    let error = errno
                    self.logger.debug("Port \(port) is not available (bind failed with errno \(error))")
                    continuation.resume(returning: false)
                }
            }
        }
    }

    /// Detect what process is using a port
    func detectConflict(on port: Int) async -> PortConflict? {
        do {
            // Use lsof to find process using the port
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
            process.arguments = ["-i", ":\(port)", "-n", "-P", "-F"]

            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = Pipe()

            // Run the process on a background queue to avoid blocking main thread
            let (exitCode, output) = try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.global(qos: .userInitiated).async {
                    do {
                        try process.run()
                        process.waitUntilExit()

                        let output: String
                        do {
                            if let data = try pipe.fileHandleForReading.readToEnd() {
                                output = String(data: data, encoding: .utf8) ?? ""
                            } else {
                                output = ""
                            }
                        } catch {
                            self.logger.debug("Could not read lsof output: \(error.localizedDescription)")
                            output = ""
                        }

                        continuation.resume(returning: (process.terminationStatus, output))
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }

            guard exitCode == 0, !output.isEmpty else {
                // Port is free
                return nil
            }

            // Parse lsof output
            if let processInfo = await parseLsofOutput(output) {
                // Get root process
                let rootProcess = await findRootProcess(for: processInfo)

                // Find alternative ports
                let alternatives = await findAvailablePorts(near: port, count: 3)

                // Determine action
                let action = determineAction(for: processInfo, rootProcess: rootProcess)

                return PortConflict(
                    port: port,
                    process: processInfo,
                    rootProcess: rootProcess,
                    suggestedAction: action,
                    alternativePorts: alternatives
                )
            }
        } catch {
            logger.error("Failed to check port conflict: \(error)")
        }

        return nil
    }

    /// Kill a process and optionally its parent VibeTunnel instance
    func resolveConflict(_ conflict: PortConflict) async throws {
        switch conflict.suggestedAction {
        case .killOurInstance(let pid, let processName):
            logger.info("Killing conflicting process: \(processName) (PID: \(pid))")

            // Kill the process
            let killProcess = Process()
            killProcess.executableURL = URL(fileURLWithPath: "/bin/kill")
            killProcess.arguments = ["-9", "\(pid)"]

            let exitCode = try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.global(qos: .userInitiated).async {
                    do {
                        try killProcess.run()
                        killProcess.waitUntilExit()
                        continuation.resume(returning: killProcess.terminationStatus)
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }

            if exitCode != 0 {
                throw PortConflictError.failedToKillProcess(pid: pid)
            }

            // Wait with exponential backoff for port to be released
            var retries = 0
            let maxRetries = 5

            while retries < maxRetries {
                try await Task.sleep(for: .milliseconds(500 * UInt64(pow(2.0, Double(retries)))))

                if await canBindToPort(conflict.port) {
                    logger.info("Port \(conflict.port) successfully released after \(retries + 1) retries")
                    break
                }

                retries += 1
                if retries < maxRetries {
                    logger.debug("Port \(conflict.port) still not available, retry \(retries + 1)/\(maxRetries)")
                }
            }

            if retries == maxRetries {
                throw PortConflictError.portStillInUse(port: conflict.port)
            }

        case .suggestAlternativePort, .reportExternalApp:
            // These require user action
            throw PortConflictError.requiresUserAction
        }
    }

    /// Force kill any process, regardless of type
    func forceKillProcess(_ conflict: PortConflict) async throws {
        logger.info("Force killing process: \(conflict.process.name) (PID: \(conflict.process.pid))")

        // Kill the process
        let killProcess = Process()
        killProcess.executableURL = URL(fileURLWithPath: "/bin/kill")
        killProcess.arguments = ["-9", "\(conflict.process.pid)"]

        let exitCode = try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    try killProcess.run()
                    killProcess.waitUntilExit()
                    continuation.resume(returning: killProcess.terminationStatus)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }

        if exitCode != 0 {
            // Try with sudo if regular kill fails
            logger.warning("Regular kill failed, attempting with elevated privileges")
            throw PortConflictError.failedToKillProcess(pid: conflict.process.pid)
        }

        // Wait with exponential backoff for port to be released
        var retries = 0
        let maxRetries = 5

        while retries < maxRetries {
            try await Task.sleep(for: .milliseconds(500 * UInt64(pow(2.0, Double(retries)))))

            if await canBindToPort(conflict.port) {
                logger.info("Port \(conflict.port) successfully released after \(retries + 1) retries")
                break
            }

            retries += 1
            if retries < maxRetries {
                logger.debug("Port \(conflict.port) still not available, retry \(retries + 1)/\(maxRetries)")
            }
        }

        if retries == maxRetries {
            throw PortConflictError.portStillInUse(port: conflict.port)
        }
    }

    /// Find available ports near a given port
    func findAvailablePorts(near port: Int, count: Int) async -> [Int] {
        var availablePorts: [Int] = []
        let range = max(1_024, port - 10)...(port + 100)

        for candidatePort in range where candidatePort != port {
            if await isPortAvailable(candidatePort) {
                availablePorts.append(candidatePort)
                if availablePorts.count >= count {
                    break
                }
            }
        }

        return availablePorts
    }

    // MARK: - Private Methods

    private func parseLsofOutput(_ output: String) async -> ProcessDetails? {
        var pid: Int?
        var name: String?
        var ppid: Int?

        // Parse lsof field output format
        let lines = output.components(separatedBy: "\n")
        for line in lines {
            if line.hasPrefix("p") {
                pid = Int(line.dropFirst())
            } else if line.hasPrefix("c") {
                name = String(line.dropFirst())
            } else if line.hasPrefix("R") {
                ppid = Int(line.dropFirst())
            }
        }

        guard let pid, let name else {
            return nil
        }

        // Get additional process info
        let path = await getProcessPath(pid: pid)
        let bundleId = await getProcessBundleIdentifier(pid: pid)

        return ProcessDetails(
            pid: pid,
            name: name,
            path: path,
            parentPid: ppid,
            bundleIdentifier: bundleId
        )
    }

    private func getProcessPath(pid: Int) async -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-p", "\(pid)", "-o", "comm="]

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()

        do {
            let output = try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.global(qos: .userInitiated).async {
                    do {
                        try process.run()
                        process.waitUntilExit()

                        let output: String
                        do {
                            if let data = try pipe.fileHandleForReading.readToEnd() {
                                output = String(data: data, encoding: .utf8) ?? ""
                            } else {
                                output = ""
                            }
                        } catch {
                            self.logger.debug("Could not read pipe output: \(error.localizedDescription)")
                            output = ""
                        }
                        continuation.resume(returning: output)
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }

            return output.trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            logger.debug("Failed to get process path: \(error)")
        }

        return nil
    }

    private func getProcessBundleIdentifier(pid: Int) async -> String? {
        // Try to get bundle identifier using lsappinfo
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/lsappinfo")
        process.arguments = ["info", "-only", "bundleid", "\(pid)"]

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()

        do {
            let output = try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.global(qos: .userInitiated).async {
                    do {
                        try process.run()
                        process.waitUntilExit()

                        let output: String
                        do {
                            if let data = try pipe.fileHandleForReading.readToEnd() {
                                output = String(data: data, encoding: .utf8) ?? ""
                            } else {
                                output = ""
                            }
                        } catch {
                            self.logger.debug("Could not read pipe output: \(error.localizedDescription)")
                            output = ""
                        }
                        continuation.resume(returning: output)
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }

            // Parse bundleid from output
            if let range = output.range(of: "\"", options: .backwards) {
                let beforeQuote = output[..<range.lowerBound]
                if let startRange = beforeQuote.range(of: "\"", options: .backwards) {
                    let bundleId = output[startRange.upperBound..<range.lowerBound]
                    return String(bundleId)
                }
            }
        } catch {
            logger.debug("Failed to get bundle identifier: \(error)")
        }

        return nil
    }

    private func findRootProcess(for process: ProcessDetails) async -> ProcessDetails? {
        var current = process
        var visited = Set<Int>()

        while let parentPid = current.parentPid, parentPid > 1, !visited.contains(parentPid) {
            visited.insert(current.pid)

            // Get parent process info
            if let parentInfo = await getProcessInfo(pid: parentPid) {
                // If parent is VibeTunnel, it's our root
                if parentInfo.isVibeTunnel {
                    return parentInfo
                }
                current = parentInfo
            } else {
                break
            }
        }

        return nil
    }

    private func getProcessInfo(pid: Int) async -> ProcessDetails? {
        // Get process info using ps
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-p", "\(pid)", "-o", "pid=,ppid=,comm="]

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()

        do {
            let output = try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.global(qos: .userInitiated).async {
                    do {
                        try process.run()
                        process.waitUntilExit()

                        let output: String
                        do {
                            if let data = try pipe.fileHandleForReading.readToEnd() {
                                output = String(data: data, encoding: .utf8) ?? ""
                            } else {
                                output = ""
                            }
                        } catch {
                            self.logger.debug("Could not read pipe output: \(error.localizedDescription)")
                            output = ""
                        }
                        continuation.resume(returning: output)
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }

            let components = output.trimmingCharacters(in: .whitespacesAndNewlines)
                .components(separatedBy: .whitespaces)
                .filter { !$0.isEmpty }

            if components.count >= 3 {
                let pid = Int(components[0]) ?? 0
                let ppid = Int(components[1]) ?? 0
                let name = components[2...].joined(separator: " ")
                let path = await getProcessPath(pid: pid)
                let bundleId = await getProcessBundleIdentifier(pid: pid)

                return ProcessDetails(
                    pid: pid,
                    name: name,
                    path: path,
                    parentPid: ppid > 0 ? ppid : nil,
                    bundleIdentifier: bundleId
                )
            }
        } catch {
            logger.debug("Failed to get process info: \(error)")
        }

        return nil
    }

    private func determineAction(for process: ProcessDetails, rootProcess: ProcessDetails?) -> ConflictAction {
        logger
            .debug(
                "Determining action for process: \(process.name) (PID: \(process.pid), Path: \(process.path ?? "unknown"))"
            )

        // If it's our managed server, kill it
        if process.isManagedServer {
            logger.info("Process identified as managed server: \(process.name)")
            return .killOurInstance(pid: process.pid, processName: process.name)
        }

        // If root process is VibeTunnel, kill the whole app
        if let root = rootProcess, root.isVibeTunnel {
            logger.info("Root process identified as VibeTunnel: \(root.name)")
            return .killOurInstance(pid: root.pid, processName: root.name)
        }

        // If the process itself is VibeTunnel
        if process.isVibeTunnel {
            logger.info("Process identified as VibeTunnel: \(process.name)")
            return .killOurInstance(pid: process.pid, processName: process.name)
        }

        // Special handling for Chrome Helper processes
        // Chrome sometimes leaves orphaned helper processes on our port
        if process.name.contains("Chrome Helper") || process.name.contains("Google Chrome Helper") {
            logger.info("Chrome Helper process detected on our port, marking for termination: \(process.name)")
            return .killOurInstance(pid: process.pid, processName: process.name)
        }

        // Otherwise, it's an external app
        logger.info("Process identified as external app: \(process.name)")
        return .reportExternalApp(name: process.name)
    }
}

// MARK: - Errors

/// Errors that can occur during port conflict resolution.
///
/// Represents various failure modes when attempting to resolve port conflicts,
/// from process termination failures to ports remaining occupied.
enum PortConflictError: LocalizedError {
    case failedToKillProcess(pid: Int)
    case requiresUserAction
    case portStillInUse(port: Int)

    var errorDescription: String? {
        switch self {
        case .failedToKillProcess(let pid):
            "Failed to terminate process with PID \(pid)"
        case .requiresUserAction:
            "This conflict requires user action to resolve"
        case .portStillInUse(let port):
            "Port \(port) is still in use after multiple attempts to free it"
        }
    }
}
