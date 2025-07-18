import SwiftUI

/// Sheet for selecting terminal width presets.
///
/// Provides common terminal width options (80, 100, 120, 132, 160 columns)
/// with descriptions of their typical use cases.
struct TerminalWidthSheet: View {
    @Binding var selectedWidth: Int?
    let isResizeBlockedByServer: Bool
    @Environment(\.dismiss)
    var dismiss
    @State private var showCustomInput = false
    @State private var customWidthText = ""
    @FocusState private var isCustomInputFocused: Bool

    struct WidthPreset {
        let columns: Int
        let name: String
        let description: String
        let icon: String
    }

    let widthPresets: [WidthPreset] = [
        WidthPreset(
            columns: 80,
            name: "Classic",
            description: "Traditional terminal width, ideal for legacy apps",
            icon: "rectangle.split.3x1"
        ),
        WidthPreset(
            columns: 100,
            name: "Comfortable",
            description: "Good balance for modern development",
            icon: "rectangle.split.3x1.fill"
        ),
        WidthPreset(
            columns: 120,
            name: "Standard",
            description: "Common IDE and editor width",
            icon: "rectangle.3.offgrid"
        ),
        WidthPreset(
            columns: 132,
            name: "Wide",
            description: "DEC VT100 wide mode, great for logs",
            icon: "rectangle.3.offgrid.fill"
        ),
        WidthPreset(
            columns: 160,
            name: "Ultra Wide",
            description: "Maximum visibility for complex output",
            icon: "rectangle.grid.3x2"
        )
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Spacing.large) {
                    // Show warning if resizing is blocked
                    if isResizeBlockedByServer {
                        HStack(spacing: Theme.Spacing.small) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 14))
                                .foregroundColor(Theme.Colors.warningAccent)

                            Text("Terminal resizing is disabled by the server")
                                .font(.caption)
                                .foregroundColor(Theme.Colors.terminalForeground)
                        }
                        .padding()
                        .background(
                            RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                .fill(Theme.Colors.warningAccent.opacity(0.1))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                .stroke(Theme.Colors.warningAccent.opacity(0.3), lineWidth: 1)
                        )
                        .padding(.horizontal)
                        .padding(.top)
                    }

                    // Info header
                    HStack(spacing: Theme.Spacing.small) {
                        Image(systemName: "info.circle")
                            .font(.system(size: 14))
                            .foregroundColor(Theme.Colors.primaryAccent)

                        Text("Terminal width determines how many characters fit on each line")
                            .font(.caption)
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                    }
                    .padding(.horizontal)
                    .padding(.top, isResizeBlockedByServer ? 0 : nil)

                    // Width presets
                    VStack(spacing: Theme.Spacing.medium) {
                        ForEach(widthPresets, id: \.columns) { preset in
                            Button {
                                if !isResizeBlockedByServer {
                                    selectedWidth = preset.columns
                                    HapticFeedback.impact(.light)
                                    dismiss()
                                }
                            } label: {
                                HStack(spacing: Theme.Spacing.medium) {
                                    // Icon
                                    Image(systemName: preset.icon)
                                        .font(.system(size: 24))
                                        .foregroundColor(Theme.Colors.primaryAccent)
                                        .frame(width: 40)

                                    // Text content
                                    VStack(alignment: .leading, spacing: Theme.Spacing.extraSmall) {
                                        HStack {
                                            Text(preset.name)
                                                .font(.headline)
                                                .foregroundColor(Theme.Colors.terminalForeground)

                                            Text("\(preset.columns) columns")
                                                .font(.caption)
                                                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                                        }

                                        Text(preset.description)
                                            .font(.caption)
                                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                                            .fixedSize(horizontal: false, vertical: true)
                                    }

                                    Spacer()

                                    // Selection indicator
                                    if selectedWidth == preset.columns {
                                        Image(systemName: "checkmark.circle.fill")
                                            .font(.system(size: 20))
                                            .foregroundColor(Theme.Colors.successAccent)
                                    }
                                }
                                .padding()
                                .background(
                                    RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                                        .fill(selectedWidth == preset.columns
                                            ? Theme.Colors.primaryAccent.opacity(0.1)
                                            : Theme.Colors.cardBorder.opacity(0.1)
                                        )
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                                        .stroke(
                                            selectedWidth == preset.columns
                                                ? Theme.Colors.primaryAccent
                                                : Theme.Colors.cardBorder,
                                            lineWidth: 1
                                        )
                                )
                            }
                            .buttonStyle(PlainButtonStyle())
                            .disabled(isResizeBlockedByServer)
                            .opacity(isResizeBlockedByServer ? 0.5 : 1.0)
                        }
                    }
                    .padding(.horizontal)

                    // Custom width option
                    VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                        Text("CUSTOM WIDTH")
                            .font(Theme.Typography.terminalSystem(size: 10))
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                            .tracking(1)
                            .padding(.horizontal)

                        if showCustomInput {
                            // Custom input field
                            HStack(spacing: Theme.Spacing.small) {
                                TextField("20-500", text: $customWidthText)
                                    .keyboardType(.numberPad)
                                    .textFieldStyle(RoundedBorderTextFieldStyle())
                                    .font(Theme.Typography.terminalSystem(size: 16))
                                    .focused($isCustomInputFocused)
                                    .onSubmit {
                                        applyCustomWidth()
                                    }

                                Text("columns")
                                    .font(Theme.Typography.terminalSystem(size: 14))
                                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))

                                Button(action: applyCustomWidth) {
                                    Text("Apply")
                                        .font(Theme.Typography.terminalSystem(size: 14))
                                        .foregroundColor(Theme.Colors.terminalBackground)
                                        .padding(.horizontal, Theme.Spacing.medium)
                                        .padding(.vertical, Theme.Spacing.small)
                                        .background(Theme.Colors.primaryAccent)
                                        .cornerRadius(Theme.CornerRadius.small)
                                }
                                .disabled(customWidthText.isEmpty)
                            }
                            .padding()
                            .background(
                                RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                                    .fill(Theme.Colors.cardBorder.opacity(0.1))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                                    .stroke(Theme.Colors.cardBorder, lineWidth: 1)
                            )
                            .padding(.horizontal)
                            .transition(.asymmetric(
                                insertion: .scale(scale: 0.95).combined(with: .opacity),
                                removal: .scale(scale: 0.95).combined(with: .opacity)
                            ))
                            .onAppear {
                                if let width = selectedWidth {
                                    customWidthText = "\(width)"
                                }
                                isCustomInputFocused = true
                            }
                        } else {
                            // Show custom button
                            Button {
                                if !isResizeBlockedByServer {
                                    withAnimation(Theme.Animation.smooth) {
                                        showCustomInput = true
                                    }
                                }
                            } label: {
                                HStack {
                                    Image(systemName: "textformat.123")
                                        .font(.system(size: 20))
                                        .foregroundColor(Theme.Colors.primaryAccent)

                                    Text("Custom width (20-500 columns)")
                                        .font(.subheadline)
                                        .foregroundColor(Theme.Colors.terminalForeground)

                                    Spacer()

                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 14))
                                        .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                                }
                                .padding()
                                .background(
                                    RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                                        .fill(Theme.Colors.cardBorder.opacity(0.1))
                                )
                                .overlay(
                                    RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                                        .stroke(Theme.Colors.cardBorder, lineWidth: 1)
                                )
                            }
                            .buttonStyle(PlainButtonStyle())
                            .disabled(isResizeBlockedByServer)
                            .opacity(isResizeBlockedByServer ? 0.5 : 1.0)
                            .padding(.horizontal)
                        }
                    }

                    Spacer(minLength: Theme.Spacing.large)
                }
            }
            .background(Theme.Colors.cardBackground)
            .navigationTitle("Terminal Width")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }
            }
        }
    }

    private func applyCustomWidth() {
        guard let width = Int(customWidthText) else { return }

        // Clamp to valid range (20-500)
        let clampedWidth = max(20, min(500, width))

        if !isResizeBlockedByServer {
            selectedWidth = clampedWidth
            HapticFeedback.impact(.medium)
            dismiss()
        }
    }
}

#Preview {
    TerminalWidthSheet(selectedWidth: .constant(80), isResizeBlockedByServer: false)
}
