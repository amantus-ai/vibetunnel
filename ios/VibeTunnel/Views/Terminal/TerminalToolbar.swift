import SwiftUI

struct TerminalToolbar: View {
    let onSpecialKey: (TerminalInput.SpecialKey) -> Void
    let onDismissKeyboard: () -> Void
    @State private var showMoreKeys = false
    
    var body: some View {
        VStack(spacing: 0) {
            Divider()
                .background(Theme.Colors.cardBorder)
            
            HStack(spacing: Theme.Spacing.xs) {
                // Tab key
                ToolbarButton(label: "TAB", systemImage: "arrow.right.to.line.compact") {
                    HapticFeedback.impact(.light)
                    onSpecialKey(.tab)
                }
                
                // Arrow keys
                HStack(spacing: 2) {
                    ToolbarButton(label: "←", width: 35) {
                        HapticFeedback.impact(.light)
                        onSpecialKey(.arrowLeft)
                    }
                    
                    VStack(spacing: 2) {
                        ToolbarButton(label: "↑", width: 35, height: 20) {
                            HapticFeedback.impact(.light)
                            onSpecialKey(.arrowUp)
                        }
                        ToolbarButton(label: "↓", width: 35, height: 20) {
                            HapticFeedback.impact(.light)
                            onSpecialKey(.arrowDown)
                        }
                    }
                    
                    ToolbarButton(label: "→", width: 35) {
                        HapticFeedback.impact(.light)
                        onSpecialKey(.arrowRight)
                    }
                }
                
                // ESC key
                ToolbarButton(label: "ESC") {
                    HapticFeedback.impact(.light)
                    onSpecialKey(.escape)
                }
                
                // More keys toggle
                ToolbarButton(
                    label: "•••",
                    isActive: showMoreKeys
                ) {
                    HapticFeedback.impact(.light)
                    withAnimation(Theme.Animation.quick) {
                        showMoreKeys.toggle()
                    }
                }
                
                Spacer()
                
                // Dismiss keyboard
                ToolbarButton(systemImage: "keyboard.chevron.compact.down") {
                    HapticFeedback.impact(.light)
                    onDismissKeyboard()
                }
            }
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, Theme.Spacing.xs)
            .background(Theme.Colors.cardBackground)
            
            // Extended toolbar
            if showMoreKeys {
                Divider()
                    .background(Theme.Colors.cardBorder)
                
                HStack(spacing: Theme.Spacing.xs) {
                    // Control keys
                    ToolbarButton(label: "CTRL+C") {
                        HapticFeedback.impact(.medium)
                        onSpecialKey(.ctrlC)
                    }
                    
                    ToolbarButton(label: "CTRL+D") {
                        HapticFeedback.impact(.medium)
                        onSpecialKey(.ctrlD)
                    }
                    
                    ToolbarButton(label: "CTRL+Z") {
                        HapticFeedback.impact(.medium)
                        onSpecialKey(.ctrlZ)
                    }
                    
                    ToolbarButton(label: "ENTER") {
                        HapticFeedback.impact(.light)
                        onSpecialKey(.enter)
                    }
                    
                    Spacer()
                }
                .padding(.horizontal, Theme.Spacing.sm)
                .padding(.vertical, Theme.Spacing.xs)
                .background(Theme.Colors.cardBackground)
                .transition(.asymmetric(
                    insertion: .move(edge: .top).combined(with: .opacity),
                    removal: .move(edge: .top).combined(with: .opacity)
                ))
            }
        }
        .background(Theme.Colors.cardBackground.edgesIgnoringSafeArea(.bottom))
    }
}

struct ToolbarButton: View {
    let label: String?
    let systemImage: String?
    let width: CGFloat?
    let height: CGFloat?
    let isActive: Bool
    let action: () -> Void
    
    init(
        label: String? = nil,
        systemImage: String? = nil,
        width: CGFloat? = nil,
        height: CGFloat? = nil,
        isActive: Bool = false,
        action: @escaping () -> Void
    ) {
        self.label = label
        self.systemImage = systemImage
        self.width = width
        self.height = height
        self.isActive = isActive
        self.action = action
    }
    
    var body: some View {
        Button(action: action) {
            Group {
                if let label = label {
                    Text(label)
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .fontWeight(.medium)
                } else if let systemImage = systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 16))
                }
            }
            .foregroundColor(isActive ? Theme.Colors.primaryAccent : Theme.Colors.terminalForeground)
            .frame(width: width, height: height ?? 44)
            .frame(maxWidth: width == nil ? .infinity : nil)
            .background(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                    .fill(isActive ? Theme.Colors.primaryAccent.opacity(0.2) : Theme.Colors.cardBorder.opacity(0.3))
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                    .stroke(
                        isActive ? Theme.Colors.primaryAccent : Theme.Colors.cardBorder,
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(PlainButtonStyle())
        .scaleEffect(isActive ? 0.95 : 1.0)
        .animation(Theme.Animation.quick, value: isActive)
    }
}