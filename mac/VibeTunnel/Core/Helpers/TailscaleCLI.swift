import Darwin
import Foundation

enum TailscaleCLI {
    struct Status: Equatable {
        let isRunning: Bool
        let hostname: String?
        let ipv4: String?
    }

    static var searchPaths: [String] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return [
            "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
            "/run/current-system/sw/bin/tailscale",
            "/etc/profiles/per-user/\(NSUserName())/bin/tailscale",
            "\(home)/.nix-profile/bin/tailscale",
            "/opt/homebrew/bin/tailscale",
            "/usr/local/bin/tailscale",
            "/usr/bin/tailscale",
        ]
    }

    static func findExecutable(
        searchPaths: [String]? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default)
        -> String?
    {
        let configuredPaths = searchPaths ?? Self.searchPaths
        let pathCandidates = (environment[EnvironmentKeys.path] ?? "")
            .split(separator: ":")
            .map { "\($0)/tailscale" }

        var seen = Set<String>()
        return (configuredPaths + pathCandidates).first { path in
            seen.insert(path).inserted && fileManager.isExecutableFile(atPath: path)
        }
    }

    static func parseStatus(_ data: Data) throws -> Status {
        let response = try JSONDecoder().decode(StatusResponse.self, from: data)
        let trimmedHostname = response.selfNode?.dnsName?
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
        let hostname = trimmedHostname?.isEmpty == false ? trimmedHostname : nil
        let addresses = if let topLevelAddresses = response.tailscaleIPs, !topLevelAddresses.isEmpty {
            topLevelAddresses
        } else {
            response.selfNode?.tailscaleIPs ?? []
        }

        return Status(
            isRunning: response.backendState.caseInsensitiveCompare("running") == .orderedSame,
            hostname: hostname,
            ipv4: addresses.first(where: Self.isIPv4Address))
    }

    static func fetchStatus(executablePath: String, timeout: Duration = .seconds(5)) async -> Status? {
        await Task.detached(priority: .utility) {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: executablePath)
            process.arguments = ["status", "--json"]

            let outputPipe = Pipe()
            process.standardOutput = outputPipe
            process.standardError = Pipe()

            do {
                try process.run()
                let timeoutWorkItem = DispatchWorkItem {
                    guard process.isRunning else { return }
                    process.terminate()
                    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.25) {
                        if process.isRunning {
                            kill(process.processIdentifier, SIGKILL)
                        }
                    }
                }
                let timeoutComponents = timeout.components
                let timeoutSeconds = max(
                    0,
                    Double(timeoutComponents.seconds) + Double(timeoutComponents.attoseconds) / 1e18)
                DispatchQueue.global(qos: .utility).asyncAfter(
                    deadline: .now() + timeoutSeconds,
                    execute: timeoutWorkItem)
                defer { timeoutWorkItem.cancel() }

                let data = outputPipe.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                guard process.terminationStatus == 0 else { return nil }
                return try Self.parseStatus(data)
            } catch {
                return nil
            }
        }.value
    }

    private static func isIPv4Address(_ value: String) -> Bool {
        let components = value.split(separator: ".", omittingEmptySubsequences: false)
        return components.count == 4 && components.allSatisfy { component in
            guard let number = Int(component) else { return false }
            return (0...255).contains(number)
        }
    }

    private struct StatusResponse: Decodable {
        let backendState: String
        let tailscaleIPs: [String]?
        let selfNode: SelfNode?

        enum CodingKeys: String, CodingKey {
            case backendState = "BackendState"
            case tailscaleIPs = "TailscaleIPs"
            case selfNode = "Self"
        }
    }

    private struct SelfNode: Decodable {
        let dnsName: String?
        let tailscaleIPs: [String]?

        enum CodingKeys: String, CodingKey {
            case dnsName = "DNSName"
            case tailscaleIPs = "TailscaleIPs"
        }
    }
}
