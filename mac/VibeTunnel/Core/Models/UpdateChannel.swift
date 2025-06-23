import Foundation

/// Represents the available update channels for the application.
///
/// This enum defines the different update channels that users can choose from,
/// allowing them to receive either stable releases only or include pre-release versions.
public enum UpdateChannel: String, CaseIterable, Codable, Sendable {
    case stable
    case prerelease

    /// Human-readable display name for the update channel
    public var displayName: String {
        switch self {
        case .stable:
            "Stable Only"
        case .prerelease:
            "Include Pre-releases"
        }
    }

    /// Detailed description of what each channel includes
    public var description: String {
        switch self {
        case .stable:
            "Receive only stable, production-ready releases"
        case .prerelease:
            "Receive both stable releases and pre-release versions."
        }
    }

    /// The Sparkle appcast URL for this update channel
    public var appcastURL: URL {
        switch self {
        case .stable:
            Self.stableAppcastURL
        case .prerelease:
            Self.prereleaseAppcastURL
        }
    }

    /// Static URLs to ensure they're validated at compile time
    private static let stableAppcastURL: URL = {
        guard let url =
            URL(string: "https://stats.store/api/v1/appcast/appcast.xml")
        else {
            fatalError("Invalid stable appcast URL - this should never happen with a hardcoded URL")
        }
        return url
    }()

    private static let prereleaseAppcastURL: URL = {
        guard let url =
            URL(
                string: "https://stats.store/api/v1/appcast/appcast-prerelease.xml"
            )
        else {
            fatalError("Invalid prerelease appcast URL - this should never happen with a hardcoded URL")
        }
        return url
    }()

    /// Whether this channel includes pre-release versions
    public var includesPreReleases: Bool {
        switch self {
        case .stable:
            false
        case .prerelease:
            true
        }
    }

    /// The current update channel based on user defaults
    public static var current: Self {
        if let rawValue = UserDefaults.standard.string(forKey: "updateChannel"),
           let channel = Self(rawValue: rawValue)
        {
            return channel
        }
        return defaultChannel
    }

    /// The default update channel based on the current app version
    public static var defaultChannel: Self {
        defaultChannel(for: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
    }

    /// Determines if the current app version suggests this channel should be default
    public static func defaultChannel(for appVersion: String) -> Self {
        // First check if this build was marked as a pre-release during build time
        if let isPrereleaseValue = Bundle.main.object(forInfoDictionaryKey: "IS_PRERELEASE_BUILD"),
           let isPrerelease = isPrereleaseValue as? Bool,
           isPrerelease
        {
            return .prerelease
        }

        // Otherwise, check if the version string contains pre-release keywords
        let prereleaseKeywords = ["beta", "alpha", "rc", "pre", "dev"]
        let lowercaseVersion = appVersion.lowercased()

        for keyword in prereleaseKeywords where lowercaseVersion.contains(keyword) {
            return .prerelease
        }

        return .stable
    }
}

// MARK: - Identifiable Conformance

extension UpdateChannel: Identifiable {
    public var id: String { rawValue }
}

// MARK: - UserDefaults Integration

extension UserDefaults {
    /// KVO-compatible property for update channel
    @objc dynamic var updateChannel: String? {
        get { string(forKey: "updateChannel") }
        set { set(newValue, forKey: "updateChannel") }
    }
}
