import SwiftUI

/// Compact terminal toolbar with Termius-style special keys.
///
/// Provides a single row of commonly used terminal keys:
/// `esc | tab | ctrl | alt | / | | | ~ | - | ^C | ^I`
///
/// The `ctrl` and `alt` keys are toggleable modifiers that affect
/// the next key press, then auto-deactivate.
struct TerminalToolbar: View {
    let onSpecialKey: (TerminalInput.SpecialKey) -> Void
    let onDismissKeyboard: () -> Void
    let onRawInput: ((String) -> Void)?
    let onDictation: () -> Void

    @State private var ctrlActive = false

    init(
        onSpecialKey: @escaping (TerminalInput.SpecialKey) -> Void,
        onDismissKeyboard: @escaping () -> Void,
        onRawInput: ((String) -> Void)? = nil,
        onDictation: @escaping () -> Void = {})
    {
        self.onSpecialKey = onSpecialKey
        self.onDismissKeyboard = onDismissKeyboard
        self.onRawInput = onRawInput
        self.onDictation = onDictation
    }

    var body: some View {
        VStack(spacing: 0) {
            Divider()
                .background(Theme.Colors.cardBorder)

            HStack(spacing: Theme.Spacing.extraSmall) {
                // ESC
                CompactKeyButton(label: "esc") {
                    self.sendKey(.escape)
                }

                // TAB
                CompactKeyButton(label: "tab") {
                    self.sendKey(.tab)
                }

                // Divider
                KeyDivider()

                // CTRL (modifier toggle)
                CompactKeyButton(label: "ctrl", isActive: self.ctrlActive) {
                    self.toggleCtrl()
                }

                // Divider
                KeyDivider()

                // Arrow keys
                CompactKeyButton(label: "←", width: 36) {
                    self.sendKey(.arrowLeft)
                }

                CompactKeyButton(label: "↑", width: 36) {
                    self.sendKey(.arrowUp)
                }

                CompactKeyButton(label: "↓", width: 36) {
                    self.sendKey(.arrowDown)
                }

                CompactKeyButton(label: "→", width: 36) {
                    self.sendKey(.arrowRight)
                }

                Spacer()

                // Mic button - opens dictation modal
                CompactKeyButton(systemImage: "mic.fill") {
                    HapticFeedback.impact(.light)
                    self.onDictation()
                }

                // Keyboard dismiss button
                CompactKeyButton(systemImage: "keyboard.chevron.compact.down") {
                    HapticFeedback.impact(.light)
                    self.onDismissKeyboard()
                }
            }
            .padding(.horizontal, Theme.Spacing.small)
            .frame(height: 44)
            .background(Theme.Colors.cardBackground)
        }
        .background(Theme.Colors.cardBackground.edgesIgnoringSafeArea(.bottom))
    }

    // MARK: - Key Handling

    private func sendKey(_ key: TerminalInput.SpecialKey) {
        HapticFeedback.impact(.light)

        if self.ctrlActive {
            // Modifiers affect the key differently based on type
            // For now, just send the key and reset modifiers
            self.onSpecialKey(key)
            self.ctrlActive = false
        } else {
            self.onSpecialKey(key)
        }
    }

    private func toggleCtrl() {
        HapticFeedback.impact(.medium)
        self.ctrlActive.toggle()
    }
}

// MARK: - Components

/// Compact key button for the toolbar.
private struct CompactKeyButton: View {
    let label: String?
    let systemImage: String?
    let width: CGFloat?
    let isActive: Bool
    let action: () -> Void

    init(
        label: String? = nil,
        systemImage: String? = nil,
        width: CGFloat? = nil,
        isActive: Bool = false,
        action: @escaping () -> Void)
    {
        self.label = label
        self.systemImage = systemImage
        self.width = width
        self.isActive = isActive
        self.action = action
    }

    var body: some View {
        Button(action: self.action) {
            Group {
                if let label {
                    Text(label)
                        .font(Theme.Typography.terminalSystem(size: 13, weight: .medium))
                } else if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 14, weight: .medium))
                }
            }
            .foregroundColor(self.isActive ? Theme.Colors.primaryAccent : Theme.Colors.terminalForeground)
            .frame(width: self.width ?? 40, height: 36)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(
                        self.isActive
                            ? Theme.Colors.primaryAccent.opacity(0.2)
                            : Theme.Colors.cardBorder.opacity(0.3)))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(
                        self.isActive ? Theme.Colors.primaryAccent : Theme.Colors.cardBorder.opacity(0.5),
                        lineWidth: self.isActive ? 1.5 : 1))
        }
        .buttonStyle(PlainButtonStyle())
    }
}

/// Visual divider between key groups.
private struct KeyDivider: View {
    var body: some View {
        Rectangle()
            .fill(Theme.Colors.cardBorder)
            .frame(width: 1, height: 24)
            .padding(.horizontal, Theme.Spacing.extraSmall)
    }
}

// MARK: - Voice Input Bar

/// Floating input bar that appears above the keyboard.
/// Grows with text, has Clear and Submit buttons.
struct VoiceInputBar: View {
    @Binding var text: String
    @Binding var isVisible: Bool
    let onSubmit: (String) -> Void  // Now passes the text to send
    let onClose: () -> Void  // Called when bar closes to refocus terminal
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            Divider()

            HStack(spacing: 8) {
                // Text field - grows with content
                TextField("Dictate or type command...", text: self.$text, axis: .vertical)
                    .font(.system(.body, design: .monospaced))
                    .lineLimit(1...5)
                    .focused(self.$isFocused)
                    .submitLabel(.send)
                    .onSubmit {
                        self.submit()
                    }
                    .padding(8)
                    .background(Color(.systemGray6))
                    .cornerRadius(8)

                // Clear button
                if !self.text.isEmpty {
                    Button(action: { self.text = "" }) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 20))
                            .foregroundColor(.gray)
                    }
                }

                // Submit button
                Button(action: self.submit) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 28))
                        .foregroundColor(self.text.isEmpty ? .gray : .blue)
                }
                .disabled(self.text.isEmpty)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(.systemBackground))
        }
        .onAppear {
            self.isFocused = true
        }
    }

    private func submit() {
        let textToSend = self.text
        if !textToSend.isEmpty {
            self.onSubmit(textToSend)
            self.text = ""
            self.isVisible = false
            self.onClose()  // Refocus terminal to keep keyboard
        }
    }
}

#Preview {
    VStack {
        Spacer()
        TerminalToolbar(
            onSpecialKey: { key in
                print("Key: \(key)")
            },
            onDismissKeyboard: {
                print("Dismiss keyboard")
            },
            onRawInput: { input in
                print("Raw: \(input)")
            },
            onDictation: {
                print("Dictation")
            })
    }
    .background(Theme.Colors.terminalBackground)
}
