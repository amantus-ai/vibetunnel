import Foundation

/// Centralized bundle identifiers for external applications
enum BundleIdentifiers {
    // MARK: - VibeTunnel

    static let main = "sh.vibetunnel.vibetunnel"
    static let vibeTunnel = "sh.vibetunnel.vibetunnel"

    // MARK: - Terminal Applications

    static let terminal = "com.apple.Terminal"
    static let iTerm2 = "com.googlecode.iterm2"
    static let ghostty = "com.mitchellh.ghostty"
    static let wezterm = "com.github.wez.wezterm"
    static let warp = "dev.warp.Warp-Stable"
    static let alacritty = "org.alacritty"
    static let hyper = "co.zeit.hyper"
    static let kitty = "net.kovidgoyal.kitty"

    enum Terminal {
        static let apple = "com.apple.Terminal"
        static let iTerm2 = "com.googlecode.iterm2"
        static let ghostty = "com.mitchellh.ghostty"
        static let wezTerm = "com.github.wez.wezterm"
    }

    // MARK: - Git Applications

    static let cursor = "com.todesktop.230313mzl4w4u92"
    static let fork = "com.DanPristupov.Fork"
    static let githubDesktop = "com.github.GitHubClient"
    static let gitup = "co.gitup.mac"
    static let juxtaCode = "com.naiveapps.juxtacode"
    static let sourcetree = "com.torusknot.SourceTreeNotMAS"
    static let sublimeMerge = "com.sublimemerge"
    static let tower = "com.fournova.Tower3"
    static let vscode = "com.microsoft.VSCode"
    static let windsurf = "com.codeiumapp.windsurf"

    enum Git {
        static let githubDesktop = "com.todesktop.230313mzl4w4u92"
        static let fork = "com.DanPristupov.Fork"
        static let githubClient = "com.github.GitHubClient"
        static let juxtaCode = "com.naiveapps.juxtacode"
        static let sourceTree = "com.torusknot.SourceTreeNotMAS"
        static let sublimeMerge = "com.sublimemerge"
        static let tower = "com.fournova.Tower3"
    }

    // MARK: - Code Editors

    enum Editor {
        static let vsCode = "com.microsoft.VSCode"
        static let windsurf = "com.codeiumapp.windsurf"
    }
}
