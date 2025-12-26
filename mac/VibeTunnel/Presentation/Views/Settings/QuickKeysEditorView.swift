import SwiftUI

/// Editor view for customizing quick keys layout with drag-and-drop
struct QuickKeysEditorView: View {
    @Environment(QuickKeysService.self) private var service
    @State private var layout: [[String]] = []
    @State private var draggedKey: String?

    private let mobilePreviewWidth: CGFloat = 440

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 16) {
                Text("Configure the shortcuts shown above the keyboard on mobile devices.")
                    .font(.callout)
                    .foregroundStyle(.secondary)

                // Keyboard preview
                VStack(spacing: 4) {
                    ForEach(Array(self.layout.enumerated()), id: \.offset) { rowIndex, row in
                        HStack(spacing: 2) {
                            ForEach(Array(row.enumerated()), id: \.element) { keyIndex, key in
                                if let def = QuickKeysData.definition(for: key) {
                                    KeyTile(label: def.label, isDragging: self.draggedKey == key, flexGrow: true)
                                        .onDrag {
                                            self.draggedKey = key
                                            return NSItemProvider(object: key as NSString)
                                        }
                                        .onDrop(of: [.text], delegate: KeyDrop(
                                            rowIndex: rowIndex,
                                            keyIndex: keyIndex,
                                            draggedKey: self.$draggedKey,
                                            layout: self.$layout))
                                }
                            }
                        }
                    }

                    if self.layout.last?.isEmpty == false {
                        Button { self.layout.append([]) } label: {
                            Label("Add Row", systemImage: "plus")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .padding(.top, 4)
                    }
                }
                .padding(12)
                .frame(width: self.mobilePreviewWidth)
                .background(Color(nsColor: .windowBackgroundColor))
                .cornerRadius(12)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(nsColor: .separatorColor)))
                .frame(maxWidth: .infinity)

                // Hidden keys
                VStack(alignment: .leading, spacing: 8) {
                    Text("Hidden Keys").font(.subheadline).foregroundStyle(.secondary)

                    Group {
                        if self.hiddenKeys.isEmpty {
                            Text("All keys visible. Drag here to hide.")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                                .padding()
                                .frame(maxWidth: .infinity)
                        } else {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 40))], spacing: 4) {
                                ForEach(self.hiddenKeys) { key in
                                    KeyTile(label: key.label, isDragging: self.draggedKey == key.key)
                                        .onDrag {
                                            self.draggedKey = key.key
                                            return NSItemProvider(object: key.key as NSString)
                                        }
                                        .onTapGesture { self.addToLastRow(key.key) }
                                }
                            }
                            .padding()
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 40)
                    .background(Color(nsColor: .controlBackgroundColor))
                    .cornerRadius(8)
                    .onDrop(of: [.text], delegate: HiddenDrop(
                        draggedKey: self.$draggedKey,
                        layout: self.$layout))
                }

                // Presets
                HStack(spacing: 8) {
                    Text("Presets")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    Button {
                        self.layout = QuickKeysData.defaultLayout
                        self.service.save(self.layout)
                    } label: {
                        Text("Default")
                            .font(.callout)
                    }
                    .buttonStyle(.accessoryBar)

                    ForEach(QuickKeysData.presets) { preset in
                        Button {
                            self.layout = preset.layout
                            self.service.save(self.layout)
                        } label: {
                            HStack(spacing: 4) {
                                PresetIcon(presetId: preset.id)
                                Text(preset.name)
                            }
                            .font(.callout)
                        }
                        .buttonStyle(.accessoryBar)
                    }

                    Spacer()
                }
            }
        } header: {
            Text("Quick Keys Layout").font(.headline)
        } footer: {
            Text("Changes saved automatically.").font(.caption).foregroundStyle(.secondary)
        }
        .onAppear {
            self.layout = self.service.layout
            Task {
                await self.service.load()
                self.layout = self.service.layout
            }
        }
        .onChange(of: self.draggedKey) { old, new in
            if old != nil, new == nil {
                self.service.save(self.layout)
            }
        }

    }

    private var hiddenKeys: [QuickKeyDefinition] {
        let used = Set(self.layout.flatMap { $0 })
        return QuickKeysData.allKeys.filter { !used.contains($0.key) }
    }

    private func addToLastRow(_ key: String) {
        if self.layout.isEmpty {
            self.layout = [[key]]
        } else {
            self.layout[self.layout.count - 1].append(key)
        }
        self.service.save(self.layout)
    }
}

// MARK: - Preset Icon

private struct PresetIcon: View {
    let presetId: String

    var body: some View {
        Group {
            switch self.presetId {
            case "claude":
                Image("ClaudeIcon")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            case "opencode":
                Image("OpenCodeIcon")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            default:
                Image(systemName: "keyboard")
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: 14, height: 14)
    }
}

// MARK: - Key Tile

private struct KeyTile: View {
    let label: String
    let isDragging: Bool
    var flexGrow: Bool = false

    var body: some View {
        Text(self.label)
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .lineLimit(1)
            .padding(.horizontal, 5)
            .padding(.vertical, 4)
            .frame(maxWidth: self.flexGrow ? .infinity : 44, minHeight: 24)
            .background(RoundedRectangle(cornerRadius: 4).fill(Color(nsColor: .controlColor)))
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(nsColor: .separatorColor), lineWidth: 0.5))
            .opacity(self.isDragging ? 0.3 : 1)
    }
}

// MARK: - Drop Delegates

private struct KeyDrop: DropDelegate {
    let rowIndex: Int
    let keyIndex: Int
    @Binding var draggedKey: String?
    @Binding var layout: [[String]]

    func performDrop(info: DropInfo) -> Bool {
        self.draggedKey = nil
        return true
    }

    func dropEntered(info: DropInfo) {
        guard let key = self.draggedKey else { return }

        // Find source position
        for (r, row) in self.layout.enumerated() {
            if let k = row.firstIndex(of: key) {
                // Skip if already at target
                var targetIdx = self.keyIndex
                if r == self.rowIndex, k < self.keyIndex { targetIdx -= 1 }
                if r == self.rowIndex, k == targetIdx { return }

                // Move
                withAnimation(.easeInOut(duration: 0.12)) {
                    self.layout[r].remove(at: k)
                    self.layout[self.rowIndex].insert(key, at: min(targetIdx, self.layout[self.rowIndex].count))
                    self.layout.removeAll { $0.isEmpty }
                    if self.layout.isEmpty { self.layout = [[]] }
                }
                return
            }
        }

        // From hidden section
        withAnimation(.easeInOut(duration: 0.12)) {
            self.layout[self.rowIndex].insert(key, at: self.keyIndex)
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }
    func validateDrop(info: DropInfo) -> Bool { self.draggedKey != nil }
}

private struct HiddenDrop: DropDelegate {
    @Binding var draggedKey: String?
    @Binding var layout: [[String]]

    func performDrop(info: DropInfo) -> Bool {
        self.draggedKey = nil
        return true
    }

    func dropEntered(info: DropInfo) {
        guard let key = self.draggedKey,
              self.layout.contains(where: { $0.contains(key) }) else { return }

        withAnimation(.easeInOut(duration: 0.12)) {
            for i in self.layout.indices { self.layout[i].removeAll { $0 == key } }
            self.layout.removeAll { $0.isEmpty }
            if self.layout.isEmpty { self.layout = [[]] }
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }
    func validateDrop(info: DropInfo) -> Bool { self.draggedKey != nil }
}



#Preview {
    Form { QuickKeysEditorView() }
        .formStyle(.grouped)
        .environment(QuickKeysService.shared)
}
