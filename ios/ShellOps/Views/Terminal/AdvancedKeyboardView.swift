import SwiftUI

private let logger = Logger(category: "AdvancedKeyboard")

/// Advanced keyboard view with special keys and control combinations
struct AdvancedKeyboardView: View {
    @Binding var isPresented: Bool
    let onInput: (String) -> Void

    @State private var showCtrlGrid = false
    @State private var sendWithEnter = true
    @State private var textInput = ""
    @FocusState private var isTextFieldFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Button("Done") {
                    self.isPresented = false
                }
                .foregroundColor(Theme.Colors.primaryAccent)

                Spacer()

                Text("Advanced Input")
                    .font(Theme.Typography.terminalSystem(size: 16))
                    .foregroundColor(Theme.Colors.terminalForeground)

                Spacer()

                Toggle("", isOn: self.$sendWithEnter)
                    .labelsHidden()
                    .toggleStyle(SwitchToggleStyle(tint: Theme.Colors.primaryAccent))
                    .scaleEffect(0.8)
                    .overlay(
                        Text(self.sendWithEnter ? "Send+Enter" : "Send")
                            .font(Theme.Typography.terminalSystem(size: 12))
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                            .offset(x: -60))
            }
            .padding()
            .background(Theme.Colors.cardBackground)

            Divider()
                .background(Theme.Colors.cardBorder)

            // Main content
            ScrollView {
                VStack(spacing: Theme.Spacing.large) {
                    // Text input section
                    VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                        Text("TEXT INPUT")
                            .font(Theme.Typography.terminalSystem(size: 10))
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                            .tracking(1)

                        HStack(spacing: Theme.Spacing.small) {
                            TextField("Enter text...", text: self.$textInput)
                                .textFieldStyle(RoundedBorderTextFieldStyle())
                                .font(Theme.Typography.terminalSystem(size: 16))
                                .focused(self.$isTextFieldFocused)
                                .submitLabel(.send)
                                .onSubmit {
                                    self.sendText()
                                }

                            Button(action: self.sendText) {
                                Text("Send")
                                    .font(Theme.Typography.terminalSystem(size: 14))
                                    .foregroundColor(Theme.Colors.terminalBackground)
                                    .padding(.horizontal, Theme.Spacing.medium)
                                    .padding(.vertical, Theme.Spacing.small)
                                    .background(Theme.Colors.primaryAccent)
                                    .cornerRadius(Theme.CornerRadius.small)
                            }
                            .disabled(self.textInput.isEmpty)
                        }
                    }
                    .padding(.horizontal)

                    // Special keys section
                    VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                        Text("SPECIAL KEYS")
                            .font(Theme.Typography.terminalSystem(size: 10))
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                            .tracking(1)
                            .padding(.horizontal)

                        LazyVGrid(columns: [
                            GridItem(.flexible()),
                            GridItem(.flexible()),
                            GridItem(.flexible()),
                            GridItem(.flexible()),
                        ], spacing: Theme.Spacing.small) {
                            SpecialKeyButton(label: "ESC", key: "\u{1B}", onPress: self.onInput)
                            SpecialKeyButton(label: "TAB", key: "\t", onPress: self.onInput)
                            SpecialKeyButton(label: "↑", key: "\u{1B}[A", onPress: self.onInput)
                            SpecialKeyButton(label: "↓", key: "\u{1B}[B", onPress: self.onInput)
                            SpecialKeyButton(label: "←", key: "\u{1B}[D", onPress: self.onInput)
                            SpecialKeyButton(label: "→", key: "\u{1B}[C", onPress: self.onInput)
                            SpecialKeyButton(label: "Home", key: "\u{1B}[H", onPress: self.onInput)
                            SpecialKeyButton(label: "End", key: "\u{1B}[F", onPress: self.onInput)
                            SpecialKeyButton(label: "PgUp", key: "\u{1B}[5~", onPress: self.onInput)
                            SpecialKeyButton(label: "PgDn", key: "\u{1B}[6~", onPress: self.onInput)
                            SpecialKeyButton(label: "Del", key: "\u{7F}", onPress: self.onInput)
                            SpecialKeyButton(label: "Ins", key: "\u{1B}[2~", onPress: self.onInput)
                        }
                        .padding(.horizontal)
                    }

                    // Control combinations
                    VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                        HStack {
                            Text("CONTROL COMBINATIONS")
                                .font(Theme.Typography.terminalSystem(size: 10))
                                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                                .tracking(1)

                            Spacer()

                            Button {
                                withAnimation(Theme.Animation.smooth) {
                                    self.showCtrlGrid.toggle()
                                }
                            } label: {
                                Image(systemName: self.showCtrlGrid ? "chevron.up" : "chevron.down")
                                    .font(.system(size: 12))
                                    .foregroundColor(Theme.Colors.primaryAccent)
                            }
                        }
                        .padding(.horizontal)

                        if self.showCtrlGrid {
                            LazyVGrid(columns: [
                                GridItem(.flexible()),
                                GridItem(.flexible()),
                                GridItem(.flexible()),
                                GridItem(.flexible()),
                                GridItem(.flexible()),
                            ], spacing: Theme.Spacing.small) {
                                ForEach(Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ"), id: \.self) { char in
                                    CtrlKeyButton(char: String(char)) { key in
                                        self.onInput(key)
                                        HapticFeedback.impact(.light)
                                    }
                                }
                            }
                            .padding(.horizontal)
                            .transition(.asymmetric(
                                insertion: .scale(scale: 0.95).combined(with: .opacity),
                                removal: .scale(scale: 0.95).combined(with: .opacity)))
                        }
                    }

                    // Function keys
                    VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                        Text("FUNCTION KEYS")
                            .font(Theme.Typography.terminalSystem(size: 10))
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
                            .tracking(1)
                            .padding(.horizontal)

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: Theme.Spacing.small) {
                                ForEach(1...12, id: \.self) { num in
                                    FunctionKeyButton(number: num) { key in
                                        self.onInput(key)
                                        HapticFeedback.impact(.light)
                                    }
                                }
                            }
                            .padding(.horizontal)
                        }
                    }
                }
                .padding(.vertical)
            }
            .background(Theme.Colors.terminalBackground)
        }
        .onAppear {
            self.isTextFieldFocused = true
        }
    }

    private func sendText() {
        guard !self.textInput.isEmpty else { return }

        if self.sendWithEnter {
            self.onInput(self.textInput + "\n")
        } else {
            self.onInput(self.textInput)
        }

        self.textInput = ""
        HapticFeedback.impact(.light)
    }
}

/// Special key button component
/// Button component for special terminal keys.
/// Renders keys like Tab, Esc with consistent styling and tap feedback.
struct SpecialKeyButton: View {
    let label: String
    let key: String
    let onPress: (String) -> Void

    var body: some View {
        Button(action: {
            self.onPress(self.key)
            HapticFeedback.impact(.light)
        }, label: {
            Text(self.label)
                .font(Theme.Typography.terminalSystem(size: 14))
                .foregroundColor(Theme.Colors.terminalForeground)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(Theme.Colors.cardBackground)
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                        .stroke(Theme.Colors.cardBorder, lineWidth: 1))
                .cornerRadius(Theme.CornerRadius.small)
        })
    }
}

/// Control key combination button
/// Button component for Ctrl key combinations.
/// Displays the key combination and sends appropriate control sequences.
struct CtrlKeyButton: View {
    let char: String
    let onPress: (String) -> Void

    var body: some View {
        Button(action: {
            // Calculate control character (Ctrl+A = 1, Ctrl+B = 2, etc.)
            if let scalar = char.unicodeScalars.first,
               let ctrlScalar = UnicodeScalar(scalar.value - 64)
            {
                let ctrlChar = Character(ctrlScalar)
                self.onPress(String(ctrlChar))
            }
        }, label: {
            Text("^" + self.char)
                .font(Theme.Typography.terminalSystem(size: 12))
                .foregroundColor(Theme.Colors.terminalForeground)
                .frame(width: 50, height: 40)
                .background(Theme.Colors.cardBackground)
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                        .stroke(Theme.Colors.cardBorder, lineWidth: 1))
                .cornerRadius(Theme.CornerRadius.small)
        })
    }
}

/// Function key button
/// Button component for function keys (F1-F12).
/// Provides access to function key inputs with visual feedback.
struct FunctionKeyButton: View {
    let number: Int
    let onPress: (String) -> Void

    private var escapeSequence: String {
        switch self.number {
        case 1: "\u{1B}OP" // F1
        case 2: "\u{1B}OQ" // F2
        case 3: "\u{1B}OR" // F3
        case 4: "\u{1B}OS" // F4
        case 5: "\u{1B}[15~" // F5
        case 6: "\u{1B}[17~" // F6
        case 7: "\u{1B}[18~" // F7
        case 8: "\u{1B}[19~" // F8
        case 9: "\u{1B}[20~" // F9
        case 10: "\u{1B}[21~" // F10
        case 11: "\u{1B}[23~" // F11
        case 12: "\u{1B}[24~" // F12
        default: ""
        }
    }

    var body: some View {
        Button(action: {
            self.onPress(self.escapeSequence)
        }, label: {
            Text("F\(self.number)")
                .font(Theme.Typography.terminalSystem(size: 12))
                .foregroundColor(Theme.Colors.terminalForeground)
                .frame(width: 50, height: 40)
                .background(Theme.Colors.cardBackground)
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                        .stroke(Theme.Colors.cardBorder, lineWidth: 1))
                .cornerRadius(Theme.CornerRadius.small)
        })
    }
}

#Preview {
    AdvancedKeyboardView(isPresented: .constant(true)) { input in
        logger.debug("Input: \(input)")
    }
}
