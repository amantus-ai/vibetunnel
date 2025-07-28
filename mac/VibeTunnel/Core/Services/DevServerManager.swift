import Foundation
import OSLog

/// Manages development server configuration and validation
@MainActor
final class DevServerManager: ObservableObject {
    static let shared = DevServerManager()

    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "DevServerManager")

    /// Validates a development server path
    func validate(path: String) -> DevServerValidation {
        guard !path.isEmpty else {
            return .notValidated
        }

        // Expand tilde in path
        let expandedPath = NSString(string: path).expandingTildeInPath
        let projectURL = URL(fileURLWithPath: expandedPath)

        // Check if directory exists
        guard FileManager.default.fileExists(atPath: expandedPath) else {
            return .invalid("Directory does not exist")
        }

        // Check if package.json exists
        let packageJsonPath = projectURL.appendingPathComponent("package.json").path
        guard FileManager.default.fileExists(atPath: packageJsonPath) else {
            return .invalid("No package.json found in directory")
        }

        // Check if pnpm is installed
        guard isPnpmInstalled() else {
            return .invalid("pnpm is not installed. Install it with: npm install -g pnpm")
        }

        // Check if dev script exists
        guard hasDevScript(at: packageJsonPath) else {
            return .invalid("No 'dev' script found in package.json")
        }

        logger.info("Dev server path validated successfully: \(expandedPath)")
        return .valid
    }

    /// Checks if pnpm is installed on the system
    private func isPnpmInstalled() -> Bool {
        // Common locations where pnpm might be installed
        let commonPaths = [
            "/usr/local/bin/pnpm",
            "/opt/homebrew/bin/pnpm",
            "/usr/bin/pnpm",
            NSString("~/Library/pnpm/pnpm").expandingTildeInPath,
            NSString("~/.local/share/pnpm/pnpm").expandingTildeInPath,
            NSString("~/Library/Caches/fnm_multishells/*/bin/pnpm").expandingTildeInPath
        ]

        // Check common paths first
        for path in commonPaths where FileManager.default.isExecutableFile(atPath: path) {
            logger.debug("Found pnpm at: \(path)")
            return true
        }

        // Try using the shell to find pnpm with full PATH
        let pnpmCheck = Process()
        pnpmCheck.executableURL = URL(fileURLWithPath: "/bin/zsh")
        pnpmCheck.arguments = ["-l", "-c", "command -v pnpm"]
        pnpmCheck.standardOutput = Pipe()
        pnpmCheck.standardError = Pipe()

        // Set up environment with common PATH additions
        var environment = ProcessInfo.processInfo.environment
        let homePath = NSHomeDirectory()
        let additionalPaths = [
            "\(homePath)/Library/pnpm",
            "\(homePath)/.local/share/pnpm",
            "/usr/local/bin",
            "/opt/homebrew/bin"
        ].joined(separator: ":")

        if let existingPath = environment["PATH"] {
            environment["PATH"] = "\(existingPath):\(additionalPaths)"
        } else {
            environment["PATH"] = additionalPaths
        }
        pnpmCheck.environment = environment

        do {
            try pnpmCheck.run()
            pnpmCheck.waitUntilExit()

            if pnpmCheck.terminationStatus == 0 {
                // Try to read the output to log where pnpm was found
                if let pipe = pnpmCheck.standardOutput as? Pipe {
                    let data = pipe.fileHandleForReading.readDataToEndOfFile()
                    if let output = String(data: data, encoding: .utf8)?
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    {
                        logger.debug("Found pnpm via shell at: \(output)")
                    }
                }
                return true
            }
        } catch {
            logger.error("Failed to check for pnpm: \(error.localizedDescription)")
        }

        return false
    }

    /// Checks if package.json has a dev script
    private func hasDevScript(at packageJsonPath: String) -> Bool {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: packageJsonPath)),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let scripts = json["scripts"] as? [String: String]
        else {
            return false
        }

        return scripts["dev"] != nil
    }

    /// Gets the expanded path for a given path string
    func expandedPath(for path: String) -> String {
        NSString(string: path).expandingTildeInPath
    }

    /// Finds the path to pnpm executable
    func findPnpmPath() -> String? {
        // Common locations where pnpm might be installed
        let commonPaths = [
            "/usr/local/bin/pnpm",
            "/opt/homebrew/bin/pnpm",
            "/usr/bin/pnpm",
            NSString("~/Library/pnpm/pnpm").expandingTildeInPath,
            NSString("~/.local/share/pnpm/pnpm").expandingTildeInPath
        ]

        // Check common paths first
        for path in commonPaths where FileManager.default.isExecutableFile(atPath: path) {
            return path
        }

        // Try to find via shell
        let findPnpm = Process()
        findPnpm.executableURL = URL(fileURLWithPath: "/bin/zsh")
        findPnpm.arguments = ["-l", "-c", "command -v pnpm"]
        findPnpm.standardOutput = Pipe()
        findPnpm.standardError = Pipe()

        // Set up environment with common PATH additions
        var environment = ProcessInfo.processInfo.environment
        let homePath = NSHomeDirectory()
        let additionalPaths = [
            "\(homePath)/Library/pnpm",
            "\(homePath)/.local/share/pnpm",
            "/usr/local/bin",
            "/opt/homebrew/bin"
        ].joined(separator: ":")

        if let existingPath = environment["PATH"] {
            environment["PATH"] = "\(existingPath):\(additionalPaths)"
        } else {
            environment["PATH"] = additionalPaths
        }
        findPnpm.environment = environment

        do {
            try findPnpm.run()
            findPnpm.waitUntilExit()

            if findPnpm.terminationStatus == 0,
               let pipe = findPnpm.standardOutput as? Pipe
            {
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                if let output = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !output.isEmpty
                {
                    return output
                }
            }
        } catch {
            logger.error("Failed to find pnpm path: \(error.localizedDescription)")
        }

        return nil
    }

    /// Builds the command arguments for running the dev server
    func buildDevServerArguments(port: String, bindAddress: String, authMode: String, localToken: String?) -> [String] {
        var args = ["run", "dev", "--"]

        // Add the same arguments as the production server
        args.append(contentsOf: ["--port", port, "--bind", bindAddress])

        // Add authentication flags based on configuration
        switch authMode {
        case "none":
            args.append("--no-auth")
        case "ssh":
            args.append(contentsOf: ["--enable-ssh-keys", "--disallow-user-password"])
        case "both":
            args.append("--enable-ssh-keys")
        default:
            // OS authentication is the default
            break
        }

        // Add local bypass authentication for the Mac app
        if authMode != "none", let token = localToken {
            args.append(contentsOf: ["--allow-local-bypass", "--local-auth-token", token])
        }

        // Add Tailscale Serve integration if enabled
        let tailscaleServeEnabled = UserDefaults.standard
            .bool(forKey: AppConstants.UserDefaultsKeys.tailscaleServeEnabled)
        if tailscaleServeEnabled {
            args.append("--enable-tailscale-serve")
            logger.info("Tailscale Serve integration enabled")
        }

        return args
    }
}
