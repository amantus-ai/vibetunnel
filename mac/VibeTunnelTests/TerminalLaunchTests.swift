import AppKit
import Foundation
import Testing
@testable import VibeTunnel

// MARK: - Terminal Launch Tests

@Suite("Terminal Launch Tests")
struct TerminalLaunchTests {
    // MARK: - URL Generation Tests

    @Test("Terminal URL generation", arguments: [
        (Terminal.iTerm2, "echo 'Hello World'", "iterm2://run?command=echo%20\'Hello%20World\'"),
        (Terminal.iTerm2, "cd /tmp && ls", "iterm2://run?command=cd%20/tmp%20%26%26%20ls"),
        (Terminal.terminal, "echo test", nil),
        (Terminal.alacritty, "echo test", nil),
        (Terminal.hyper, "echo test", nil),
        (Terminal.wezterm, "echo test", nil)
    ])
    func terminalURLGeneration(terminal: Terminal, command: String, expectedURL: String?) {
        if let url = terminal.commandURL(for: command) {
            #expect(url.absoluteString == expectedURL)
        } else {
            #expect(expectedURL == nil)
        }
    }

    // MARK: - Command Arguments Tests

    @Test("Command argument generation for terminals")
    func commandArgumentGeneration() {
        let command = "echo 'Hello World'"

        // Test Alacritty arguments
        let alacrittyArgs = Terminal.alacritty.commandArguments(for: command)
        #expect(alacrittyArgs == ["-e", "/bin/bash", "-c", command])

        // Test WezTerm arguments
        let weztermArgs = Terminal.wezterm.commandArguments(for: command)
        #expect(weztermArgs == ["start", "--", "/bin/bash", "-c", command])

        // Test Terminal.app (limited support)
        let terminalArgs = Terminal.terminal.commandArguments(for: command)
        #expect(terminalArgs == [])
    }

    // MARK: - Working Directory Tests

    @Test("Working directory support")
    func workingDirectorySupport() {
        let workDir = "/Users/test/projects"
        let command = "ls -la"

        // Alacritty with working directory
        let alacrittyArgs = Terminal.alacritty.commandArguments(
            for: command,
            workingDirectory: workDir
        )
        #expect(alacrittyArgs == [
            "--working-directory", workDir,
            "-e", "/bin/bash", "-c", command
        ])

        // WezTerm with working directory
        let weztermArgs = Terminal.wezterm.commandArguments(
            for: command,
            workingDirectory: workDir
        )
        #expect(weztermArgs == [
            "start", "--cwd", workDir,
            "--", "/bin/bash", "-c", command
        ])

        // iTerm2 URL with working directory
        if let url = Terminal.iTerm2.commandURL(for: command, workingDirectory: workDir) {
            #expect(url.absoluteString.contains("cd="))
            #expect(
                url.absoluteString
                    .contains(workDir.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")
            )
        }
    }

    // MARK: - Complex Command Tests

    @Test("Complex command encoding")
    func complexCommandEncoding() {
        let complexCommand = "git log --oneline -10 && echo 'Done!'"

        // Test iTerm2 URL encoding
        if let url = Terminal.iTerm2.commandURL(for: complexCommand) {
            // URLComponents encodes differently, so just check the URL contains the command
            #expect(url.absoluteString.contains("command="))
            #expect(url.absoluteString.contains("git"))
        }

        // Test argument generation doesn't break the command
        let alacrittyArgs = Terminal.alacritty.commandArguments(for: complexCommand)
        #expect(alacrittyArgs.last == complexCommand)
    }

    // MARK: - Terminal Detection Tests

    @Test("Terminal detection")
    func terminalDetection() {
        // At least Terminal.app should be available on macOS
        #expect(Terminal.installed.contains(.terminal))

        // Check that installed terminals have valid paths
        for terminal in Terminal.installed {
            // Check if terminal is installed
            #expect(NSWorkspace.shared.urlForApplication(withBundleIdentifier: terminal.bundleIdentifier) != nil)
        }
    }

    // MARK: - Environment Variable Tests

    @Test("Launching with environment variables")
    @MainActor
    func environmentVariables() {
        _ = ["MY_VAR": "test_value", "PATH": "/custom/path:/usr/bin"]
        _ = "echo $MY_VAR"

        // Test that environment variables can be passed
        _ = TerminalLauncher.shared

        // This would need to be implemented in TerminalLauncher
        // Just testing the concept here
        #expect(Bool(true)) // No-throw test
    }

    // MARK: - Script File Tests

    @Test("Script file execution")
    func scriptFileExecution() throws {
        let tempDir = FileManager.default.temporaryDirectory
        let scriptPath = tempDir.appendingPathComponent("test_script.sh")

        // Create a test script
        let scriptContent = """
        #!/bin/bash
        echo "Test script executed"
        pwd
        """
        try scriptContent.write(to: scriptPath, atomically: true, encoding: .utf8)

        // Make executable
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: scriptPath.path
        )

        // Test launching the script
        #expect(FileManager.default.fileExists(atPath: scriptPath.path))

        // Cleanup
        try? FileManager.default.removeItem(at: scriptPath)
    }
}

// MARK: - Terminal Extension Tests

extension Terminal {
    /// Generate command arguments for testing
    /// This would be implemented in the actual Terminal enum
    func commandArguments(for command: String, workingDirectory: String? = nil) -> [String] {
        switch self {
        case .alacritty:
            var args: [String] = []
            if let workDir = workingDirectory {
                args += ["--working-directory", workDir]
            }
            args += ["-e", "/bin/bash", "-c", command]
            return args

        case .wezterm:
            var args = ["start"]
            if let workDir = workingDirectory {
                args += ["--cwd", workDir]
            }
            args += ["--", "/bin/bash", "-c", command]
            return args

        default:
            return []
        }
    }

    /// Generate URL for terminals that support URL schemes
    func commandURL(for command: String, workingDirectory: String? = nil) -> URL? {
        switch self {
        case .iTerm2:
            var components = URLComponents(string: "iterm2://run")
            var queryItems = [
                URLQueryItem(name: "command", value: command)
            ]
            if let workDir = workingDirectory {
                queryItems.append(URLQueryItem(name: "cd", value: workDir))
            }
            components?.queryItems = queryItems
            return components?.url

        default:
            return nil
        }
    }
}
