import Foundation

/// Definition for a single quick key
/// Mirrors web's QUICK_KEY_DEFINITIONS from quick-keys-preferences.ts
struct QuickKeyDefinition: Identifiable, Equatable, Hashable {
    var id: String { key }
    let key: String // "Escape", "Ctrl+C", etc.
    let label: String // "Esc", "^C", etc.
    let isModifier: Bool // Control, Option, Command
    let isArrow: Bool // Arrow keys (support key repeat)
    let isCombo: Bool // Ctrl+C, Ctrl+Z, etc.
    let isToggle: Bool // F, CtrlExpand (toggle expansion views)

    init(
        key: String,
        label: String,
        isModifier: Bool = false,
        isArrow: Bool = false,
        isCombo: Bool = false,
        isToggle: Bool = false)
    {
        self.key = key
        self.label = label
        self.isModifier = isModifier
        self.isArrow = isArrow
        self.isCombo = isCombo
        self.isToggle = isToggle
    }
}

/// Preset layout definition
struct QuickKeysPreset: Identifiable {
    let id: String
    let name: String
    let layout: [[String]]
}

/// Static data - all available keys and presets
/// Mirrors web implementation in quick-keys-preferences.ts
enum QuickKeysData {
    /// All 47 available quick keys
    static let allKeys: [QuickKeyDefinition] = [
        // Row 1 (12 keys)
        QuickKeyDefinition(key: "Escape", label: "Esc"),
        QuickKeyDefinition(key: "Control", label: "Ctrl", isModifier: true),
        QuickKeyDefinition(key: "CtrlExpand", label: "\u{2303}", isToggle: true),
        QuickKeyDefinition(key: "F", label: "F", isToggle: true),
        QuickKeyDefinition(key: "Tab", label: "Tab"),
        QuickKeyDefinition(key: "shift_tab", label: "S-Tab"),
        QuickKeyDefinition(key: "ArrowUp", label: "\u{2191}", isArrow: true),
        QuickKeyDefinition(key: "ArrowDown", label: "\u{2193}", isArrow: true),
        QuickKeyDefinition(key: "ArrowLeft", label: "\u{2190}", isArrow: true),
        QuickKeyDefinition(key: "ArrowRight", label: "\u{2192}", isArrow: true),
        QuickKeyDefinition(key: "PageUp", label: "PgUp"),
        QuickKeyDefinition(key: "PageDown", label: "PgDn"),
        // Row 2 (10 keys)
        QuickKeyDefinition(key: "Home", label: "Home"),
        QuickKeyDefinition(key: "Paste", label: "Paste"),
        QuickKeyDefinition(key: "End", label: "End"),
        QuickKeyDefinition(key: "Delete", label: "Del"),
        QuickKeyDefinition(key: "`", label: "`"),
        QuickKeyDefinition(key: "~", label: "~"),
        QuickKeyDefinition(key: "|", label: "|"),
        QuickKeyDefinition(key: "/", label: "/"),
        QuickKeyDefinition(key: "\\", label: "\\"),
        QuickKeyDefinition(key: "-", label: "-"),
        // Row 3 (25 keys)
        QuickKeyDefinition(key: "Option", label: "\u{2325}", isModifier: true),
        QuickKeyDefinition(key: "Command", label: "\u{2318}", isModifier: true),
        QuickKeyDefinition(key: "Ctrl+C", label: "^C", isCombo: true),
        QuickKeyDefinition(key: "Ctrl+Z", label: "^Z", isCombo: true),
        QuickKeyDefinition(key: "Ctrl+W", label: "^W", isCombo: true),
        QuickKeyDefinition(key: "Ctrl+U", label: "^U", isCombo: true),
        QuickKeyDefinition(key: "Ctrl+D", label: "^D", isCombo: true),
        QuickKeyDefinition(key: "Ctrl+L", label: "^L", isCombo: true),
        QuickKeyDefinition(key: "Ctrl+O", label: "^O", isCombo: true),
        QuickKeyDefinition(key: "Ctrl+E", label: "^E", isCombo: true),
        QuickKeyDefinition(key: "Ctrl+X", label: "^X", isCombo: true),
        QuickKeyDefinition(key: "Ctrl+P", label: "^P", isCombo: true),
        QuickKeyDefinition(key: "Ctrl+K", label: "^K", isCombo: true),
        QuickKeyDefinition(key: "'", label: "'"),
        QuickKeyDefinition(key: "\"", label: "\""),
        QuickKeyDefinition(key: "{", label: "{"),
        QuickKeyDefinition(key: "}", label: "}"),
        QuickKeyDefinition(key: "[", label: "["),
        QuickKeyDefinition(key: "]", label: "]"),
        QuickKeyDefinition(key: "(", label: "("),
        QuickKeyDefinition(key: ")", label: ")"),
    ]

    /// Default layout matching web implementation
    static let defaultLayout: [[String]] = [
        [
            "Escape", "Control", "CtrlExpand", "F", "Tab", "shift_tab",
            "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown",
        ],
        ["Home", "Paste", "End", "Delete", "`", "~", "|", "/", "\\", "-"],
        ["Option", "Command", "Ctrl+C", "Ctrl+Z", "'", "\"", "{", "}", "[", "]", "(", ")"],
    ]

    /// Available presets
    static let presets: [QuickKeysPreset] = [
        QuickKeysPreset(
            id: "claude",
            name: "Claude Code",
            layout: [
                ["Escape", "Ctrl+C", "Ctrl+W", "Ctrl+U", "Ctrl+O", "Ctrl+E", "shift_tab"],
                ["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Delete"],
                ["Home", "End", "PageUp", "PageDown", "Paste", "/"],
            ]),
        QuickKeysPreset(
            id: "opencode",
            name: "Open Code",
            layout: [
                ["Escape", "Control", "Ctrl+X", "Ctrl+P", "Tab", "Ctrl+C", "/"],
                ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"],
                ["Ctrl+W", "Ctrl+U", "Ctrl+K", "Delete", "Paste", "Home", "End"],
            ]),
    ]

    /// Map from key ID to definition for quick lookups
    private static let keyMap: [String: QuickKeyDefinition] = {
        Dictionary(uniqueKeysWithValues: allKeys.map { ($0.key, $0) })
    }()

    /// Lookup key definition by ID
    static func definition(for key: String) -> QuickKeyDefinition? {
        keyMap[key]
    }
}
