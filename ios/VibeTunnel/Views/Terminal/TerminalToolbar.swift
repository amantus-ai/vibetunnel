import SwiftUI

/// Toolbar providing quick access to special terminal keys.
///
/// Displays commonly used terminal keys like Tab, Ctrl, arrows, and
/// provides access to additional keys through an expandable menu.
struct TerminalToolbar: View {
    let onSpecialKey: (TerminalInput.SpecialKey) -> Void
    let onDismissKeyboard: () -> Void
    let onRawInput: ((String) -> Void)?
    @State private var showMoreKeys = false
    @State private var showAdvancedKeyboard = false

    init(
        onSpecialKey: @escaping (TerminalInput.SpecialKey) -> Void,
        onDismissKeyboard: @escaping () -> Void,
        onRawInput: ((String) -> Void)? = nil)
    {
        self.onSpecialKey = onSpecialKey
        self.onDismissKeyboard = onDismissKeyboard
        self.onRawInput = onRawInput
    }

    var body: some View {
        VStack(spacing: 0) {
            Divider()
                .background(Theme.Colors.cardBorder)

            HStack(spacing: Theme.Spacing.extraSmall) {
                // Tab key
                ToolbarButton(label: "⇥") {
                    HapticFeedback.impact(.light)
                    self.onSpecialKey(.tab)
                }

                // Arrow keys
                HStack(spacing: 2) {
                    ToolbarButton(label: "←", width: 35) {
                        HapticFeedback.impact(.light)
                        self.onSpecialKey(.arrowLeft)
                    }

                    VStack(spacing: 2) {
                        ToolbarButton(label: "↑", width: 35, height: 20) {
                            HapticFeedback.impact(.light)
                            self.onSpecialKey(.arrowUp)
                        }
                        ToolbarButton(label: "↓", width: 35, height: 20) {
                            HapticFeedback.impact(.light)
                            self.onSpecialKey(.arrowDown)
                        }
                    }

                    ToolbarButton(label: "→", width: 35) {
                        HapticFeedback.impact(.light)
                        self.onSpecialKey(.arrowRight)
                    }
                }

                // ESC key
                ToolbarButton(label: "ESC") {
                    HapticFeedback.impact(.light)
                    self.onSpecialKey(.escape)
                }

                // More keys toggle
                ToolbarButton(
                    label: "•••",
                    isActive: self.showMoreKeys)
                {
                    HapticFeedback.impact(.light)
                    withAnimation(Theme.Animation.quick) {
                        self.showMoreKeys.toggle()
                    }
                }

                Spacer()

                // Advanced keyboard
                ToolbarButton(systemImage: "keyboard") {
                    HapticFeedback.impact(.light)
                    self.showAdvancedKeyboard = true
                }

                // Dismiss keyboard
                ToolbarButton(systemImage: "keyboard.chevron.compact.down") {
                    HapticFeedback.impact(.light)
                    self.onDismissKeyboard()
                }
            }
            .padding(.horizontal, Theme.Spacing.small)
            .padding(.vertical, Theme.Spacing.extraSmall)
            .background(Theme.Colors.cardBackground)

            // Extended toolbar
            if self.showMoreKeys {
                Divider()
                    .background(Theme.Colors.cardBorder)

                VStack(spacing: Theme.Spacing.extraSmall) {
                    // First row of control keys
                    HStack(spacing: Theme.Spacing.extraSmall) {
                        ToolbarButton(label: "CTRL+A") {
                            HapticFeedback.impact(.medium)
                            self.onSpecialKey(.ctrlA)
                        }

                        ToolbarButton(label: "CTRL+C") {
                            HapticFeedback.impact(.medium)
                            self.onSpecialKey(.ctrlC)
                        }

                        ToolbarButton(label: "CTRL+D") {
                            HapticFeedback.impact(.medium)
                            self.onSpecialKey(.ctrlD)
                        }

                        ToolbarButton(label: "CTRL+E") {
                            HapticFeedback.impact(.medium)
                            self.onSpecialKey(.ctrlE)
                        }
                    }

                    // Second row of control keys
                    HStack(spacing: Theme.Spacing.extraSmall) {
                        ToolbarButton(label: "CTRL+L") {
                            HapticFeedback.impact(.medium)
                            self.onSpecialKey(.ctrlL)
                        }

                        ToolbarButton(label: "CTRL+Z") {
                            HapticFeedback.impact(.medium)
                            self.onSpecialKey(.ctrlZ)
                        }

                        ToolbarButton(label: "⏎") {
                            HapticFeedback.impact(.light)
                            self.onSpecialKey(.enter)
                        }

                        ToolbarButton(label: "HOME") {
                            HapticFeedback.impact(.light)
                            // Send Ctrl+A for home
                            self.onSpecialKey(.ctrlA)
                        }
                    }

                    // Third row - F-keys (F1-F6)
                    HStack(spacing: Theme.Spacing.extraSmall) {
                        ForEach(["F1", "F2", "F3", "F4", "F5", "F6"], id: \.self) { fkey in
                            ToolbarButton(label: fkey, width: 44) {
                                HapticFeedback.impact(.light)
                                switch fkey {
                                case "F1": self.onSpecialKey(.f1)
                                case "F2": self.onSpecialKey(.f2)
                                case "F3": self.onSpecialKey(.f3)
                                case "F4": self.onSpecialKey(.f4)
                                case "F5": self.onSpecialKey(.f5)
                                case "F6": self.onSpecialKey(.f6)
                                default: break
                                }
                            }
                        }

                        Spacer()
                    }

                    // Fourth row - F-keys (F7-F12)
                    HStack(spacing: Theme.Spacing.extraSmall) {
                        ForEach(["F7", "F8", "F9", "F10", "F11", "F12"], id: \.self) { fkey in
                            ToolbarButton(label: fkey, width: 44) {
                                HapticFeedback.impact(.light)
                                switch fkey {
                                case "F7": self.onSpecialKey(.f7)
                                case "F8": self.onSpecialKey(.f8)
                                case "F9": self.onSpecialKey(.f9)
                                case "F10": self.onSpecialKey(.f10)
                                case "F11": self.onSpecialKey(.f11)
                                case "F12": self.onSpecialKey(.f12)
                                default: break
                                }
                            }
                        }

                        Spacer()
                    }

                    // Fifth row - Special characters
                    HStack(spacing: Theme.Spacing.extraSmall) {
                        ToolbarButton(label: "\\") {
                            HapticFeedback.impact(.light)
                            self.onSpecialKey(.backslash)
                        }

                        ToolbarButton(label: "|") {
                            HapticFeedback.impact(.light)
                            self.onSpecialKey(.pipe)
                        }

                        ToolbarButton(label: "`") {
                            HapticFeedback.impact(.light)
                            self.onSpecialKey(.backtick)
                        }

                        ToolbarButton(label: "~") {
                            HapticFeedback.impact(.light)
                            self.onSpecialKey(.tilde)
                        }

                        ToolbarButton(label: "END") {
                            HapticFeedback.impact(.light)
                            // Send Ctrl+E for end
                            self.onSpecialKey(.ctrlE)
                        }

                        Spacer()
                    }

                    // Sixth row - custom Ctrl key input
                    HStack(spacing: Theme.Spacing.extraSmall) {
                        Text("CTRL +")
                            .font(Theme.Typography.terminalSystem(size: 12))
                            .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                            .padding(.leading, Theme.Spacing.small)

                        ForEach(["K", "U", "W", "R", "T"], id: \.self) { letter in
                            ToolbarButton(label: letter, width: 44) {
                                HapticFeedback.impact(.medium)
                                // Send the control character for the letter
                                if let charCode = letter.first?.asciiValue {
                                    let controlCharCode = Int(charCode - 64) // A=1, B=2, etc.
                                    let controlChar = UnicodeScalar(controlCharCode).map(String.init) ?? ""
                                    // Use raw input if available, otherwise fall back to sending as text
                                    if let onRawInput {
                                        onRawInput(controlChar)
                                    } else {
                                        // Fallback - just send Ctrl+C
                                        self.onSpecialKey(.ctrlC)
                                    }
                                }
                            }
                        }

                        Spacer()
                    }
                }
                .padding(.horizontal, Theme.Spacing.small)
                .padding(.vertical, Theme.Spacing.extraSmall)
                .background(Theme.Colors.cardBackground)
                .transition(.asymmetric(
                    insertion: .move(edge: .top).combined(with: .opacity),
                    removal: .move(edge: .top).combined(with: .opacity)))
            }
        }
        .background(Theme.Colors.cardBackground.edgesIgnoringSafeArea(.bottom))
        .sheet(isPresented: self.$showAdvancedKeyboard) {
            AdvancedKeyboardView(isPresented: self.$showAdvancedKeyboard) { input in
                self.onRawInput?(input)
            }
        }
    }
}

/// Individual button component for the terminal toolbar.
/// Provides consistent styling and haptic feedback for toolbar actions.
struct ToolbarButton: View {
    let label: String?
    let systemImage: String?
    let width: CGFloat?
    let height: CGFloat?
    let isActive: Bool
    let action: () -> Void
    @State private var isPressed = false

    init(
        label: String? = nil,
        systemImage: String? = nil,
        width: CGFloat? = nil,
        height: CGFloat? = nil,
        isActive: Bool = false,
        action: @escaping () -> Void)
    {
        self.label = label
        self.systemImage = systemImage
        self.width = width
        self.height = height
        self.isActive = isActive
        self.action = action
    }

    var body: some View {
        Button(action: self.action) {
            Group {
                if let label {
                    Text(label)
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .fontWeight(.medium)
                } else if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 16))
                }
            }
            .foregroundColor(self.isActive || self.isPressed ? Theme.Colors.primaryAccent : Theme.Colors
                .terminalForeground)
            .frame(width: self.width, height: self.height ?? 44)
            .frame(maxWidth: self.width == nil ? .infinity : nil)
            .background(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                    .fill(
                        self.isActive ? Theme.Colors.primaryAccent.opacity(0.2) :
                            self.isPressed ? Theme.Colors.primaryAccent.opacity(0.1) :
                            Theme.Colors.cardBorder.opacity(0.3)))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                    .stroke(
                        self.isActive || self.isPressed ? Theme.Colors.primaryAccent : Theme.Colors.cardBorder,
                        lineWidth: self.isActive || self.isPressed ? 2 : 1))
            .shadow(
                color: self.isActive || self.isPressed ? Theme.Colors.primaryAccent.opacity(0.2) : .clear,
                radius: self.isActive || self.isPressed ? 4 : 0)
        }
        .buttonStyle(PlainButtonStyle())
        .scaleEffect(self.isPressed ? 0.95 : 1.0)
        .animation(Theme.Animation.quick, value: self.isActive)
        .animation(Theme.Animation.quick, value: self.isPressed)
        .onLongPressGesture(minimumDuration: 0, maximumDistance: .infinity) { pressing in
            self.isPressed = pressing
        } perform: {
            // Action handled by button
        }
    }
}
