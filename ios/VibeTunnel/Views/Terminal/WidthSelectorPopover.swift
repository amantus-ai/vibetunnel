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
                            isSelected: self.currentWidth.value == width.value)
                        {
                            self.currentWidth = width
                            HapticFeedback.impact(.light)
                            self.isPresented = false
                        }
                    }
                }

                Section {
                    Button(action: {
                        self.showCustomInput = true
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
                    Section(
                        header: Text("Recent Custom Widths")
                            .font(.caption)
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7)))
                    {
                        ForEach(customWidths, id: \.self) { width in
                            WidthPresetRow(
                                width: .custom(width),
                                isSelected: self.currentWidth.value == width && !self.currentWidth.isPreset)
                            {
                                self.currentWidth = .custom(width)
                                HapticFeedback.impact(.light)
                                self.isPresented = false
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
                        self.isPresented = false
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }
            }
        }
        .frame(width: 320, height: 400)
        .sheet(isPresented: self.$showCustomInput) {
            CustomWidthSheet(
                customWidth: self.$customWidth)
            { width in
                if let intWidth = Int(width), intWidth >= 20, intWidth <= 500 {
                    self.currentWidth = .custom(intWidth)
                    TerminalWidthManager.shared.addCustomWidth(intWidth)
                    HapticFeedback.notification(.success)
                    self.showCustomInput = false
                    self.isPresented = false
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
        Button(action: self.onSelect) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(self.width.label)
                            .font(Theme.Typography.terminalSystem(size: 16))
                            .fontWeight(.medium)
                            .foregroundColor(Theme.Colors.terminalForeground)

                        if self.width.value > 0 {
                            Text("columns")
                                .font(.caption)
                                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                        }
                    }

                    Text(self.width.description)
                        .font(.caption)
                        .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                }

                Spacer()

                if self.isSelected {
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
                    TextField("Width", text: self.$customWidth)
                        .font(Theme.Typography.terminalSystem(size: 24))
                        .foregroundColor(Theme.Colors.terminalForeground)
                        .multilineTextAlignment(.center)
                        .keyboardType(.numberPad)
                        .focused(self.$isFocused)
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
                        self.dismiss()
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        self.onSave(self.customWidth)
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                    .disabled(self.customWidth.isEmpty)
                }
            }
        }
        .onAppear {
            self.isFocused = true
        }
    }
}
