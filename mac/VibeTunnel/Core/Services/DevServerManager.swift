import Foundation
import OSLog

/// Manages development server configuration and validation
@MainActor
final class DevServerManager: ObservableObject {
    static let shared = DevServerManager()

    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "DevServerManager")

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
        let pnpmCheck = Process()
        pnpmCheck.executableURL = URL(fileURLWithPath: "/bin/zsh")
        pnpmCheck.arguments = ["-l", "-c", "which pnpm"]
        pnpmCheck.standardOutput = Pipe()
        pnpmCheck.standardError = Pipe()

        do {
            try pnpmCheck.run()
            pnpmCheck.waitUntilExit()
            return pnpmCheck.terminationStatus == 0
        } catch {
            logger.error("Failed to check for pnpm: \(error.localizedDescription)")
            return false
        }
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

        return args
    }
}
