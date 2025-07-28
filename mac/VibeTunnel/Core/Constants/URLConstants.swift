import Foundation

/// Centralized URL constants for the VibeTunnel application
enum URLConstants {
    // MARK: - Local Server URLs

    static let localhost = "http://localhost:"
    static let localhostIP = "http://127.0.0.1:"

    // MARK: - Main Website & Social

    static let website = "https://vibetunnel.sh"
    static let githubRepo = "https://github.com/amantus-ai/vibetunnel"
    static let githubIssues = "https://github.com/amantus-ai/vibetunnel/issues"
    static let twitter = "https://x.com/VibeTunnel"

    // MARK: - Contributors

    static let contributorMario = "https://mariozechner.at/"
    static let contributorArmin = "https://lucumr.pocoo.org/"
    static let contributorPeter = "https://steipete.me"

    // MARK: - Tailscale

    static let tailscaleWebsite = "https://tailscale.com/"
    static let tailscaleAppStore = "https://apps.apple.com/us/app/tailscale/id1475387142"
    static let tailscaleDownloadMac = "https://tailscale.com/download/macos"
    static let tailscaleInstallGuide = "https://tailscale.com/kb/1017/install/"
    static let tailscaleAPI = "http://100.100.100.100/api/data"

    // MARK: - Cloudflare

    static let cloudflareFormula = "https://formulae.brew.sh/formula/cloudflared"
    static let cloudflareReleases = "https://github.com/cloudflare/cloudflared/releases/latest"
    static let cloudflareDocs =
        "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"

    // MARK: - Update Feed

    static let updateFeedStable = "https://stats.store/api/v1/appcast/appcast.xml"
    static let updateFeedPrerelease = "https://stats.store/api/v1/appcast/appcast-prerelease.xml"

    // MARK: - Documentation

    static let claudeCodeArmyPost = "https://steipete.me/posts/command-your-claude-code-army-reloaded"

    // MARK: - Regular Expressions

    static let cloudflareURLPattern =
        #"https://[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.trycloudflare\.com/?(?:\s|$)"#

    // MARK: - Local Server Base

    static let localServerBase = "http://127.0.0.1"
}
