# Mac App Quick Keys Settings - Implementation Plan

## Overview

Add a new SwiftUI settings tab to the Mac app that allows users to customize the Quick Keys layout (the touch-friendly shortcuts shown above the mobile keyboard). This mirrors the functionality added to the web UI in this branch.

## Key Decisions

| Decision | Choice |
|----------|--------|
| Tab placement | After "Quick Start", before "Dashboard" |
| Save behavior | Auto-save on every drag operation (like web) |
| Styling | Native macOS styling |
| Persistence | API calls to server (`PUT /api/config/quick-keys-layout`) |

## Data Structures

### From Web Implementation (`web/src/client/utils/quick-keys-preferences.ts`)

**Key Definitions (47 total):**
```typescript
// Row 1 (12 keys)
Escape, Control, CtrlExpand, F, Tab, shift_tab, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, PageUp, PageDown

// Row 2 (10 keys)  
Home, Paste, End, Delete, `, ~, |, /, \, -

// Row 3 (25 keys)
Option, Command, Ctrl+C, Ctrl+Z, Ctrl+W, Ctrl+U, Ctrl+D, Ctrl+L, Ctrl+O, Ctrl+E, Ctrl+X, Ctrl+P, Ctrl+K, ', ", {, }, [, ], (, )
```

**Default Layout:**
```
Row 1: Escape, Control, CtrlExpand, F, Tab, shift_tab, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, PageUp, PageDown
Row 2: Home, Paste, End, Delete, `, ~, |, /, \, -
Row 3: Option, Command, Ctrl+C, Ctrl+Z, ', ", {, }, [, ], (, )
```

**Presets:**
1. **Claude Code** - Vim mode essentials, navigation, scrolling
2. **Open Code** - Leader key, command palette, line editing

### API Endpoints

- `GET /api/config` - Fetch current config including `quickKeysLayout`
- `PUT /api/config/quick-keys-layout` - Update layout (body: `string[][]`)

## UI Design

### Visual Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Quick Keys Layout                                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Configure the shortcuts shown above the keyboard on mobile  │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Row 1                                                   │ │
│ │ ┌─────┐ ┌──────┐ ┌───┐ ┌───┐ ┌─────┐ ┌───────┐ ...    │ │
│ │ │ Esc │ │ Ctrl │ │ ⌃ │ │ F │ │ Tab │ │ S-Tab │        │ │
│ │ └─────┘ └──────┘ └───┘ └───┘ └─────┘ └───────┘        │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Row 2                                                   │ │
│ │ ┌──────┐ ┌───────┐ ┌─────┐ ┌─────┐ ┌───┐ ┌───┐ ...    │ │
│ │ │ Home │ │ Paste │ │ End │ │ Del │ │ ` │ │ ~ │        │ │
│ │ └──────┘ └───────┘ └─────┘ └─────┘ └───┘ └───┘        │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Row 3                                                   │ │
│ │ ┌───┐ ┌───┐ ┌────┐ ┌────┐ ┌───┐ ┌───┐ ┌───┐ ...       │ │
│ │ │ ⌥ │ │ ⌘ │ │ ^C │ │ ^Z │ │ ' │ │ " │ │ { │          │ │
│ │ └───┘ └───┘ └────┘ └────┘ └───┘ └───┘ └───┘           │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌ Hidden Keys ──────────────────────────────────────────┐  │
│ │ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                    │  │
│ │ │ ^W │ │ ^U │ │ ^D │ │ ^L │ │ ^O │  ...               │  │
│ │ └────┘ └────┘ └────┘ └────┘ └────┘                    │  │
│ └───────────────────────────────────────────────────────┘  │
│                                                             │
│ [Reset to Default]    [Presets ▾]                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Interaction Model

1. **Drag keys** between rows or to/from hidden section
2. **Auto-save** on every change (debounced 300ms)
3. **Reset** button restores default layout
4. **Presets** menu applies predefined layouts
5. **Add row** button appears when last row has keys

## Files to Create

### 1. `mac/VibeTunnel/Core/Models/QuickKey.swift`

Data models and static definitions.

```swift
import Foundation

/// Definition for a single quick key
/// Mirrors web's QUICK_KEY_DEFINITIONS
struct QuickKeyDefinition: Identifiable, Equatable, Hashable {
    var id: String { key }
    let key: String      // "Escape", "Ctrl+C", etc.
    let label: String    // "Esc", "^C", etc.
    let isModifier: Bool // Control, Option, Command
    let isArrow: Bool    // Arrow keys (support key repeat)
    let isCombo: Bool    // Ctrl+C, Ctrl+Z, etc.
    let isToggle: Bool   // F, CtrlExpand (toggle expansion views)
    
    init(
        key: String,
        label: String,
        isModifier: Bool = false,
        isArrow: Bool = false,
        isCombo: Bool = false,
        isToggle: Bool = false
    ) {
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
    let iconName: String  // SF Symbol name
    let layout: [[String]]
}

/// Static data - all available keys and presets
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
        ["Escape", "Control", "CtrlExpand", "F", "Tab", "shift_tab", 
         "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"],
        ["Home", "Paste", "End", "Delete", "`", "~", "|", "/", "\\", "-"],
        ["Option", "Command", "Ctrl+C", "Ctrl+Z", "'", "\"", "{", "}", "[", "]", "(", ")"],
    ]
    
    /// Available presets
    static let presets: [QuickKeysPreset] = [
        QuickKeysPreset(
            id: "claude",
            name: "Claude Code",
            iconName: "sparkles",
            layout: [
                ["Escape", "Ctrl+C", "Ctrl+W", "Ctrl+U", "Ctrl+O", "Ctrl+E", "shift_tab"],
                ["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Delete"],
                ["Home", "End", "PageUp", "PageDown", "Paste", "/"],
            ]
        ),
        QuickKeysPreset(
            id: "opencode",
            name: "Open Code",
            iconName: "terminal",
            layout: [
                ["Escape", "Control", "Ctrl+X", "Ctrl+P", "Tab", "Ctrl+C", "/"],
                ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"],
                ["Ctrl+W", "Ctrl+U", "Ctrl+K", "Delete", "Paste", "Home", "End"],
            ]
        ),
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
```

### 2. `mac/VibeTunnel/Core/Services/QuickKeysService.swift`

API communication layer with debounced auto-save.

```swift
import Foundation
import Observation
import OSLog

/// Service for managing Quick Keys layout via server API
@MainActor
@Observable
final class QuickKeysService {
    static let shared = QuickKeysService()
    
    private let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "QuickKeysService")
    private var serverManager: ServerManager { ServerManager.shared }
    private var saveTask: Task<Void, Never>?
    
    /// Current layout
    private(set) var layout: [[String]] = QuickKeysData.defaultLayout
    
    /// Loading state
    private(set) var isLoading = false
    
    /// Last error
    private(set) var error: Error?
    
    private init() {}
    
    // MARK: - API Response Types
    
    private struct ConfigResponse: Decodable {
        let quickKeysLayout: [[String]]?
    }
    
    private struct SaveResponse: Decodable {
        let success: Bool
    }
    
    // MARK: - Public API
    
    /// Load layout from server
    func load() async {
        guard !isLoading else { return }
        
        isLoading = true
        error = nil
        
        defer { isLoading = false }
        
        do {
            let response: ConfigResponse = try await serverManager.performRequest(
                endpoint: APIEndpoints.config,
                method: "GET",
                responseType: ConfigResponse.self
            )
            
            if let serverLayout = response.quickKeysLayout, !serverLayout.isEmpty {
                layout = serverLayout
                logger.info("Loaded quick keys layout from server: \(serverLayout.count) rows")
            } else {
                layout = QuickKeysData.defaultLayout
                logger.info("No quick keys layout on server, using defaults")
            }
        } catch {
            self.error = error
            logger.error("Failed to load quick keys layout: \(error.localizedDescription)")
        }
    }
    
    /// Save layout to server (debounced)
    func save(_ newLayout: [[String]]) {
        layout = newLayout
        
        // Cancel any pending save
        saveTask?.cancel()
        
        // Debounce saves by 300ms
        saveTask = Task {
            do {
                try await Task.sleep(for: .milliseconds(300))
            } catch {
                return // Cancelled
            }
            
            guard !Task.isCancelled else { return }
            
            await performSave(newLayout)
        }
    }
    
    /// Perform immediate save (internal)
    private func performSave(_ layoutToSave: [[String]]) async {
        do {
            try await serverManager.performVoidRequest(
                endpoint: APIEndpoints.quickKeysLayout,
                method: "PUT",
                body: layoutToSave
            )
            logger.info("Saved quick keys layout: \(layoutToSave.count) rows")
            error = nil
        } catch {
            self.error = error
            logger.error("Failed to save quick keys layout: \(error.localizedDescription)")
        }
    }
    
    /// Reset to default layout
    func resetToDefaults() {
        save(QuickKeysData.defaultLayout)
    }
    
    /// Apply a preset
    func applyPreset(_ preset: QuickKeysPreset) {
        save(preset.layout)
    }
    
    /// Get hidden keys (keys not in current layout)
    func hiddenKeys() -> [QuickKeyDefinition] {
        let usedKeys = Set(layout.flatMap { $0 })
        return QuickKeysData.allKeys.filter { !usedKeys.contains($0.key) }
    }
}
```

### 3. `mac/VibeTunnel/Presentation/Views/Settings/QuickKeysSettingsView.swift`

Tab wrapper view.

```swift
import SwiftUI

/// Quick Keys settings tab for customizing mobile keyboard shortcuts
struct QuickKeysSettingsView: View {
    var body: some View {
        NavigationStack {
            Form {
                QuickKeysEditorView()
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .navigationTitle("Quick Keys")
        }
    }
}

#Preview {
    QuickKeysSettingsView()
        .environment(QuickKeysService.shared)
}
```

### 4. `mac/VibeTunnel/Presentation/Views/Settings/QuickKeysEditorView.swift`

Main editor with drag-and-drop and native macOS styling.

```swift
import SwiftUI
import UniformTypeIdentifiers

/// Editor view for customizing quick keys layout with drag-and-drop
struct QuickKeysEditorView: View {
    @Environment(QuickKeysService.self) private var service
    @State private var layout: [[String]] = []
    @State private var draggedKey: String?
    
    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 16) {
                // Description
                Text("Configure the shortcuts shown above the keyboard on mobile devices. Drag keys to reorder or hide them.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                
                // Keyboard rows
                VStack(spacing: 8) {
                    ForEach(Array(layout.enumerated()), id: \.offset) { rowIndex, row in
                        KeyboardRowView(
                            rowIndex: rowIndex,
                            keys: row,
                            draggedKey: $draggedKey,
                            onMoveKey: moveKey,
                            onRemoveKey: removeKey
                        )
                    }
                    
                    // Add row button
                    if canAddRow {
                        AddRowButton(action: addRow)
                    }
                }
                .padding()
                .background(Color(nsColor: .controlBackgroundColor))
                .cornerRadius(8)
                
                // Hidden keys section
                HiddenKeysSection(
                    hiddenKeys: hiddenKeys,
                    draggedKey: $draggedKey,
                    onAddKey: addKeyToLastRow
                )
                
                // Action buttons
                HStack {
                    Button("Reset to Default") {
                        service.resetToDefaults()
                        layout = QuickKeysData.defaultLayout
                    }
                    .buttonStyle(.link)
                    
                    Menu {
                        ForEach(QuickKeysData.presets) { preset in
                            Button {
                                service.applyPreset(preset)
                                layout = preset.layout
                            } label: {
                                Label(preset.name, systemImage: preset.iconName)
                            }
                        }
                    } label: {
                        Label("Presets", systemImage: "slider.horizontal.3")
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                    
                    Spacer()
                    
                    if service.isLoading {
                        ProgressView()
                            .scaleEffect(0.7)
                    }
                }
            }
        } header: {
            Text("Quick Keys Layout")
                .font(.headline)
        } footer: {
            Text("Changes are saved automatically.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .onAppear {
            layout = service.layout
            Task {
                await service.load()
                layout = service.layout
            }
        }
    }
    
    // MARK: - Computed Properties
    
    private var hiddenKeys: [QuickKeyDefinition] {
        let usedKeys = Set(layout.flatMap { $0 })
        return QuickKeysData.allKeys.filter { !usedKeys.contains($0.key) }
    }
    
    private var canAddRow: Bool {
        guard let lastRow = layout.last else { return true }
        return !lastRow.isEmpty
    }
    
    // MARK: - Actions
    
    private func addRow() {
        layout.append([])
        service.save(layout)
    }
    
    private func moveKey(_ key: String, toRow: Int, atIndex: Int) {
        // Remove from current position
        for rowIndex in layout.indices {
            layout[rowIndex].removeAll { $0 == key }
        }
        
        // Ensure row exists
        while layout.count <= toRow {
            layout.append([])
        }
        
        // Insert at new position
        let insertIndex = min(atIndex, layout[toRow].count)
        layout[toRow].insert(key, at: insertIndex)
        
        // Remove empty rows (except keep at least one)
        layout = layout.filter { !$0.isEmpty }
        if layout.isEmpty {
            layout = [[]]
        }
        
        service.save(layout)
    }
    
    private func removeKey(_ key: String) {
        for rowIndex in layout.indices {
            layout[rowIndex].removeAll { $0 == key }
        }
        
        // Remove empty rows
        layout = layout.filter { !$0.isEmpty }
        if layout.isEmpty {
            layout = [[]]
        }
        
        service.save(layout)
    }
    
    private func addKeyToLastRow(_ key: String) {
        if layout.isEmpty {
            layout = [[key]]
        } else {
            layout[layout.count - 1].append(key)
        }
        service.save(layout)
    }
}

// MARK: - Subviews

/// A single row of keyboard keys
struct KeyboardRowView: View {
    let rowIndex: Int
    let keys: [String]
    @Binding var draggedKey: String?
    let onMoveKey: (String, Int, Int) -> Void
    let onRemoveKey: (String) -> Void
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Row \(rowIndex + 1)")
                .font(.caption)
                .foregroundStyle(.tertiary)
            
            HStack(spacing: 4) {
                ForEach(Array(keys.enumerated()), id: \.element) { index, key in
                    if let definition = QuickKeysData.definition(for: key) {
                        KeyTileView(definition: definition, isDragging: draggedKey == key)
                            .draggable(key) {
                                draggedKey = key
                                return NSItemProvider(object: key as NSString)
                            }
                            .dropDestination(for: String.self) { items, _ in
                                guard let droppedKey = items.first else { return false }
                                onMoveKey(droppedKey, rowIndex, index)
                                draggedKey = nil
                                return true
                            }
                    }
                }
                
                // Drop zone at end of row
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.accentColor.opacity(0.1))
                    .frame(width: 30, height: 28)
                    .overlay {
                        Image(systemName: "plus")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    .dropDestination(for: String.self) { items, _ in
                        guard let droppedKey = items.first else { return false }
                        onMoveKey(droppedKey, rowIndex, keys.count)
                        draggedKey = nil
                        return true
                    }
                
                Spacer()
            }
        }
    }
}

/// Individual key tile
struct KeyTileView: View {
    let definition: QuickKeyDefinition
    let isDragging: Bool
    
    var body: some View {
        Text(definition.label)
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(nsColor: .controlColor))
                    .shadow(color: .black.opacity(0.1), radius: 1, y: 1)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(Color(nsColor: .separatorColor), lineWidth: 0.5)
            )
            .opacity(isDragging ? 0.5 : 1)
    }
}

/// Section showing hidden (unused) keys
struct HiddenKeysSection: View {
    let hiddenKeys: [QuickKeyDefinition]
    @Binding var draggedKey: String?
    let onAddKey: (String) -> Void
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Hidden Keys")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            
            if hiddenKeys.isEmpty {
                Text("All keys are visible. Drag keys here to hide them.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(Color(nsColor: .controlBackgroundColor))
                    .cornerRadius(8)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 50))], spacing: 4) {
                    ForEach(hiddenKeys) { key in
                        KeyTileView(definition: key, isDragging: draggedKey == key.key)
                            .draggable(key.key) {
                                draggedKey = key.key
                                return NSItemProvider(object: key.key as NSString)
                            }
                            .onTapGesture {
                                onAddKey(key.key)
                            }
                    }
                }
                .padding()
                .background(Color(nsColor: .controlBackgroundColor))
                .cornerRadius(8)
            }
        }
        .dropDestination(for: String.self) { items, _ in
            // Dropping on hidden section removes from layout
            draggedKey = nil
            return true // Key removal handled by drag source
        }
    }
}

/// Button to add a new row
struct AddRowButton: View {
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: "plus")
                Text("Add Row")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
        .padding(.vertical, 8)
    }
}

#Preview {
    Form {
        QuickKeysEditorView()
    }
    .formStyle(.grouped)
    .environment(QuickKeysService.shared)
}
```

## Files to Modify

### 5. `mac/VibeTunnel/Presentation/Views/Settings/SettingsTab.swift`

Add `quickKeys` case.

```diff
 enum SettingsTab: String, CaseIterable {
     case general
     case notifications
     case quickStart
+    case quickKeys
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
+        case .quickKeys: "Quick Keys"
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
+        case .quickKeys: "keyboard"
         case .dashboard: "server.rack"
         case .remoteAccess: "network"
         case .advanced: "gearshape.2"
         case .debug: "hammer"
         case .about: "info.circle"
         }
     }
 }
```

### 6. `mac/VibeTunnel/Presentation/Views/SettingsView.swift`

Add Quick Keys tab.

```diff
 // In tabSizes dictionary:
 private let tabSizes: [SettingsTab: CGSize] = [
     .general: Layout.defaultTabSize,
     .notifications: Layout.defaultTabSize,
     .quickStart: Layout.defaultTabSize,
+    .quickKeys: Layout.defaultTabSize,
     .dashboard: Layout.defaultTabSize,
     .remoteAccess: Layout.defaultTabSize,
     .advanced: Layout.defaultTabSize,
     .debug: Layout.defaultTabSize,
     .about: Layout.defaultTabSize,
 ]

 // In TabView body, after QuickStartSettingsView:
+QuickKeysSettingsView()
+    .tabItem {
+        Label(SettingsTab.quickKeys.displayName, systemImage: SettingsTab.quickKeys.icon)
+    }
+    .tag(SettingsTab.quickKeys)
```

### 7. `mac/VibeTunnel/Core/Constants/APIEndpoints.swift`

Add config endpoints.

```diff
 enum APIEndpoints {
     static let sessions = "/api/sessions"
     static func sessionDetail(id: String) -> String { "/api/sessions/\(id)" }
     static let cleanupExited = "/api/cleanup-exited"
     static let ws = "/ws"
+    static let config = "/api/config"
+    static let quickKeysLayout = "/api/config/quick-keys-layout"
 }
```

### 8. `mac/VibeTunnel/VibeTunnelApp.swift`

Add QuickKeysService to environment.

```diff
 // Add state property:
+@State var quickKeysService = QuickKeysService.shared

 // In Settings { SettingsView() ... }:
 SettingsView()
     .environment(configManager)
     .environment(serverManager)
+    .environment(quickKeysService)
     // ... other environments
```

## Rebase Safety Analysis

| File | Risk | Reason |
|------|------|--------|
| `QuickKey.swift` | None | New file |
| `QuickKeysService.swift` | None | New file |
| `QuickKeysSettingsView.swift` | None | New file |
| `QuickKeysEditorView.swift` | None | New file |
| `SettingsTab.swift` | Low | Adding enum case - only conflicts if main adds same name |
| `SettingsView.swift` | Low | Adding tab - only conflicts if main modifies exact lines |
| `APIEndpoints.swift` | Low | Adding static properties - very safe |
| `VibeTunnelApp.swift` | Low | Adding environment - safe unless main restructures |

**Overall conflict risk: Very Low** - All changes are additive and isolated.

## Testing Checklist

- [ ] Tab appears in Settings window with keyboard icon
- [ ] Layout loads from server on tab open
- [ ] Drag and drop between rows works
- [ ] Drag to hidden section removes key
- [ ] Drag from hidden section adds key
- [ ] Add row button works
- [ ] Reset button restores default layout
- [ ] Preset menu applies layouts correctly
- [ ] Changes auto-save (check server log or config file)
- [ ] Debouncing works (rapid drags don't flood API)
- [ ] Changes reflect on mobile web UI after refresh
