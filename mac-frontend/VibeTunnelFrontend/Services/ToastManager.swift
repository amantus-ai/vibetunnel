import SwiftUI
import Combine

/// Types of toast notifications
enum ToastType {
    case success
    case error
    case warning
    case info
    
    var color: Color {
        switch self {
        case .success: return Theme.Colors.success
        case .error: return Theme.Colors.error
        case .warning: return Theme.Colors.warning
        case .info: return Theme.Colors.accent
        }
    }
    
    var icon: String {
        switch self {
        case .success: return "checkmark.circle.fill"
        case .error: return "xmark.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .info: return "info.circle.fill"
        }
    }
}

/// A toast notification
struct Toast: Identifiable {
    let id = UUID()
    let type: ToastType
    let title: String
    let message: String?
    let duration: TimeInterval
    
    init(type: ToastType, title: String, message: String? = nil, duration: TimeInterval = 3.0) {
        self.type = type
        self.title = title
        self.message = message
        self.duration = duration
    }
}

/// Manages toast notifications globally
@MainActor
final class ToastManager: ObservableObject {
    static let shared = ToastManager()
    
    @Published private(set) var toasts: [Toast] = []
    private var dismissTimers: [UUID: Timer] = [:]
    
    private init() {}
    
    func show(_ type: ToastType, _ title: String, message: String? = nil, duration: TimeInterval = 3.0) {
        let toast = Toast(type: type, title: title, message: message, duration: duration)
        
        withAnimation(Theme.Animation.standard) {
            toasts.append(toast)
        }
        
        // Auto-dismiss after duration
        let timer = Timer.scheduledTimer(withTimeInterval: duration, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.dismiss(toast)
            }
        }
        dismissTimers[toast.id] = timer
    }
    
    func showSuccess(_ title: String, message: String? = nil) {
        show(.success, title, message: message)
    }
    
    func showError(_ title: String, message: String? = nil) {
        show(.error, title, message: message, duration: 5.0) // Errors stay longer
    }
    
    func showWarning(_ title: String, message: String? = nil) {
        show(.warning, title, message: message)
    }
    
    func showInfo(_ title: String, message: String? = nil) {
        show(.info, title, message: message)
    }
    
    func dismiss(_ toast: Toast) {
        dismissTimers[toast.id]?.invalidate()
        dismissTimers.removeValue(forKey: toast.id)
        
        withAnimation(Theme.Animation.standard) {
            toasts.removeAll { $0.id == toast.id }
        }
    }
    
    func dismissAll() {
        dismissTimers.values.forEach { $0.invalidate() }
        dismissTimers.removeAll()
        
        withAnimation(Theme.Animation.standard) {
            toasts.removeAll()
        }
    }
}

/// View modifier to add toast support to any view
struct ToastModifier: ViewModifier {
    @ObservedObject private var toastManager = ToastManager.shared
    
    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                ToastContainerView(toasts: toastManager.toasts) { toast in
                    toastManager.dismiss(toast)
                }
            }
    }
}

/// Container view for displaying toasts
struct ToastContainerView: View {
    let toasts: [Toast]
    let onDismiss: (Toast) -> Void
    
    var body: some View {
        VStack(spacing: Theme.Spacing.sm) {
            ForEach(toasts) { toast in
                ToastView(toast: toast, onDismiss: {
                    onDismiss(toast)
                })
                .transition(.asymmetric(
                    insertion: .move(edge: .top).combined(with: .opacity),
                    removal: .move(edge: .top).combined(with: .opacity)
                ))
            }
        }
        .padding(.top, Theme.Spacing.lg)
        .padding(.horizontal, Theme.Spacing.lg)
    }
}

/// Individual toast view
struct ToastView: View {
    let toast: Toast
    let onDismiss: () -> Void
    @State private var isHovered = false
    
    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            Image(systemName: toast.type.icon)
                .font(.system(size: 20))
                .foregroundStyle(toast.type.color)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(toast.title)
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Colors.text)
                
                if let message = toast.message {
                    Text(message)
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.Colors.secondaryText)
                        .lineLimit(2)
                }
            }
            
            Spacer()
            
            Button {
                onDismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.Colors.tertiaryText)
            }
            .buttonStyle(.plain)
            .opacity(isHovered ? 1 : 0.5)
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.sm)
        .background(Theme.Colors.secondaryBackground)
        .cornerRadius(Theme.Sizes.cornerRadius)
        .shadow(color: Color.black.opacity(0.1), radius: 8, x: 0, y: 2)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Sizes.cornerRadius)
                .stroke(Theme.Colors.tertiaryText.opacity(0.3), lineWidth: 1)
        )
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.2)) {
                isHovered = hovering
            }
        }
    }
}

// Extension to make it easy to add toast support
extension View {
    func toastContainer() -> some View {
        modifier(ToastModifier())
    }
}