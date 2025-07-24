import AppKit
import SwiftUI

/// Settings section for managing quick start commands
struct QuickStartSettingsSection: View {
    @Environment(ConfigManager.self) private var configManager
    @State private var editingCommandId: String?
    @State private var newCommandName = ""
    @State private var newCommandCommand = ""
    @State private var showingNewCommand = false

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                // Header without Add button
                VStack(alignment: .leading, spacing: 4) {
                    Text("Quick Start Commands")
                        .font(.headline)
                    Text("Commands shown in the new session form for quick access.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                // Commands list
                List {
                    ForEach(configManager.quickStartCommands) { command in
                        QuickStartCommandRow(
                            command: command,
                            isEditing: editingCommandId == command.id,
                            onEdit: { editingCommandId = command.id },
                            onSave: { updateCommand($0) },
                            onDelete: { deleteCommand(command) },
                            onStopEditing: { editingCommandId = nil }
                        )
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 2, leading: 0, bottom: 2, trailing: 0))
                        .listRowBackground(Color.clear)
                    }
                    .onMove(perform: moveQuickStartItems)

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
                        .background(Color(NSColor.tertiaryLabelColor).opacity(0.1))
                        .cornerRadius(4)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 2, leading: 0, bottom: 2, trailing: 0))
                        .listRowBackground(Color.clear)
                    }
                }
                .listStyle(.plain)
                .background(Color(NSColor.tertiaryLabelColor).opacity(0.08))
                .cornerRadius(6)
                .frame(minHeight: 100)
                .scrollContentBackground(.hidden)

                // Action buttons
                HStack {
                    Button("Reset to Defaults") {
                        resetToDefaults()
                    }
                    .buttonStyle(.link)

                    Spacer()

                    if !configManager.quickStartCommands.isEmpty {
                        Button("Delete All") {
                            deleteAllCommands()
                        }
                        .buttonStyle(.link)
                        .foregroundColor(.red)
                    }

                    Button(action: {
                        editingCommandId = nil
                        showingNewCommand = true
                    }, label: {
                        Label("Add", systemImage: "plus")
                    })
                    .buttonStyle(.bordered)
                    .disabled(showingNewCommand)
                }
            }
        }
    }

    private func updateCommand(_ updated: QuickStartCommand) {
        configManager.updateCommand(
            id: updated.id,
            name: updated.name,
            command: updated.command
        )
    }

    private func deleteCommand(_ command: QuickStartCommand) {
        configManager.deleteCommand(id: command.id)
    }

    private func resetToDefaults() {
        configManager.resetToDefaults()
        editingCommandId = nil
        showingNewCommand = false
    }

    private func deleteAllCommands() {
        configManager.deleteAllCommands()
        editingCommandId = nil
        showingNewCommand = false
    }

    private func saveNewCommand() {
        let name = newCommandName.trimmingCharacters(in: .whitespacesAndNewlines)
        let command = newCommandCommand.trimmingCharacters(in: .whitespacesAndNewlines)

        configManager.addCommand(
            name: name.isEmpty ? nil : name,
            command: command
        )

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

    private func moveQuickStartItems(from source: IndexSet, to destination: Int) {
        configManager.moveCommands(from: source, to: destination)
    }
}

// MARK: - Command Row

private struct QuickStartCommandRow: View {
    let command: QuickStartCommand
    let isEditing: Bool
    let onEdit: () -> Void
    let onSave: (QuickStartCommand) -> Void
    let onDelete: () -> Void
    let onStopEditing: () -> Void

    @State private var isHovering = false
    @State private var editingName: String = ""
    @State private var editingCommand: String = ""

    var body: some View {
        HStack(spacing: 12) {
            // Drag handle
            Image(systemName: "line.horizontal.3")
                .font(.system(size: 11))
                .foregroundColor(.secondary.opacity(0.6))
                .opacity(isHovering ? 1 : 0.4)
                .animation(.easeInOut(duration: 0.2), value: isHovering)

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
                    Text(command.displayName)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.primary)

                    if command.name != nil {
                        Text(command.command)
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
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
        editingName = command.name ?? ""
        editingCommand = command.command
        onEdit()
    }

    private func saveChanges() {
        let trimmedName = editingName.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedCommand = editingCommand.trimmingCharacters(in: .whitespacesAndNewlines)

        var updatedCommand = command
        updatedCommand.name = trimmedName.isEmpty ? nil : trimmedName
        updatedCommand.command = trimmedCommand
        onSave(updatedCommand)
        onStopEditing()
    }

    private func cancelEditing() {
        editingName = ""
        editingCommand = ""
        onStopEditing()
    }
}
