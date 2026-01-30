import Observation
import SwiftUI
import UIKit

private let logger = Logger(category: "TerminalView")

/// Simple terminal view - fills screen, light/dark mode only.
struct TerminalView: View {
    let session: Session
    @Environment(\.dismiss) var dismiss
    @Environment(\.colorScheme) var colorScheme
    @State private var viewModel: TerminalViewModel
    @State private var keyboardHeight: CGFloat = 0
    @State private var showingFileBrowser = false
    @State private var showingDictation = false
    @State private var dictationText = ""
    @FocusState private var isInputFocused: Bool

    init(session: Session) {
        self.session = session
        self._viewModel = State(initialValue: TerminalViewModel(session: session))
    }

    private var theme: TerminalTheme {
        TerminalTheme.forColorScheme(colorScheme)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Simple header
            header

            // Terminal fills available space (shrinks when keyboard appears)
            terminalContent
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            // Voice input bar - floating above toolbar when active
            if showingDictation {
                VoiceInputBar(
                    text: $dictationText,
                    isVisible: $showingDictation,
                    onSubmit: { textToSend in
                        // Send text only - user presses Enter
                        viewModel.sendInput(textToSend)
                        // Clear for next time
                        dictationText = ""
                    },
                    onClose: {
                        // Briefly dismiss keyboard to stop dictation, then refocus
                        viewModel.terminalCoordinator?.dismissKeyboard()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                            viewModel.terminalCoordinator?.focusTerminal()
                        }
                    })
            }

            // Keyboard toolbar - always above keyboard
            if keyboardHeight > 0 {
                TerminalToolbar(
                    onSpecialKey: { key in
                        viewModel.sendInput(key.rawValue)
                    },
                    onDismissKeyboard: {
                        viewModel.terminalCoordinator?.dismissKeyboard()
                        showingDictation = false
                    },
                    onRawInput: { input in
                        viewModel.sendInput(input)
                    },
                    onDictation: {
                        showingDictation = true
                    })
            }
        }
        .background(theme.background)
        .navigationBarHidden(true)
        .onAppear {
            viewModel.connect()
            isInputFocused = true
        }
        .onDisappear {
            viewModel.disconnect()
        }
        .sheet(isPresented: $showingFileBrowser) {
            FileBrowserView(
                initialPath: session.workingDir,
                mode: .insertPath,
                onSelect: { _ in showingFileBrowser = false },
                onInsertPath: { path, _ in
                    viewModel.sendInput(path)
                    showingFileBrowser = false
                })
        }
        .gesture(
            DragGesture()
                .onEnded { value in
                    if value.startLocation.x < 20, value.translation.width > 50 {
                        dismiss()
                    }
                })
        .task {
            for await notification in NotificationCenter.default
                .notifications(named: UIResponder.keyboardWillShowNotification)
            {
                if let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
                    withAnimation(.easeOut(duration: 0.25)) {
                        keyboardHeight = frame.height
                    }
                }
            }
        }
        .task {
            for await _ in NotificationCenter.default
                .notifications(named: UIResponder.keyboardWillHideNotification)
            {
                withAnimation(.easeOut(duration: 0.25)) {
                    keyboardHeight = 0
                }
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button(action: { dismiss() }) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .medium))
            }

            Spacer()

            Text(session.displayName)
                .font(.headline)
                .lineLimit(1)

            Spacer()

            Button(action: { showingFileBrowser = true }) {
                Image(systemName: "folder")
                    .font(.system(size: 16))
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .foregroundColor(theme.foreground)
        .background(theme.background)
    }

    // MARK: - Terminal Content

    private var terminalContent: some View {
        ZStack {
            if viewModel.isConnecting {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: theme.foreground))
            } else if let error = viewModel.errorMessage {
                VStack(spacing: 16) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                    Text(error)
                        .font(.caption)
                        .multilineTextAlignment(.center)
                    Button("Retry") { viewModel.connect() }
                }
                .foregroundColor(theme.foreground)
            } else {
                SwiftTerminalView(
                    fontSize: .constant(14),
                    theme: theme,
                    onInput: { text in viewModel.sendInput(text) },
                    onResize: { cols, rows in viewModel.resize(cols: cols, rows: rows) },
                    viewModel: viewModel,
                    disableInput: !session.isRunning)
                    .focused($isInputFocused)
            }
        }
    }
}

// MARK: - View Model

@MainActor
@Observable
class TerminalViewModel {
    var isConnecting = true
    var isConnected = false
    var errorMessage: String?
    var terminalViewId = UUID()
    var terminalCols: Int = 80
    var terminalRows: Int = 24
    var isAtBottom = true

    let session: Session
    let castRecorder: CastRecorder
    let bufferWebSocketClient: BufferWebSocketClient
    private var connectionStatusTask: Task<Void, Never>?
    private var connectionErrorTask: Task<Void, Never>?
    private var resizeDebounceTask: Task<Void, Never>?
    private var pendingEvents: [TerminalWebSocketEvent] = []

    weak var terminalCoordinator: (any TerminalCoordinating)? {
        didSet {
            if terminalCoordinator != nil {
                flushPendingEvents()
            }
        }
    }

    init(session: Session) {
        self.session = session
        self.castRecorder = CastRecorder(sessionId: session.id, width: 80, height: 24)
        self.bufferWebSocketClient = BufferWebSocketClient.shared
    }

    func connect() {
        isConnecting = true
        errorMessage = nil

        bufferWebSocketClient.subscribe(to: session.id) { [weak self] event in
            Task { @MainActor in
                self?.handleWebSocketEvent(event)
            }
        }

        bufferWebSocketClient.connect()

        connectionStatusTask?.cancel()
        connectionStatusTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                let connected = bufferWebSocketClient.isConnected
                await MainActor.run {
                    self.isConnecting = false
                    self.isConnected = connected
                    if !connected {
                        self.errorMessage = "Disconnected"
                    } else {
                        self.errorMessage = nil
                    }
                }
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
        }
    }

    func disconnect() {
        connectionStatusTask?.cancel()
        connectionErrorTask?.cancel()
        resizeDebounceTask?.cancel()
        bufferWebSocketClient.unsubscribe(from: session.id)
        isConnected = false
    }

    @MainActor
    private func handleWebSocketEvent(_ event: TerminalWebSocketEvent) {
        switch event {
        case let .header(width, height):
            terminalCols = width
            terminalRows = height

        case let .output(_, data):
            if let coordinator = terminalCoordinator {
                coordinator.feedData(data)
            } else {
                pendingEvents.append(event)
            }
            castRecorder.recordOutput(data)

        case let .resize(_, dimensions):
            let parts = dimensions.split(separator: "x")
            if parts.count == 2,
               let cols = Int(parts[0]),
               let rows = Int(parts[1])
            {
                terminalCols = cols
                terminalRows = rows
                castRecorder.recordResize(cols: cols, rows: rows)
            }

        case let .exit(code):
            isConnected = false
            if code != 0 {
                errorMessage = "Session exited with code \(code)"
            }
            if castRecorder.isRecording {
                castRecorder.stopRecording()
            }

        case let .bufferUpdate(snapshot):
            if let coordinator = terminalCoordinator {
                coordinator.updateBuffer(from: snapshot)
            } else {
                pendingEvents.append(event)
            }

        case .bell:
            HapticFeedback.notification(.warning)

        case let .alert(title, message):
            logger.info("Alert - \(title ?? "Alert"): \(message)")
        }
    }

    @MainActor
    private func flushPendingEvents() {
        guard let coordinator = terminalCoordinator, !pendingEvents.isEmpty else { return }
        for event in pendingEvents {
            switch event {
            case let .output(_, data):
                coordinator.feedData(data)
            case let .bufferUpdate(snapshot):
                coordinator.updateBuffer(from: snapshot)
            default:
                break
            }
        }
        pendingEvents.removeAll()
    }

    func sendInput(_ text: String) {
        Task { @MainActor in
            let sent = await bufferWebSocketClient.sendInput(sessionId: session.id, text: text)
            if !sent {
                do {
                    try await SessionService().sendInput(to: session.id, text: text)
                } catch {
                    logger.error("Failed to send input: \(error)")
                }
            }
        }
    }

    func resize(cols: Int, rows: Int) {
        guard cols > 0 && rows > 0 && cols <= 1000 && rows <= 1000 else { return }
        guard cols != terminalCols || rows != terminalRows else { return }

        terminalCols = cols
        terminalRows = rows

        resizeDebounceTask?.cancel()
        resizeDebounceTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            await self?.performResize(cols: cols, rows: rows)
        }
    }

    private func performResize(cols: Int, rows: Int) async {
        let sent = await bufferWebSocketClient.resize(sessionId: session.id, cols: cols, rows: rows)
        if !sent {
            do {
                try await SessionService().resizeTerminal(sessionId: session.id, cols: cols, rows: rows)
            } catch {
                logger.error("Failed to resize: \(error)")
            }
        }
    }

    func updateScrollState(isAtBottom: Bool) {
        self.isAtBottom = isAtBottom
    }

    // Backward compatibility methods
    var isAutoScrollEnabled: Bool { isAtBottom }

    func setError(_ message: String) {
        errorMessage = message
        isConnecting = false
    }
}

@MainActor
protocol TerminalCoordinating: AnyObject {
    func feedData(_ data: String)
    func updateBuffer(from snapshot: BufferSnapshot)
    func scrollToBottom()
    func setMaxWidth(_ maxWidth: Int)
    func getBufferContent() -> String?
    func dismissKeyboard()
    func focusTerminal()
}
