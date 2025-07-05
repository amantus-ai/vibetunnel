import SwiftUI

private let logger = Logger(category: "CtrlKeyGrid")

/// Grid selector for Ctrl+key combinations
struct CtrlKeyGrid: View {
    @Binding var isPresented: Bool
    let onKeyPress: (String) -> Void

    /// Common Ctrl combinations organized by category
    let navigationKeys = [
        ("A", "Beginning of line"),
        ("E", "End of line"),
        ("B", "Back one character"),
        ("F", "Forward one character"),
        ("P", "Previous command"),
        ("N", "Next command")
    ]

    let editingKeys = [
        ("D", "Delete character"),
        ("H", "Backspace"),
        ("W", "Delete word"),
        ("U", "Delete to beginning"),
        ("K", "Delete to end"),
        ("Y", "Paste")
    ]

    let processKeys = [
        ("C", "Interrupt (SIGINT)"),
        ("Z", "Suspend (SIGTSTP)"),
        ("\\", "Quit (SIGQUIT)"),
        ("S", "Stop output"),
        ("Q", "Resume output"),
        ("L", "Clear screen")
    ]

    let searchKeys = [
        ("R", "Search history"),
        ("T", "Transpose chars"),
        ("_", "Undo"),
        ("X", "Start selection"),
        ("G", "Cancel command"),
        ("O", "Execute + new line")
    ]

    @State private var selectedCategory = 0

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Category picker
                Picker("Category", selection: $selectedCategory) {
                    Text("Navigation").tag(0)
                    Text("Editing").tag(1)
                    Text("Process").tag(2)
                    Text("Search").tag(3)
                }
                .pickerStyle(SegmentedPickerStyle())
                .padding()

                // Key grid
                ScrollView {
                    LazyVGrid(columns: [
                        GridItem(.flexible()),
                        GridItem(.flexible()),
                        GridItem(.flexible())
                    ], spacing: Theme.Spacing.medium) {
                        ForEach(currentKeys, id: \.0) { key, description in
                            CtrlGridKeyButton(
                                key: key,
                                description: description
                            ) { sendCtrlKey(key) }
                        }
                    }
                    .padding()
                }

                // Quick reference
                VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                    Text("Tip: Long press any key to see its function")
                        .font(Theme.Typography.terminalSystem(size: 12))
                        .foregroundColor(Theme.Colors.secondaryText)

                    Text("These shortcuts work in most terminal applications")
                        .font(Theme.Typography.terminalSystem(size: 11))
                        .foregroundColor(Theme.Colors.secondaryText.opacity(0.7))
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.Colors.cardBackground)
            }
            .navigationTitle("Ctrl Key Shortcuts")
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
    }

    private var currentKeys: [(String, String)] {
        switch selectedCategory {
        case 0: navigationKeys
        case 1: editingKeys
        case 2: processKeys
        case 3: searchKeys
        default: navigationKeys
        }
    }

    private func sendCtrlKey(_ key: String) {
        // Convert letter to control character
        if let charCode = key.first?.asciiValue {
            let controlCharCode = Int(charCode & 0x1F) // Convert to control character
            if let controlChar = UnicodeScalar(controlCharCode).map(String.init) {
                onKeyPress(controlChar)
                Task { @MainActor in
                    HapticFeedback.impact(.medium)
                }

                // Auto-dismiss for common keys
                if ["C", "D", "Z"].contains(key) {
                    isPresented = false
                }
            }
        }
    }
}

/// Individual Ctrl key button for the grid
/// Individual button in the Ctrl key grid.
/// Displays the key label and handles tap to send control sequence.
struct CtrlGridKeyButton: View {
    let key: String
    let description: String
    let onPress: () -> Void

    @State private var isPressed = false
    @State private var showingTooltip = false

    var body: some View {
        Button(action: onPress) {
            VStack(spacing: 4) {
                Text("^" + key)
                    .font(Theme.Typography.terminalSystem(size: 20, weight: .bold))
                    .foregroundColor(isPressed ? .white : Theme.Colors.primaryAccent)

                Text("Ctrl+" + key)
                    .font(Theme.Typography.terminalSystem(size: 10))
                    .foregroundColor(isPressed ? .white.opacity(0.8) : Theme.Colors.secondaryText)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 80)
            .background(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                    .fill(isPressed ? Theme.Colors.primaryAccent : Theme.Colors.cardBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.CornerRadius.medium)
                    .stroke(
                        isPressed ? Theme.Colors.primaryAccent : Theme.Colors.cardBorder,
                        lineWidth: isPressed ? 2 : 1
                    )
            )
            .shadow(
                color: isPressed ? Theme.Colors.primaryAccent.opacity(0.3) : .clear,
                radius: isPressed ? 8 : 0
            )
        }
        .buttonStyle(PlainButtonStyle())
        .scaleEffect(isPressed ? 0.95 : 1.0)
        .animation(.easeInOut(duration: 0.1), value: isPressed)
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in isPressed = true }
                .onEnded { _ in isPressed = false }
        )
        .onLongPressGesture(minimumDuration: 0.5) {
            showingTooltip = true
            Task { @MainActor in
                HapticFeedback.impact(.light)
            }

            // Hide tooltip after 3 seconds
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                showingTooltip = false
            }
        }
        .popover(isPresented: $showingTooltip) {
            VStack(alignment: .leading, spacing: Theme.Spacing.small) {
                Text("Ctrl+" + key)
                    .font(Theme.Typography.terminalSystem(size: 14, weight: .bold))
                    .foregroundColor(Theme.Colors.primaryAccent)

                Text(description)
                    .font(Theme.Typography.terminalSystem(size: 12))
                    .foregroundColor(Theme.Colors.terminalForeground)
            }
            .padding()
            .presentationCompactAdaptation(.popover)
        }
    }
}

// MARK: - Preview

#Preview {
    CtrlKeyGrid(isPresented: .constant(true)) { key in
        logger.debug("Ctrl key pressed: \(key)")
    }
}
