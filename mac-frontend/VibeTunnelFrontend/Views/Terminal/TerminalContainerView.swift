import SwiftUI

/// Container view that wraps terminal with additional controls like scroll-to-bottom
struct TerminalContainerView: View {
    let manager: TerminalManager
    let targetColumnWidth: Int
    let fontSize: Double
    let renderer: String
    
    @State private var showScrollToBottom = false
    @State private var scrollViewProxy: NSScrollView?
    
    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            // Terminal view
            Group {
                switch renderer {
                case "xterm":
                    WebTerminalView(manager: manager, targetColumnWidth: targetColumnWidth, fontSize: fontSize)
                case "buffer":
                    // Binary buffer protocol - most efficient
                    TerminalBufferView(sessionId: manager.sessionId)
                default: // swiftterm
                    SwiftTermView(manager: manager, targetColumnWidth: targetColumnWidth, fontSize: fontSize)
                }
            }
            
            // Scroll-to-bottom button
            if showScrollToBottom {
                Button {
                    scrollToBottom()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.down.to.line")
                        Text("Bottom")
                    }
                    .font(Theme.Typography.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Theme.Colors.secondaryBackground.opacity(0.9))
                    .foregroundStyle(Theme.Colors.text)
                    .cornerRadius(Theme.Sizes.cornerRadius)
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Sizes.cornerRadius)
                            .stroke(Theme.Colors.tertiaryText.opacity(0.3), lineWidth: 1)
                    )
                    .shadow(radius: 4)
                }
                .buttonStyle(.plain)
                .padding(Theme.Spacing.md)
                .transition(.asymmetric(
                    insertion: .move(edge: .bottom).combined(with: .opacity),
                    removal: .move(edge: .bottom).combined(with: .opacity)
                ))
            }
        }
        .onAppear {
            // Set up scroll monitoring
            startScrollMonitoring()
        }
    }
    
    private func startScrollMonitoring() {
        // Monitor scroll position changes
        NotificationCenter.default.addObserver(
            forName: NSScrollView.didLiveScrollNotification,
            object: nil,
            queue: .main
        ) { notification in
            if let scrollView = notification.object as? NSScrollView {
                DispatchQueue.main.async {
                    self.updateScrollToBottomVisibility(scrollView)
                }
            }
        }
    }
    
    @MainActor
    private func updateScrollToBottomVisibility(_ scrollView: NSScrollView) {
        guard let documentView = scrollView.documentView else { return }
        
        let visibleRect = scrollView.visibleRect
        let documentRect = documentView.frame
        
        // Show button if we're not near the bottom (more than 100 pixels away)
        let isNearBottom = visibleRect.maxY >= documentRect.maxY - 100
        
        withAnimation(Theme.Animation.quick) {
            showScrollToBottom = !isNearBottom && documentRect.height > visibleRect.height
        }
    }
    
    private func scrollToBottom() {
        if let scrollView = scrollViewProxy,
           let documentView = scrollView.documentView {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.3
                context.allowsImplicitAnimation = true
                documentView.scroll(NSPoint(x: 0, y: documentView.frame.maxY))
            }
        }
    }
}

// Extension to post scroll view notifications
extension Notification.Name {
    static let terminalScrollViewChanged = Notification.Name("terminalScrollViewChanged")
}