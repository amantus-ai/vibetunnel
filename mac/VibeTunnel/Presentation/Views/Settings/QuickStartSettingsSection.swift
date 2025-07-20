import SwiftUI
import AppKit

/// Settings section for managing quick start commands
struct QuickStartSettingsSection: View {
    @AppStorage(AppConstants.UserDefaultsKeys.quickStartCommands)
    private var quickStartCommandsData = Data()
    
    @State private var commands: [QuickStartCommand] = []
    @State private var editingCommandId: String?
    @State private var newCommandName = ""
    @State private var newCommandCommand = ""
    @State private var showingNewCommand = false
    
    struct QuickStartCommand: Identifiable, Codable, Equatable {
        let id = UUID().uuidString
        var name: String
        var command: String
        var isDefault: Bool = false
        
        init(name: String, command: String, isDefault: Bool = false) {
            self.name = name
            self.command = command
            self.isDefault = isDefault
        }
    }
    
    private let defaultCommands = [
        QuickStartCommand(name: "✨ claude", command: "claude", isDefault: true),
        QuickStartCommand(name: "✨ gemini", command: "gemini", isDefault: true),
        QuickStartCommand(name: "zsh", command: "zsh", isDefault: true),
        QuickStartCommand(name: "python3", command: "python3", isDefault: true),
        QuickStartCommand(name: "node", command: "node", isDefault: true),
        QuickStartCommand(name: "▶️ pnpm run dev", command: "pnpm run dev", isDefault: true)
    ]
    
    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                // Header with Add button
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Quick Start Commands")
                            .font(.headline)
                        Text("Commands shown in the new session form for quick access.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    
                    Spacer()
                    
                    Button(action: { 
                        editingCommandId = nil
                        showingNewCommand = true 
                    }) {
                        Label("Add", systemImage: "plus")
                    }
                    .buttonStyle(.bordered)
                    .disabled(showingNewCommand)
                }
                
                // Commands list
                VStack(spacing: 4) {
                    ForEach(commands) { command in
                        QuickStartCommandRow(
                            command: command,
                            isEditing: editingCommandId == command.id,
                            onEdit: { editingCommandId = command.id },
                            onSave: { updateCommand($0) },
                            onDelete: { deleteCommand(command) },
                            onStopEditing: { editingCommandId = nil }
                        )
                    }
                    
                    // New command inline form
                    if showingNewCommand {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 4) {
                                TextField("Display name", text: $newCommandName)
                                    .textFieldStyle(.roundedBorder)
                                    .font(.system(size: 12))
                                
                                TextField("Command", text: $newCommandCommand)
                                    .textFieldStyle(.roundedBorder)
                                    .font(.system(size: 11))
                            }
                            
                            HStack(spacing: 8) {
                                Button(action: saveNewCommand) {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 11))
                                        .foregroundColor(.green)
                                }
                                .buttonStyle(.plain)
                                .disabled(newCommandName.isEmpty || newCommandCommand.isEmpty)
                                
                                Button(action: cancelNewCommand) {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 11))
                                        .foregroundColor(.red)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color(NSColor.controlBackgroundColor).opacity(0.5))
                        .cornerRadius(4)
                    }
                }
                .background(Color(NSColor.controlBackgroundColor))
                .cornerRadius(6)
                
                // Reset button
                HStack {
                    Button("Reset to Defaults") {
                        resetToDefaults()
                    }
                    .buttonStyle(.link)
                    
                    Spacer()
                }
            }
        } header: {
            Text("Quick Start")
                .font(.headline)
        }
        .onAppear {
            loadCommands()
        }
    }
    
    private func loadCommands() {
        if quickStartCommandsData.isEmpty {
            // Use default commands if none saved
            commands = defaultCommands
            saveCommands()
        } else if let decoded = try? JSONDecoder().decode([QuickStartCommand].self, from: quickStartCommandsData) {
            commands = decoded
        } else {
            commands = defaultCommands
        }
    }
    
    private func saveCommands() {
        if let encoded = try? JSONEncoder().encode(commands) {
            quickStartCommandsData = encoded
        }
    }
    
    private func addCommand(_ command: QuickStartCommand) {
        commands.append(command)
        saveCommands()
    }
    
    private func updateCommand(_ updated: QuickStartCommand) {
        if let index = commands.firstIndex(where: { $0.id == updated.id }) {
            commands[index] = updated
            saveCommands()
        }
    }
    
    private func deleteCommand(_ command: QuickStartCommand) {
        commands.removeAll { $0.id == command.id }
        saveCommands()
    }
    
    private func resetToDefaults() {
        commands = defaultCommands
        saveCommands()
        editingCommandId = nil
        showingNewCommand = false
    }
    
    private func saveNewCommand() {
        let newCommand = QuickStartCommand(
            name: newCommandName.trimmingCharacters(in: .whitespacesAndNewlines),
            command: newCommandCommand.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        commands.append(newCommand)
        saveCommands()
        
        // Reset state
        newCommandName = ""
        newCommandCommand = ""
        showingNewCommand = false
    }
    
    private func cancelNewCommand() {
        newCommandName = ""
        newCommandCommand = ""
        showingNewCommand = false
    }
}

// MARK: - Command Row

private struct QuickStartCommandRow: View {
    let command: QuickStartSettingsSection.QuickStartCommand
    let isEditing: Bool
    let onEdit: () -> Void
    let onSave: (QuickStartSettingsSection.QuickStartCommand) -> Void
    let onDelete: () -> Void
    let onStopEditing: () -> Void
    
    @State private var isHovering = false
    @State private var editingName: String = ""
    @State private var editingCommand: String = ""
    
    var body: some View {
        HStack(spacing: 12) {
            if isEditing {
                // Inline editing mode
                VStack(alignment: .leading, spacing: 4) {
                    TextField("Display name", text: $editingName)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 12))
                        .onSubmit { saveChanges() }
                    
                    TextField("Command", text: $editingCommand)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 11))
                        .onSubmit { saveChanges() }
                }
                
                HStack(spacing: 8) {
                    Button(action: saveChanges) {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11))
                            .foregroundColor(.green)
                    }
                    .buttonStyle(.plain)
                    .disabled(editingName.isEmpty || editingCommand.isEmpty)
                    
                    Button(action: cancelEditing) {
                        Image(systemName: "xmark")
                            .font(.system(size: 11))
                            .foregroundColor(.red)
                    }
                    .buttonStyle(.plain)
                }
            } else {
                // Display mode
                VStack(alignment: .leading, spacing: 2) {
                    Text(command.name)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.primary)
                    
                    Text(command.command)
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                
                Spacer()
                
                HStack(spacing: 8) {
                    Button(action: startEditing) {
                        Image(systemName: "pencil")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                    .opacity(isHovering ? 1 : 0)
                    .animation(.easeInOut(duration: 0.2), value: isHovering)
                    
                    if !command.isDefault {
                        Button(action: onDelete) {
                            Image(systemName: "trash")
                                .font(.system(size: 11))
                                .foregroundColor(.secondary)
                        }
                        .buttonStyle(.plain)
                        .opacity(isHovering ? 1 : 0)
                        .animation(.easeInOut(duration: 0.2), value: isHovering)
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 4)
                .fill(isEditing ? Color.accentColor.opacity(0.1) : Color.clear)
        )
        .onHover { hovering in
            isHovering = hovering
        }
    }
    
    private func startEditing() {
        editingName = command.name
        editingCommand = command.command
        onEdit()
    }
    
    private func saveChanges() {
        var updatedCommand = command
        updatedCommand.name = editingName.trimmingCharacters(in: .whitespacesAndNewlines)
        updatedCommand.command = editingCommand.trimmingCharacters(in: .whitespacesAndNewlines)
        onSave(updatedCommand)
        onStopEditing()
    }
    
    private func cancelEditing() {
        editingName = ""
        editingCommand = ""
        onStopEditing()
    }
}