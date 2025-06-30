import SwiftUI

/// Popover for selecting terminal width presets
struct WidthSelectorPopover: View {
    @Binding var currentWidth: TerminalWidth
    @Binding var isPresented: Bool
    @State private var customWidth: String = ""
    @State private var showCustomInput = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(TerminalWidth.allCases, id: \.value) { width in
                        WidthPresetRow(
                            width: width,
                            isSelected: currentWidth.value == width.value
                        ) {
                            currentWidth = width
                            HapticFeedback.impact(.light)
                            isPresented = false
                        }
                    }
                }

                Section {
                    Button(action: {
                        showCustomInput = true
                    }, label: {
                        HStack {
                            Image(systemName: "square.and.pencil")
                                .font(.system(size: 16))
                                .foregroundColor(Theme.Colors.primaryAccent)
                            Text("Custom Width...")
                                .font(.body)
                                .foregroundColor(Theme.Colors.terminalForeground)
                            Spacer()
                        }
                        .padding(.vertical, 4)
                    })
                }

                // Show recent custom widths if any
                let customWidths = TerminalWidthManager.shared.customWidths
                if !customWidths.isEmpty {
                    Section(header: Text("Recent Custom Widths")
                        .font(.caption)
                        .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                    ) {
                        ForEach(customWidths, id: \.self) { width in
                            WidthPresetRow(
                                width: .custom(width),
                                isSelected: currentWidth.value == width && !currentWidth.isPreset
                            ) {
                                currentWidth = .custom(width)
                                HapticFeedback.impact(.light)
                                isPresented = false
                            }
                        }
                    }
                }
            }
            .listStyle(InsetGroupedListStyle())
            .navigationTitle("Terminal Width")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        isPresented = false
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }
            }
        }
        .frame(width: 320, height: 400)
        .sheet(isPresented: $showCustomInput) {
            CustomWidthSheet(
                customWidth: $customWidth
            ) { width in
                if let intWidth = Int(width), intWidth >= 20 && intWidth <= 500 {
                    currentWidth = .custom(intWidth)
                    TerminalWidthManager.shared.addCustomWidth(intWidth)
                    HapticFeedback.notification(.success)
                    showCustomInput = false
                    isPresented = false
                }
            }
        }
    }
}

/// Row for displaying a width preset option
private struct WidthPresetRow: View {
    let width: TerminalWidth
    let isSelected: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(width.label)
                            .font(Theme.Typography.terminalSystem(size: 16))
                            .fontWeight(.medium)
                            .foregroundColor(Theme.Colors.terminalForeground)

                        if width.value > 0 {
                            Text("columns")
                                .font(.caption)
                                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                        }
                    }

                    Text(width.description)
                        .font(.caption)
                        .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                }

                Spacer()

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundColor(Theme.Colors.primaryAccent)
                }
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

/// Sheet for entering a custom width value
private struct CustomWidthSheet: View {
    @Binding var customWidth: String
    let onSave: (String) -> Void
    @Environment(\.dismiss)
    var dismiss
    @FocusState private var isFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: Theme.Spacing.large) {
                Text("Enter a custom terminal width between 20 and 500 columns")
                    .font(.body)
                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                HStack {
                    TextField("Width", text: $customWidth)
                        .font(Theme.Typography.terminalSystem(size: 24))
                        .foregroundColor(Theme.Colors.terminalForeground)
                        .multilineTextAlignment(.center)
                        .keyboardType(.numberPad)
                        .focused($isFocused)
                        .frame(width: 120)
                        .padding()
                        .background(Theme.Colors.cardBackground)
                        .cornerRadius(Theme.CornerRadius.medium)

                    Text("columns")
                        .font(.body)
                        .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                }

                Spacer()
            }
            .padding(.top, Theme.Spacing.extraLarge)
            .navigationTitle("Custom Width")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        onSave(customWidth)
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                    .disabled(customWidth.isEmpty)
                }
            }
        }
        .onAppear {
            isFocused = true
        }
    }
}
