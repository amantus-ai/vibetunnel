import SwiftUI

// MARK: - Error Alert Modifier

/// A view modifier that presents errors using SwiftUI's built-in alert system.
///
/// Provides a standardized way to display error dialogs throughout the application
/// with automatic dismissal handling and optional callbacks.
struct ErrorAlertModifier: ViewModifier {
    @Binding var error: Error?
    let title: String
    let onDismiss: (() -> Void)?

    func body(content: Content) -> some View {
        content
            .alert(
                title,
                isPresented: .constant(error != nil),
                presenting: error
            ) { _ in
                Button(UIStrings.ok) {
                    error = nil
                    onDismiss?()
                }
            } message: { error in
                Text(error.localizedDescription)
            }
    }
}

extension View {
    /// Presents an error alert when an error is present
    func errorAlert(
        _ title: String = UIStrings.error,
        error: Binding<Error?>,
        onDismiss: (() -> Void)? = nil
    )
        -> some View
    {
        modifier(ErrorAlertModifier(error: error, title: title, onDismiss: onDismiss))
    }
}

// MARK: - Task Error Handling

extension Task where Failure == Error {
    /// Executes an async operation with error handling on the MainActor
    @MainActor
    @discardableResult
    static func withErrorHandling<T>(
        priority: TaskPriority? = nil,
        errorBinding: Binding<Error?>,
        operation: @escaping () async throws -> T
    )
        -> Task<T, Error>
    {
        Task<T, Error>(priority: priority) {
            do {
                return try await operation()
            } catch {
                errorBinding.wrappedValue = error
                throw error
            }
        }
    }
}

// MARK: - Error Recovery Protocol

/// Protocol for errors that can provide recovery actions.
///
/// Allows errors to define suggested recovery steps and actionable
/// recovery options that can be presented to users.
protocol RecoverableError: Error {
    var recoverySuggestion: String? { get }
    var recoveryActions: [ErrorRecoveryAction]? { get }
}

/// Represents an actionable recovery option for an error.
///
/// Encapsulates a user-facing title and the async action to perform
/// when the user selects this recovery option.
struct ErrorRecoveryAction {
    let title: String
    let action: () async throws -> Void
}

// MARK: - Error Toast View

/// A toast-style error notification.
///
/// Displays errors in a non-modal toast format that appears temporarily
/// and can be dismissed by the user or automatically after a timeout.
struct ErrorToast: View {
    let error: Error
    let onDismiss: () -> Void

    @State private var opacity: Double = 0

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.red)

            VStack(alignment: .leading, spacing: 4) {
                Text(UIStrings.error)
                    .font(.headline)

                Text(error.localizedDescription)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }

            Spacer()

            Button(action: onDismiss) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(.secondary)
            }
            .buttonStyle(PlainButtonStyle())
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color(NSColor.controlBackgroundColor))
                .shadow(radius: 10)
        )
        .padding()
        .opacity(opacity)
        .onAppear {
            withAnimation(.easeIn(duration: 0.3)) {
                opacity = 1
            }
        }
    }
}

// MARK: - Error State Management

// AsyncState property wrapper removed as it's not used in the codebase

// MARK: - Async Error Boundary

/// A view that catches and displays errors from async operations.
///
/// Wraps content views to provide centralized error handling for async operations,
/// automatically displaying errors using the standard error alert presentation.
struct AsyncErrorBoundary<Content: View>: View {
    @State private var error: Error?
    let content: () -> Content

    var body: some View {
        content()
            .environment(\.asyncErrorHandler, AsyncErrorHandler { error in
                self.error = error
            })
            .errorAlert(error: $error)
    }
}

// MARK: - Environment Values

private struct AsyncErrorHandlerKey: EnvironmentKey {
    nonisolated(unsafe) static let defaultValue = AsyncErrorHandler { _ in }
}

extension EnvironmentValues {
    var asyncErrorHandler: AsyncErrorHandler {
        get { self[AsyncErrorHandlerKey.self] }
        set { self[AsyncErrorHandlerKey.self] = newValue }
    }
}

/// Handler for async errors propagated through the environment.
///
/// Provides a mechanism for child views to report errors up the view hierarchy
/// to a centralized error handling location.
struct AsyncErrorHandler {
    let handler: (Error) -> Void

    func handle(_ error: Error) {
        handler(error)
    }
}
