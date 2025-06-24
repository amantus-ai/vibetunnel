import SwiftUI
import AppKit
import Combine
import os
import UserNotifications

/// Manages error presentation in an idiomatic macOS way
@MainActor
final class ErrorPresenter: ObservableObject {
    static let shared = ErrorPresenter()
    
    @Published var currentError: ErrorInfo?
    @Published var isShowingError = false
    
    private init() {}
    
    /// Error information to display
    struct ErrorInfo: Identifiable {
        let id = UUID()
        let title: String
        let message: String
        let error: Error?
        let style: AlertStyle
        let actions: [AlertAction]
        
        enum AlertStyle {
            case critical      // NSAlert modal
            case warning       // NSAlert sheet
            case informational // Status message
        }
        
        struct AlertAction: Sendable {
            let title: String
            let style: NSAlert.Style
            let handler: @Sendable () -> Void
            
            static let ok = AlertAction(title: "OK", style: .informational) {}
            static let dismiss = AlertAction(title: "Dismiss", style: .informational) {}
        }
    }
    
    /// Show a critical error using NSAlert (modal)
    func showCriticalError(_ title: String, message: String, error: Error? = nil) {
        Logger.logError(Logger.app, "\(title): \(message)", error: error)
        
        // Send notification if app is in background
        if NSApp.isActive == false {
            Task {
                await NotificationManager.shared.showNotification(
                    title: title,
                    body: message,
                    sound: .defaultCritical
                )
            }
        }
        
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.messageText = title
            alert.informativeText = message
            alert.alertStyle = .critical
            alert.addButton(withTitle: "OK")
            
            if let error = error {
                alert.informativeText = "\(message)\n\nError: \(error.localizedDescription)"
            }
            
            alert.runModal()
        }
    }
    
    /// Show a warning using NSAlert (sheet when possible)
    func showWarning(_ title: String, message: String, error: Error? = nil, in window: NSWindow? = nil) {
        Logger.logWarning(Logger.app, "\(title): \(message)")
        
        // Send notification if app is in background
        if NSApp.isActive == false {
            Task {
                await NotificationManager.shared.showNotification(
                    title: title,
                    body: message,
                    sound: .default
                )
            }
        }
        
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.messageText = title
            alert.informativeText = message
            alert.alertStyle = .warning
            alert.addButton(withTitle: "OK")
            
            if let error = error {
                alert.informativeText = "\(message)\n\nDetails: \(error.localizedDescription)"
            }
            
            if let window = window ?? NSApp.mainWindow {
                alert.beginSheetModal(for: window) { _ in }
            } else {
                alert.runModal()
            }
        }
    }
    
    /// Show an informational error (for use with SwiftUI sheet)
    func showError(_ title: String, message: String, error: Error? = nil) {
        Logger.logError(Logger.app, "\(title): \(message)", error: error)
        
        // Send notification if app is in background
        if NSApp.isActive == false {
            Task {
                await NotificationManager.shared.showNotification(
                    title: title,
                    body: message,
                    sound: .default
                )
            }
        }
        
        currentError = ErrorInfo(
            title: title,
            message: message,
            error: error,
            style: .informational,
            actions: [.dismiss]
        )
        isShowingError = true
    }
    
    /// Show a success message (brief, non-intrusive)
    func showSuccess(_ title: String, message: String? = nil) {
        Logger.app.info("Success: \(title) - \(message ?? "")")
        // For success, we'll keep using a brief notification
        // but could also use NSUserNotification or update status in UI
    }
    
    /// Dismiss current error
    func dismissError() {
        currentError = nil
        isShowingError = false
    }
}

// MARK: - SwiftUI Error Sheet View

struct ErrorSheetView: View {
    let error: ErrorPresenter.ErrorInfo
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Image(systemName: iconName)
                    .font(.system(size: 24))
                    .foregroundStyle(iconColor)
                
                Text(error.title)
                    .font(.system(size: 16, weight: .semibold))
                
                Spacer()
            }
            .padding()
            .background(Theme.Colors.secondaryBackground)
            
            // Content
            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                Text(error.message)
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Colors.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                
                if let errorDetails = error.error {
                    GroupBox {
                        ScrollView {
                            Text(errorDetails.localizedDescription)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(Theme.Colors.secondaryText)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                        }
                        .frame(maxHeight: 100)
                    }
                }
                
                // Actions
                HStack {
                    Spacer()
                    
                    ForEach(error.actions.indices, id: \.self) { index in
                        let action = error.actions[index]
                        Button(action.title) {
                            action.handler()
                            dismiss()
                        }
                        .keyboardShortcut(index == 0 ? .defaultAction : .cancelAction)
                    }
                }
                .padding(.top)
            }
            .padding()
        }
        .frame(width: 400)
        .background(Theme.Colors.background)
    }
    
    private var iconName: String {
        switch error.style {
        case .critical: return "exclamationmark.triangle.fill"
        case .warning: return "exclamationmark.circle.fill"
        case .informational: return "info.circle.fill"
        }
    }
    
    private var iconColor: Color {
        switch error.style {
        case .critical: return Theme.Colors.error
        case .warning: return Theme.Colors.warning
        case .informational: return Theme.Colors.accent
        }
    }
}

// MARK: - View Extension

struct ErrorPresentationModifier: ViewModifier {
    @StateObject private var errorPresenter = ErrorPresenter.shared
    
    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $errorPresenter.isShowingError) {
                if let error = errorPresenter.currentError {
                    ErrorSheetView(error: error)
                }
            }
    }
}

extension View {
    func errorPresentation() -> some View {
        self.modifier(ErrorPresentationModifier())
    }
}