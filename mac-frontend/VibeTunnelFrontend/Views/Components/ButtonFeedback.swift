import SwiftUI
import os

/// Provides visual feedback for button actions
struct ButtonFeedback: ViewModifier {
    @State private var showingFeedback = false
    @State private var feedbackType: FeedbackType = .success
    let action: () async -> FeedbackType?
    
    enum FeedbackType {
        case success
        case copied
        case error
        
        var icon: String {
            switch self {
            case .success: return "checkmark"
            case .copied: return "doc.on.doc.fill"
            case .error: return "xmark"
            }
        }
        
        var color: Color {
            switch self {
            case .success: return Theme.Colors.success
            case .copied: return Theme.Colors.accent
            case .error: return Theme.Colors.error
            }
        }
    }
    
    func body(content: Content) -> some View {
        content
            .overlay(alignment: .center) {
                if showingFeedback {
                    Image(systemName: feedbackType.icon)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(feedbackType.color)
                        .padding(8)
                        .background(Theme.Colors.background.opacity(0.9))
                        .clipShape(Circle())
                        .transition(.asymmetric(
                            insertion: .scale.combined(with: .opacity),
                            removal: .scale(scale: 0.8).combined(with: .opacity)
                        ))
                        .zIndex(1)
                }
            }
            .onTapGesture {
                Task {
                    if let feedback = await action() {
                        await showFeedback(feedback)
                    }
                }
            }
    }
    
    @MainActor
    private func showFeedback(_ type: FeedbackType) async {
        // Play system sound
        switch type {
        case .success, .copied:
            NSSound.beep() // Or use a more subtle sound
        case .error:
            NSSound.beep()
        }
        
        feedbackType = type
        
        withAnimation(.easeOut(duration: 0.2)) {
            showingFeedback = true
        }
        
        try? await Task.sleep(nanoseconds: 800_000_000) // 0.8 seconds
        
        withAnimation(.easeIn(duration: 0.15)) {
            showingFeedback = false
        }
    }
}

/// Button style that provides haptic-like feedback
struct FeedbackButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

// Extensions for easy use
extension View {
    func buttonFeedback(action: @escaping () async -> ButtonFeedback.FeedbackType?) -> some View {
        modifier(ButtonFeedback(action: action))
    }
}

// Copy button with built-in feedback
struct CopyButton: View {
    let text: String
    let label: String
    var icon: String = "doc.on.doc"
    var fontSize: CGFloat = 11
    
    @State private var showingCopied = false
    
    var body: some View {
        Button {
            copyToClipboard()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: showingCopied ? "checkmark" : icon)
                    .font(.system(size: fontSize))
                Text(showingCopied ? "Copied!" : label)
                    .font(.system(size: fontSize, weight: .medium))
            }
            .foregroundStyle(showingCopied ? Theme.Colors.success : Theme.Colors.accent)
            .animation(.easeInOut(duration: 0.2), value: showingCopied)
        }
        .buttonStyle(FeedbackButtonStyle())
    }
    
    private func copyToClipboard() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        
        // Visual feedback
        withAnimation {
            showingCopied = true
        }
        
        // Log
        Logger.app.debug("Copied to clipboard: \(text)")
        
        // Status bar message
        StatusBarManager.shared.showSuccess("Copied to clipboard")
        
        // Reset after delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            withAnimation {
                showingCopied = false
            }
        }
    }
}