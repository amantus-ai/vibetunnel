import Foundation

/// Represents the available tabs in the Settings window.
///
/// Each tab corresponds to a different configuration area of VibeTunnel,
/// with associated display names and SF Symbol icons for the tab bar.
enum SettingsTab: String, CaseIterable {
    case general
    case notifications
    case quickStart
    case dashboard
    case remoteAccess
    case advanced
    case debug
    case about

    var displayName: String {
        switch self {
        case .general: "General"
        case .notifications: "Notifications"
        case .quickStart: "Quick Start"
        case .dashboard: "Dashboard"
        case .remoteAccess: "Remote"
        case .advanced: "Advanced"
        case .debug: "Debug"
        case .about: "About"
        }
    }

    var icon: String {
        switch self {
        case .general: "gear"
        case .notifications: "bell.badge"
        case .quickStart: "bolt.fill"
        case .dashboard: "server.rack"
        case .remoteAccess: "network"
        case .advanced: "gearshape.2"
        case .debug: "hammer"
        case .about: "info.circle"
        }
    }
}

extension Notification.Name {
    static let openSettingsTab = Notification.Name("openSettingsTab")
}
