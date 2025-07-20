# macOS Quick Start Configuration Implementation Guide

This guide provides Swift implementation examples for adding quick start configuration support to the VibeTunnel macOS app.

## 1. Configuration Model

First, create Swift models that match the configuration structure:

```swift
// QuickStartConfiguration.swift
import Foundation

struct QuickStartCommand: Codable, Identifiable, Hashable {
    let id = UUID()
    var name: String?
    var command: String
    var emoji: String?
    
    // Display name falls back to command if name is nil
    var displayName: String {
        name?.isEmpty == false ? name! : command
    }
    
    private enum CodingKeys: String, CodingKey {
        case name, command, emoji
    }
}

struct VibeTunnelConfig: Codable {
    var version: Int
    var quickStartCommands: [QuickStartCommand]
    
    static let defaultCommands = [
        QuickStartCommand(name: nil, command: "claude", emoji: "✨"),
        QuickStartCommand(name: nil, command: "gemini", emoji: "✨"),
        QuickStartCommand(name: nil, command: "zsh", emoji: nil),
        QuickStartCommand(name: nil, command: "python3", emoji: nil),
        QuickStartCommand(name: nil, command: "node", emoji: nil),
        QuickStartCommand(name: nil, command: "pnpm run dev", emoji: "▶️")
    ]
    
    static let defaultConfig = VibeTunnelConfig(
        version: 1,
        quickStartCommands: defaultCommands
    )
}
```

## 2. Configuration Service with File Watching

Create a service to manage the configuration file and watch for changes:

```swift
// QuickStartConfigurationService.swift
import Foundation
import Combine

class QuickStartConfigurationService: ObservableObject {
    @Published var config: VibeTunnelConfig = .defaultConfig
    
    private let configURL: URL
    private var fileMonitor: DispatchSourceFileSystemObject?
    private let queue = DispatchQueue(label: "ai.vibetunnel.config.monitor")
    
    init() {
        // Setup config directory and file path
        let homeURL = FileManager.default.homeDirectoryForCurrentUser
        let configDir = homeURL.appendingPathComponent(".vibetunnel")
        self.configURL = configDir.appendingPathComponent("config.json")
        
        // Ensure directory exists
        try? FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
        
        // Load initial configuration
        loadConfiguration()
        
        // Start file monitoring
        startMonitoring()
    }
    
    deinit {
        stopMonitoring()
    }
    
    private func loadConfiguration() {
        do {
            let data = try Data(contentsOf: configURL)
            config = try JSONDecoder().decode(VibeTunnelConfig.self, from: data)
        } catch {
            // If file doesn't exist or is invalid, create default
            if !FileManager.default.fileExists(atPath: configURL.path) {
                saveConfiguration(config: .defaultConfig)
            }
            config = .defaultConfig
        }
    }
    
    func saveConfiguration(config: VibeTunnelConfig) {
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(config)
            try data.write(to: configURL)
            self.config = config
        } catch {
            print("Failed to save configuration: \(error)")
        }
    }
    
    private func startMonitoring() {
        let fileDescriptor = open(configURL.path, O_EVTONLY)
        guard fileDescriptor >= 0 else { return }
        
        fileMonitor = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fileDescriptor,
            eventMask: [.write, .rename],
            queue: queue
        )
        
        fileMonitor?.setEventHandler { [weak self] in
            DispatchQueue.main.async {
                self?.loadConfiguration()
            }
        }
        
        fileMonitor?.setCancelHandler {
            close(fileDescriptor)
        }
        
        fileMonitor?.resume()
    }
    
    private func stopMonitoring() {
        fileMonitor?.cancel()
        fileMonitor = nil
    }
}
```

## 3. Quick Start Editor View

Create a SwiftUI view for editing quick start commands:

```swift
// QuickStartEditorView.swift
import SwiftUI

struct QuickStartEditorView: View {
    @ObservedObject var configService: QuickStartConfigurationService
    @Environment(\.dismiss) private var dismiss
    @State private var commands: [QuickStartCommand] = []
    @State private var showingAddCommand = false
    
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Header
                HStack {
                    Text("Quick Start Commands")
                        .font(.headline)
                    Spacer()
                    Button("Add") {
                        showingAddCommand = true
                    }
                }
                .padding()
                
                // Command List
                List {
                    ForEach($commands) { $command in
                        QuickStartItemEditor(command: $command)
                    }
                    .onDelete(perform: deleteCommands)
                    .onMove(perform: moveCommands)
                }
                .listStyle(InsetListStyle())
                
                // Footer buttons
                HStack {
                    Button("Reset to Defaults") {
                        commands = VibeTunnelConfig.defaultCommands
                    }
                    .buttonStyle(.link)
                    
                    Spacer()
                    
                    Button("Cancel") {
                        dismiss()
                    }
                    .keyboardShortcut(.escape)
                    
                    Button("Save") {
                        saveChanges()
                        dismiss()
                    }
                    .keyboardShortcut(.return)
                    .buttonStyle(.borderedProminent)
                }
                .padding()
            }
            .frame(width: 500, height: 400)
            .onAppear {
                commands = configService.config.quickStartCommands
            }
            .sheet(isPresented: $showingAddCommand) {
                AddCommandSheet(commands: $commands)
            }
        }
    }
    
    private func deleteCommands(at offsets: IndexSet) {
        commands.remove(atOffsets: offsets)
    }
    
    private func moveCommands(from source: IndexSet, to destination: Int) {
        commands.move(fromOffsets: source, toOffset: destination)
    }
    
    private func saveChanges() {
        var newConfig = configService.config
        newConfig.quickStartCommands = commands
        configService.saveConfiguration(config: newConfig)
    }
}

struct QuickStartItemEditor: View {
    @Binding var command: QuickStartCommand
    
    var body: some View {
        HStack {
            // Emoji picker (simplified - could use NSPopover with emoji picker)
            TextField("🎯", text: Binding(
                get: { command.emoji ?? "" },
                set: { command.emoji = $0.isEmpty ? nil : $0 }
            ))
            .frame(width: 40)
            .textFieldStyle(RoundedBorderTextFieldStyle())
            
            // Name field
            TextField("Display Name", text: Binding(
                get: { command.name ?? "" },
                set: { command.name = $0.isEmpty ? nil : $0 }
            ))
            .textFieldStyle(RoundedBorderTextFieldStyle())
            
            // Command field
            TextField("Command", text: $command.command)
                .textFieldStyle(RoundedBorderTextFieldStyle())
                .font(.system(.body, design: .monospaced))
        }
        .padding(.vertical, 4)
    }
}

struct AddCommandSheet: View {
    @Binding var commands: [QuickStartCommand]
    @Environment(\.dismiss) private var dismiss
    @State private var newCommand = QuickStartCommand(name: "", command: "", emoji: nil)
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Add Quick Start Command")
                .font(.headline)
            
            QuickStartItemEditor(command: $newCommand)
                .padding()
            
            HStack {
                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.escape)
                
                Button("Add") {
                    commands.append(newCommand)
                    dismiss()
                }
                .keyboardShortcut(.return)
                .buttonStyle(.borderedProminent)
                .disabled(newCommand.command.isEmpty)
            }
        }
        .padding()
        .frame(width: 400)
    }
}
```

## 4. Integration with NewSessionForm

Update the `NewSessionForm.swift` to use the configuration service:

```swift
// In NewSessionForm.swift

struct NewSessionForm: View {
    @StateObject private var configService = QuickStartConfigurationService()
    // ... other properties
    
    var body: some View {
        VStack {
            // ... existing form content
            
            // Quick Start section with edit button
            HStack {
                Text("Quick Start")
                    .font(.headline)
                
                Button(action: { showingQuickStartEditor = true }) {
                    Image(systemName: "pencil.circle")
                        .foregroundColor(.secondary)
                        .opacity(isHovering ? 1.0 : 0.5)
                }
                .buttonStyle(.plain)
                .help("Edit quick start commands")
                .onHover { hovering in
                    isHovering = hovering
                }
            }
            
            // Quick command grid
            LazyVGrid(columns: [
                GridItem(.flexible()),
                GridItem(.flexible()),
                GridItem(.flexible())
            ], spacing: 8) {
                ForEach(configService.config.quickStartCommands) { cmd in
                    QuickCommandButton(
                        title: cmd.displayName,
                        emoji: cmd.emoji,
                        action: {
                            command = cmd.command
                            // Auto-select dynamic title for AI commands
                            if cmd.command.lowercased().contains("claude") || 
                               cmd.command.lowercased().contains("gemini") {
                                titleMode = .dynamic
                            }
                        }
                    )
                }
            }
            
            // ... rest of form
        }
        .sheet(isPresented: $showingQuickStartEditor) {
            QuickStartEditorView(configService: configService)
        }
    }
}
```

## 5. App Storage Integration (Optional)

If you want to also sync with UserDefaults for iCloud sync:

```swift
extension QuickStartConfigurationService {
    func syncToUserDefaults() {
        if let data = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(data, forKey: "quickStartConfiguration")
        }
    }
    
    func syncFromUserDefaults() {
        guard let data = UserDefaults.standard.data(forKey: "quickStartConfiguration"),
              let savedConfig = try? JSONDecoder().decode(VibeTunnelConfig.self, from: data) else {
            return
        }
        
        // Merge or replace based on your sync strategy
        self.config = savedConfig
        saveConfiguration(config: savedConfig)
    }
}
```

## Testing

1. Launch the app and verify default quick start commands appear
2. Click the edit button next to "Quick Start"
3. Add, remove, reorder commands
4. Save and verify changes persist
5. Edit `~/.vibetunnel/config.json` manually and verify app picks up changes
6. Test that web server also reads the updated configuration

## Notes

- The file watcher uses GCD's DispatchSource for efficient file monitoring
- Configuration changes are automatically picked up without app restart
- The UI follows macOS design patterns with proper keyboard shortcuts
- Consider adding validation for command syntax
- Could enhance emoji picker with a proper NSPopover emoji selector