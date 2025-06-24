import SwiftUI
import Combine

/// A status bar component for showing transient messages at the bottom of windows
struct StatusBar: View {
    @StateObject private var statusManager = StatusBarManager.shared
    
    var body: some View {
        VStack(spacing: 0) {
            Divider()
            
            HStack(spacing: Theme.Spacing.sm) {
                // Connection status indicator
                ConnectionStatusIndicator()
                
                Divider()
                    .frame(height: 16)
                    .padding(.horizontal, 4)
                
                // Status message
                if let message = statusManager.currentMessage {
                    HStack(spacing: 6) {
                        if let icon = message.icon {
                            Image(systemName: icon)
                                .font(.system(size: 11))
                                .foregroundStyle(message.type.color)
                        }
                        
                        Text(message.text)
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.Colors.secondaryText)
                            .lineLimit(1)
                        
                        if message.showProgress {
                            ProgressView()
                                .scaleEffect(0.7)
                                .frame(width: 12, height: 12)
                        }
                    }
                    .transition(.asymmetric(
                        insertion: .push(from: .bottom).combined(with: .opacity),
                        removal: .push(from: .top).combined(with: .opacity)
                    ))
                }
                
                Spacer()
                
                // Additional status items (e.g., session count)
                if let sessionCount = statusManager.sessionCount, sessionCount > 0 {
                    Text("\(sessionCount) session\(sessionCount == 1 ? "" : "s")")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.Colors.tertiaryText)
                }
            }
            .padding(.horizontal, Theme.Spacing.md)
            .padding(.vertical, 6)
            .background(Theme.Colors.secondaryBackground.opacity(0.5))
        }
        .animation(.easeInOut(duration: 0.2), value: statusManager.currentMessage)
    }
}

struct ConnectionStatusIndicator: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var isAnimating = false
    
    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(connectionManager.isConnected ? Color.green : Color.orange)
                .frame(width: 6, height: 6)
                .overlay(
                    Circle()
                        .stroke(connectionManager.isConnected ? Color.green : Color.orange, lineWidth: 6)
                        .scaleEffect(isAnimating ? 1.5 : 1)
                        .opacity(isAnimating ? 0 : 0.3)
                        .animation(
                            connectionManager.isConnected ? nil : .easeOut(duration: 1.5).repeatForever(autoreverses: false),
                            value: isAnimating
                        )
                )
            
            Text(connectionManager.isConnected ? "Connected" : "Connecting...")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Theme.Colors.secondaryText)
        }
        .onAppear {
            isAnimating = !connectionManager.isConnected
        }
        .onChange(of: connectionManager.isConnected) { _, connected in
            isAnimating = !connected
        }
    }
}

/// Manages status bar messages
@MainActor
final class StatusBarManager: ObservableObject {
    static let shared = StatusBarManager()
    
    @Published private(set) var currentMessage: StatusMessage?
    @Published var sessionCount: Int?
    
    private var messageTimer: Timer?
    
    private init() {}
    
    struct StatusMessage: Equatable {
        let text: String
        let type: MessageType
        let icon: String?
        let showProgress: Bool
        let duration: TimeInterval
        
        enum MessageType {
            case info, success, warning, progress
            
            var color: Color {
                switch self {
                case .info: return Theme.Colors.secondaryText
                case .success: return Theme.Colors.success
                case .warning: return Theme.Colors.warning
                case .progress: return Theme.Colors.accent
                }
            }
        }
    }
    
    func showMessage(_ text: String, type: StatusMessage.MessageType = .info, icon: String? = nil, duration: TimeInterval = 3.0) {
        messageTimer?.invalidate()
        
        currentMessage = StatusMessage(
            text: text,
            type: type,
            icon: icon,
            showProgress: false,
            duration: duration
        )
        
        if duration > 0 {
            messageTimer = Timer.scheduledTimer(withTimeInterval: duration, repeats: false) { [weak self] _ in
                Task { @MainActor in
                    self?.clearMessage()
                }
            }
        }
    }
    
    func showProgress(_ text: String, icon: String? = nil) {
        messageTimer?.invalidate()
        
        currentMessage = StatusMessage(
            text: text,
            type: .progress,
            icon: icon,
            showProgress: true,
            duration: 0
        )
    }
    
    func showSuccess(_ text: String) {
        showMessage(text, type: .success, icon: "checkmark.circle.fill", duration: 2.0)
    }
    
    func showError(_ text: String) {
        showMessage(text, type: .warning, icon: "exclamationmark.triangle.fill", duration: 4.0)
    }
    
    func updateConnectionStatus(connected: Bool, serverURL: URL? = nil) {
        // The connection status is already handled by ConnectionStatusIndicator
        // This method is here for API compatibility
    }
    
    func clearMessage() {
        messageTimer?.invalidate()
        messageTimer = nil
        currentMessage = nil
    }
}

// Extension to add status bar to views
extension View {
    func withStatusBar() -> some View {
        VStack(spacing: 0) {
            self
            StatusBar()
        }
    }
}