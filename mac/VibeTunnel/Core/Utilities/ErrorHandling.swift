import SwiftUI

// MARK: - Error Alert Modifier

/// A view modifier that presents errors using SwiftUI's built-in alert system
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
                Button("OK") {
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
        _ title: String = "Error",
        error: Binding<Error?>,
        onDismiss: (() -> Void)? = nil
    ) -> some View {
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
    ) -> Task<T, Error> {
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

/// Protocol for errors that can provide recovery actions
protocol RecoverableError: Error {
    var recoverySuggestion: String? { get }
    var recoveryActions: [ErrorRecoveryAction]? { get }
}

struct ErrorRecoveryAction {
    let title: String
    let action: () async throws -> Void
}

// MARK: - Error Toast View

/// A toast-style error notification
struct ErrorToast: View {
    let error: Error
    let onDismiss: () -> Void
    
    @State private var opacity: Double = 0
    
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.red)
            
            VStack(alignment: .leading, spacing: 4) {
                Text("Error")
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

/// A view that catches and displays errors from async operations
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
    nonisolated(unsafe) static let defaultValue = AsyncErrorHandler(handler: { _ in })
}

extension EnvironmentValues {
    var asyncErrorHandler: AsyncErrorHandler {
        get { self[AsyncErrorHandlerKey.self] }
        set { self[AsyncErrorHandlerKey.self] = newValue }
    }
}

struct AsyncErrorHandler {
    let handler: (Error) -> Void
    
    func handle(_ error: Error) {
        handler(error)
    }
}