import SwiftUI
import os

/// Manages error presentation in an idiomatic iOS way
@MainActor
final class ErrorPresenter: ObservableObject {
    static let shared = ErrorPresenter()
    
    @Published var currentError: ErrorInfo?
    @Published var isShowingError = false
    
    private let logger = Logger(subsystem: "com.steipete.vibetunnel", category: "ErrorPresenter")
    
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
            case critical
            case warning
            case informational
        }
        
        struct AlertAction: Sendable {
            let title: String
            let role: ButtonRole?
            let handler: @Sendable () -> Void
            
            static let ok = AlertAction(title: "OK", role: nil) {}
            static let dismiss = AlertAction(title: "Dismiss", role: .cancel) {}
        }
    }
    
    /// Show an error alert
    func showError(_ title: String, message: String, error: Error? = nil) {
        logger.error("\(title): \(message) - Error: \(error?.localizedDescription ?? "nil")")
        
        currentError = ErrorInfo(
            title: title,
            message: message,
            error: error,
            style: .informational,
            actions: [.dismiss]
        )
        isShowingError = true
    }
    
    /// Show a critical error
    func showCriticalError(_ title: String, message: String, error: Error? = nil) {
        logger.error("Critical: \(title): \(message) - Error: \(error?.localizedDescription ?? "nil")")
        
        currentError = ErrorInfo(
            title: title,
            message: message,
            error: error,
            style: .critical,
            actions: [.ok]
        )
        isShowingError = true
    }
    
    /// Show a warning
    func showWarning(_ title: String, message: String, error: Error? = nil) {
        logger.warning("\(title): \(message) - Error: \(error?.localizedDescription ?? "nil")")
        
        currentError = ErrorInfo(
            title: title,
            message: message,
            error: error,
            style: .warning,
            actions: [.dismiss]
        )
        isShowingError = true
    }
    
    /// Dismiss current error
    func dismissError() {
        currentError = nil
        isShowingError = false
    }
}

// MARK: - SwiftUI Error Alert View

struct ErrorAlertModifier: ViewModifier {
    @StateObject private var errorPresenter = ErrorPresenter.shared
    
    func body(content: Content) -> some View {
        content
            .alert(
                errorPresenter.currentError?.title ?? "Error",
                isPresented: $errorPresenter.isShowingError,
                presenting: errorPresenter.currentError
            ) { error in
                ForEach(error.actions.indices, id: \.self) { index in
                    let action = error.actions[index]
                    Button(action.title, role: action.role) {
                        action.handler()
                        errorPresenter.dismissError()
                    }
                }
            } message: { error in
                VStack(alignment: .leading, spacing: 8) {
                    Text(error.message)
                    
                    if let errorDetails = error.error {
                        Text(errorDetails.localizedDescription)
                            .font(.caption)
                    }
                }
            }
    }
}

extension View {
    func errorPresentation() -> some View {
        self.modifier(ErrorAlertModifier())
    }
}