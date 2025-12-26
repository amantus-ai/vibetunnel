import SwiftUI

/// Editor view for customizing quick keys layout with drag-and-drop
/// Provides WYSIWYG preview of mobile keyboard layout
struct QuickKeysEditorView: View {
    @Environment(QuickKeysService.self) private var service
    @State private var layout: [[String]] = []
    @State private var draggedKey: String?
    @State private var originalLayout: [[String]] = []

    /// Width constraint to simulate mobile phone screen
    private let mobilePreviewWidth: CGFloat = 440

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 16) {
                // Description
                Text(
                    "Configure the shortcuts shown above the keyboard on mobile devices. Drag keys to reorder or hide them."
                )
                .font(.callout)
                .foregroundStyle(.secondary)

                // Keyboard rows preview - constrained to mobile width
                VStack(spacing: 4) {
                    ForEach(Array(self.layout.enumerated()), id: \.offset) { rowIndex, row in
                        KeyboardRowView(
                            rowIndex: rowIndex,
                            keys: row,
                            draggedKey: self.$draggedKey,
                            layout: self.$layout)
                    }

                    // Add row button
                    if self.canAddRow {
                        AddRowButton(action: self.addRow)
                    }
                }
                .padding(12)
                .frame(width: self.mobilePreviewWidth)
                .background(Color(nsColor: .windowBackgroundColor))
                .cornerRadius(12)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color(nsColor: .separatorColor), lineWidth: 1))
                .frame(maxWidth: .infinity, alignment: .center)

                // Hidden keys section
                HiddenKeysSection(
                    hiddenKeys: self.hiddenKeys,
                    draggedKey: self.$draggedKey,
                    layout: self.$layout,
                    onAddKey: self.addKeyToLastRow)

                // Action buttons
                HStack {
                    Button("Reset to Default") {
                        self.layout = QuickKeysData.defaultLayout
                        self.service.save(self.layout)
                    }
                    .buttonStyle(.link)

                    Menu {
                        ForEach(QuickKeysData.presets) { preset in
                            Button {
                                self.layout = preset.layout
                                self.service.save(self.layout)
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

                    if self.service.isSaving {
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
            self.layout = self.service.layout
            Task {
                await self.service.load()
                self.layout = self.service.layout
            }
        }
        .onChange(of: self.draggedKey) { oldValue, newValue in
            if oldValue != nil, newValue == nil {
                // Drag ended - save the layout
                self.service.save(self.layout)
            } else if oldValue == nil, newValue != nil {
                // Drag started - store original layout for potential cancel
                self.originalLayout = self.layout
            }
        }
    }

    // MARK: - Computed Properties

    private var hiddenKeys: [QuickKeyDefinition] {
        let usedKeys = Set(self.layout.flatMap { $0 })
        return QuickKeysData.allKeys.filter { !usedKeys.contains($0.key) }
    }

    private var canAddRow: Bool {
        guard let lastRow = self.layout.last else { return true }
        return !lastRow.isEmpty
    }

    // MARK: - Actions

    private func addRow() {
        self.layout.append([])
        self.service.save(self.layout)
    }

    private func addKeyToLastRow(_ key: String) {
        if self.layout.isEmpty {
            self.layout = [[key]]
        } else {
            self.layout[self.layout.count - 1].append(key)
        }
        self.service.save(self.layout)
    }
}

// MARK: - Subviews

/// A single row of keyboard keys with drag-and-drop support
private struct KeyboardRowView: View {
    let rowIndex: Int
    let keys: [String]
    @Binding var draggedKey: String?
    @Binding var layout: [[String]]

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(self.keys.enumerated()), id: \.element) { index, key in
                if let definition = QuickKeysData.definition(for: key) {
                    KeyTileView(definition: definition, isDragging: self.draggedKey == key)
                        .onDrag {
                            self.draggedKey = key
                            return NSItemProvider(object: key as NSString)
                        }
                        .onDrop(of: [.text], delegate: KeyDropDelegate(
                            targetKey: key,
                            rowIndex: self.rowIndex,
                            keyIndex: index,
                            draggedKey: self.$draggedKey,
                            layout: self.$layout))
                }
            }
        }
        .padding(.vertical, 1)
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .onDrop(of: [.text], delegate: RowDropDelegate(
            rowIndex: self.rowIndex,
            draggedKey: self.$draggedKey,
            layout: self.$layout))
    }
}

/// Individual key tile with native macOS styling
private struct KeyTileView: View {
    let definition: QuickKeyDefinition
    let isDragging: Bool

    var body: some View {
        Text(self.definition.label)
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .lineLimit(1)
            .truncationMode(.tail)
            .padding(.horizontal, 5)
            .padding(.vertical, 4)
            .frame(minWidth: 24, maxWidth: 44)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(nsColor: .controlColor))
                    .shadow(color: .black.opacity(0.1), radius: 1, y: 1))
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(Color(nsColor: .separatorColor), lineWidth: 0.5))
            .opacity(self.isDragging ? 0.3 : 1)
    }
}

/// Section showing hidden (unused) keys that can be dragged back into the layout
private struct HiddenKeysSection: View {
    let hiddenKeys: [QuickKeyDefinition]
    @Binding var draggedKey: String?
    @Binding var layout: [[String]]
    let onAddKey: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Hidden Keys")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Group {
                if self.hiddenKeys.isEmpty {
                    Text("All keys are visible. Drag keys here to hide them.")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .padding()
                        .frame(maxWidth: .infinity)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 40))], spacing: 4) {
                        ForEach(self.hiddenKeys) { key in
                            KeyTileView(definition: key, isDragging: self.draggedKey == key.key)
                                .onDrag {
                                    self.draggedKey = key.key
                                    return NSItemProvider(object: key.key as NSString)
                                }
                                .onTapGesture {
                                    self.onAddKey(key.key)
                                }
                        }
                    }
                    .padding()
                }
            }
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(Color(nsColor: .controlBackgroundColor))
            .cornerRadius(8)
            .onDrop(of: [.text], delegate: HiddenSectionDropDelegate(
                draggedKey: self.$draggedKey,
                layout: self.$layout))
        }
    }
}

/// Button to add a new row to the layout
private struct AddRowButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: self.action) {
            HStack {
                Image(systemName: "plus")
                Text("Add Row")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
        .padding(.vertical, 4)
    }
}

// MARK: - Drop Delegates

/// Drop delegate for dropping on a specific key position - enables real-time reordering
private struct KeyDropDelegate: DropDelegate {
    let targetKey: String
    let rowIndex: Int
    let keyIndex: Int
    @Binding var draggedKey: String?
    @Binding var layout: [[String]]

    func performDrop(info: DropInfo) -> Bool {
        self.draggedKey = nil
        return true
    }

    func dropEntered(info: DropInfo) {
        guard let draggedKey = self.draggedKey,
              draggedKey != self.targetKey else { return }

        // Find current position of dragged key
        var sourceRow: Int?
        var sourceIndex: Int?
        for (rIdx, row) in self.layout.enumerated() {
            if let kIdx = row.firstIndex(of: draggedKey) {
                sourceRow = rIdx
                sourceIndex = kIdx
                break
            }
        }

        guard let srcRow = sourceRow, let srcIdx = sourceIndex else { return }

        withAnimation(.easeInOut(duration: 0.15)) {
            // Remove from source
            self.layout[srcRow].remove(at: srcIdx)

            // Calculate target index (adjust if same row and source was before target)
            var targetIdx = self.keyIndex
            if srcRow == self.rowIndex, srcIdx < self.keyIndex {
                targetIdx -= 1
            }

            // Insert at target
            self.layout[self.rowIndex].insert(draggedKey, at: targetIdx)

            // Clean up empty rows
            self.layout = self.layout.filter { !$0.isEmpty }
            if self.layout.isEmpty {
                self.layout = [[]]
            }
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func validateDrop(info: DropInfo) -> Bool {
        self.draggedKey != nil && self.draggedKey != self.targetKey
    }
}

/// Drop delegate for dropping at end of row
private struct RowDropDelegate: DropDelegate {
    let rowIndex: Int
    @Binding var draggedKey: String?
    @Binding var layout: [[String]]

    func performDrop(info: DropInfo) -> Bool {
        self.draggedKey = nil
        return true
    }

    func dropEntered(info: DropInfo) {
        guard let draggedKey = self.draggedKey else { return }

        // Find current position of dragged key
        var sourceRow: Int?
        var sourceIndex: Int?
        for (rIdx, row) in self.layout.enumerated() {
            if let kIdx = row.firstIndex(of: draggedKey) {
                sourceRow = rIdx
                sourceIndex = kIdx
                break
            }
        }

        // If key is already at end of this row, do nothing
        if sourceRow == self.rowIndex,
           sourceIndex == self.layout[self.rowIndex].count - 1
        {
            return
        }

        guard let srcRow = sourceRow, let srcIdx = sourceIndex else { return }

        withAnimation(.easeInOut(duration: 0.15)) {
            // Remove from source
            self.layout[srcRow].remove(at: srcIdx)

            // Ensure target row exists
            while self.layout.count <= self.rowIndex {
                self.layout.append([])
            }

            // Append to end of row
            self.layout[self.rowIndex].append(draggedKey)

            // Clean up empty rows
            self.layout = self.layout.filter { !$0.isEmpty }
            if self.layout.isEmpty {
                self.layout = [[]]
            }
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func validateDrop(info: DropInfo) -> Bool {
        self.draggedKey != nil
    }
}

/// Drop delegate for hidden section (removes key from layout)
private struct HiddenSectionDropDelegate: DropDelegate {
    @Binding var draggedKey: String?
    @Binding var layout: [[String]]

    func performDrop(info: DropInfo) -> Bool {
        self.draggedKey = nil
        return true
    }

    func dropEntered(info: DropInfo) {
        guard let draggedKey = self.draggedKey else { return }

        withAnimation(.easeInOut(duration: 0.15)) {
            // Remove the key from all rows
            for rowIndex in self.layout.indices {
                self.layout[rowIndex].removeAll { $0 == draggedKey }
            }

            // Clean up empty rows
            self.layout = self.layout.filter { !$0.isEmpty }
            if self.layout.isEmpty {
                self.layout = [[]]
            }
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func validateDrop(info: DropInfo) -> Bool {
        self.draggedKey != nil
    }
}

#Preview {
    Form {
        QuickKeysEditorView()
    }
    .formStyle(.grouped)
    .environment(QuickKeysService.shared)
}
