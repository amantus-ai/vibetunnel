import Foundation

/// Centralized file path constants
enum FilePathConstants {
    // MARK: - System Paths

    static let usrBin = "/usr/bin"
    static let bin = "/bin"
    static let usrLocalBin = "/usr/local/bin"
    static let optHomebrewBin = "/opt/homebrew/bin"

    // MARK: - Command Paths

    static let which = "/usr/bin/which"
    static let git = "/usr/bin/git"
    static let homebrewGit = "/opt/homebrew/bin/git"
    static let localGit = "/usr/local/bin/git"

    // MARK: - Shell Paths

    static let defaultShell = "/bin/zsh"
    static let bash = "/bin/bash"
    static let zsh = "/bin/zsh"
    static let sh = "/bin/sh"

    // MARK: - Application Paths

    static let applicationsVibeTunnel = "/Applications/VibeTunnel.app"
    static let userApplicationsVibeTunnel = "$HOME/Applications/VibeTunnel.app"

    // MARK: - Temporary Directory

    static let tmpDirectory = "/tmp/"

    // MARK: - Default Paths
    
    static let defaultRepositoryBasePath = "~/Documents"

    // MARK: - Common Repository Base Paths

    static let projectsPath = "~/Projects"
    static let documentsCodePath = "~/Documents/Code"
    static let developmentPath = "~/Development"
    static let sourcePath = "~/Source"
    static let workPath = "~/Work"
    static let codePath = "~/Code"
    static let sitesPath = "~/Sites"
    static let desktopPath = "~/Desktop"
    static let documentsPath = "~/Documents"
    static let downloadsPath = "~/Downloads"
    static let homePath = "~/"

    // MARK: - Resource Names

    static let vibetunnelBinary = "vibetunnel"
    static let vtCLI = "vt"

    // MARK: - Configuration Files

    static let infoPlist = "Info.plist"
    static let entitlements = "VibeTunnel.entitlements"

    // MARK: - Helper Functions

    static func expandTilde(_ path: String) -> String {
        path.replacingOccurrences(of: "~", with: NSHomeDirectory())
    }
}
