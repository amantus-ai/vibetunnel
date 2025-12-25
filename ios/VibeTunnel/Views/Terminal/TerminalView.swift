import Observation
import SwiftUI

private let logger = Logger(category: "TerminalView")

/// Interactive terminal view for a session.
///
/// Displays a full terminal emulator using ghostty-web with support for
/// input, output, recording, and font size adjustment.
struct TerminalView: View {
    let session: Session
    @Environment(\.dismiss)
    var dismiss
    @State private var viewModel: TerminalViewModel
    @State private var fontSize: CGFloat = 14
    @State private var showingFontSizeSheet = false
    @State private var showingRecordingSheet = false
    @State private var showingTerminalWidthSheet = false
    @State private var showingTerminalThemeSheet = false
    @State private var selectedTerminalWidth: Int?
    @State private var selectedTheme = TerminalTheme.selected
    @State private var keyboardHeight: CGFloat = 0
    @State private var showScrollToBottom = false
    @State private var showingFileBrowser = false
    @State private var showingExportSheet = false
    @State private var exportedFileURL: URL?
    @State private var showingWidthSelector = false
    @State private var currentTerminalWidth: TerminalWidth = .unlimited
    @State private var showingFullscreenInput = false
    @State private var showingCtrlKeyGrid = false
    @FocusState private var isInputFocused: Bool

    init(session: Session) {
        self.session = session
        self._viewModel = State(initialValue: TerminalViewModel(session: session))
    }

    var body: some View {
        NavigationStack {
            self.mainContent
                .navigationTitle(self.session.displayName)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar(.visible, for: .bottomBar)
                .toolbarBackground(.automatic, for: .bottomBar)
                .toolbar {
                    self.navigationToolbarItems
                    self.bottomToolbarItems
                    self.recordingIndicator
                }
        }
        .focusable()
        .onAppear {
            self.viewModel.connect()
            self.isInputFocused = true
        }
        .onDisappear {
            self.viewModel.disconnect()
        }
        .sheet(isPresented: self.$showingFontSizeSheet) {
            FontSizeSheet(fontSize: self.$fontSize)
        }
        .sheet(isPresented: self.$showingRecordingSheet) {
            RecordingExportSheet(recorder: self.viewModel.castRecorder, sessionName: self.session.displayName)
        }
        .sheet(isPresented: self.$showingTerminalWidthSheet) {
            TerminalWidthSheet(
                selectedWidth: self.$selectedTerminalWidth,
                isResizeBlockedByServer: self.viewModel.isResizeBlockedByServer)
                .onAppear {
                    self.selectedTerminalWidth = self.viewModel.terminalCols
                }
        }
        .sheet(isPresented: self.$showingTerminalThemeSheet) {
            TerminalThemeSheet(selectedTheme: self.$selectedTheme)
        }
        .sheet(isPresented: self.$showingFileBrowser) {
            FileBrowserView(
                initialPath: self.session.workingDir,
                mode: .insertPath,
                onSelect: { _ in
                    self.showingFileBrowser = false
                },
                onInsertPath: { [weak viewModel] path, _ in
                    // Insert the path into the terminal
                    viewModel?.sendInput(path)
                    self.showingFileBrowser = false
                })
        }
        .sheet(isPresented: self.$showingFullscreenInput) {
            FullscreenTextInput(isPresented: self.$showingFullscreenInput) { [weak viewModel] text in
                viewModel?.sendInput(text)
            }
        }
        .sheet(isPresented: self.$showingCtrlKeyGrid) {
            CtrlKeyGrid(isPresented: self.$showingCtrlKeyGrid) { [weak viewModel] controlChar in
                viewModel?.sendInput(controlChar)
            }
        }
        .gesture(
            DragGesture()
                .onEnded { value in
                    if value.startLocation.x < 20, value.translation.width > 50 {
                        self.dismiss()
                        HapticFeedback.impact(.light)
                    }
                })
        .task {
            for await notification in NotificationCenter.default
                .notifications(named: UIResponder.keyboardWillShowNotification)
            {
                if let keyboardFrame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
                    withAnimation(Theme.Animation.standard) {
                        self.keyboardHeight = keyboardFrame.height
                    }
                }
            }
        }
        .task {
            for await _ in NotificationCenter.default.notifications(named: UIResponder.keyboardWillHideNotification) {
                withAnimation(Theme.Animation.standard) {
                    self.keyboardHeight = 0
                }
            }
        }
        .onChange(of: self.selectedTerminalWidth) { _, newValue in
            if let width = newValue, width != viewModel.terminalCols {
                let aspectRatio = Double(viewModel.terminalRows) / Double(self.viewModel.terminalCols)
                let newHeight = Int(Double(width) * aspectRatio)
                self.viewModel.resize(cols: width, rows: newHeight)
            }
        }
        .onChange(of: self.currentTerminalWidth) { _, newWidth in
            let targetWidth = newWidth.value == 0 ? nil : newWidth.value
            if targetWidth != self.selectedTerminalWidth {
                self.selectedTerminalWidth = targetWidth
                self.viewModel.setMaxWidth(targetWidth ?? 0)
                TerminalWidthManager.shared.defaultWidth = newWidth.value
            }
        }
        .onChange(of: self.viewModel.isAtBottom) { _, newValue in
            withAnimation(Theme.Animation.smooth) {
                self.showScrollToBottom = !newValue
            }
        }
        // iPad keyboard shortcuts
        .onKeyPress(keys: ["o"]) { press in
            if press.modifiers.contains(.command), self.session.isRunning {
                self.showingFileBrowser = true
                return .handled
            }
            return .ignored
        }
        .onKeyPress(keys: ["+"]) { press in
            if press.modifiers.contains(.command) {
                // Increase font size
                withAnimation(Theme.Animation.quick) {
                    self.fontSize = min(self.fontSize + 2, 30)
                }
                return .handled
            }
            return .ignored
        }
        .onKeyPress(keys: ["-"]) { press in
            if press.modifiers.contains(.command) {
                // Decrease font size
                withAnimation(Theme.Animation.quick) {
                    self.fontSize = max(self.fontSize - 2, 8)
                }
                return .handled
            }
            return .ignored
        }
        .onKeyPress(keys: ["t"]) { press in
            if press.modifiers.contains(.command) {
                // Toggle theme
                let themes = TerminalTheme.allThemes
                if let currentIndex = themes.firstIndex(where: { $0.id == selectedTheme.id }) {
                    let nextIndex = (currentIndex + 1) % themes.count
                    self.selectedTheme = themes[nextIndex]
                    TerminalTheme.selected = self.selectedTheme
                }
                return .handled
            }
            return .ignored
        }
        .onKeyPress(keys: ["k"]) { press in
            if press.modifiers.contains(.command) {
                // Clear terminal
                self.viewModel.sendSpecialKey(.ctrlL)
                return .handled
            }
            return .ignored
        }
        .onKeyPress(keys: ["c"]) { press in
            if press.modifiers.contains(.command), !press.modifiers.contains(.shift) {
                // Copy to clipboard
                if let content = viewModel.getBufferContent() {
                    UIPasteboard.general.string = content
                    HapticFeedback.notification(.success)
                }
                return .handled
            }
            return .ignored
        }
        .onKeyPress(keys: ["r"]) { press in
            if press.modifiers.contains(.command) {
                // Start/stop recording
                if self.viewModel.castRecorder.isRecording {
                    self.viewModel.stopRecording()
                } else {
                    self.viewModel.startRecording()
                }
                return .handled
            }
            return .ignored
        }
        .onKeyPress(keys: ["w"]) { press in
            if press.modifiers.contains(.command) {
                // Change terminal width
                self.showingTerminalWidthSheet = true
                return .handled
            }
            return .ignored
        }
        .onKeyPress(keys: [.escape]) { _ in
            // Send escape key to terminal
            self.viewModel.sendSpecialKey(.escape)
            return .handled
        }
        .onKeyPress(keys: [.tab]) { _ in
            // Send tab key to terminal
            self.viewModel.sendSpecialKey(.tab)
            return .handled
        }
        .sheet(isPresented: self.$showingExportSheet) {
            if let url = exportedFileURL {
                ShareSheet(items: [url])
                    .onDisappear {
                        // Clean up temporary file
                        try? FileManager.default.removeItem(at: url)
                        self.exportedFileURL = nil
                    }
            }
        }
    }

    // MARK: - Export Functions

    private func exportTerminalBuffer() {
        guard let bufferContent = viewModel.getBufferContent() else { return }

        let fileName = "\(session.displayName)_\(Date().timeIntervalSince1970).txt"
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)

        do {
            try bufferContent.write(to: tempURL, atomically: true, encoding: .utf8)
            self.exportedFileURL = tempURL
            self.showingExportSheet = true
        } catch {
            logger.error("Failed to export terminal buffer: \(error)")
        }
    }

    // MARK: - View Components

    private var mainContent: some View {
        ZStack {
            self.selectedTheme.background
                .ignoresSafeArea()

            VStack(spacing: 0) {
                if self.viewModel.isConnecting {
                    self.loadingView
                } else if let error = viewModel.errorMessage {
                    self.errorView(error)
                } else {
                    self.terminalContent
                }
            }
        }
    }

    private var navigationToolbarItems: some ToolbarContent {
        Group {
            ToolbarItem(placement: .navigationBarLeading) {
                Button("Close") {
                    self.dismiss()
                }
                .foregroundColor(Theme.Colors.primaryAccent)
            }

            ToolbarItemGroup(placement: .navigationBarTrailing) {
                QuickFontSizeButtons(fontSize: self.$fontSize)
                    .fixedSize()
                self.fileBrowserButton
                self.widthSelectorButton
                self.menuButton
            }
        }
    }

    private var bottomToolbarItems: some ToolbarContent {
        ToolbarItemGroup(placement: .bottomBar) {
            self.terminalSizeIndicator
            Spacer()
        }
    }

    private var recordingIndicator: some ToolbarContent {
        ToolbarItem(placement: .navigationBarTrailing) {
            if self.viewModel.castRecorder.isRecording {
                self.recordingView
            }
        }
    }

    // MARK: - Toolbar Components

    private var fileBrowserButton: some View {
        Button(action: {
            HapticFeedback.impact(.light)
            self.showingFileBrowser = true
        }, label: {
            Image(systemName: "folder")
                .font(.system(size: 16))
                .foregroundColor(Theme.Colors.primaryAccent)
        })
    }

    private var widthSelectorButton: some View {
        Button(action: { self.showingWidthSelector = true }, label: {
            HStack(spacing: 2) {
                Image(systemName: "arrow.left.and.right")
                    .font(.system(size: 12))
                Text(self.currentTerminalWidth.label)
                    .font(Theme.Typography.terminalSystem(size: 14))
                    .fontWeight(.medium)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Theme.Colors.cardBackground)
            .cornerRadius(6)
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(Theme.Colors.primaryAccent.opacity(0.3), lineWidth: 1))
        })
        .foregroundColor(Theme.Colors.primaryAccent)
        .popover(isPresented: self.$showingWidthSelector, arrowEdge: .top) {
            WidthSelectorPopover(
                currentWidth: self.$currentTerminalWidth,
                isPresented: self.$showingWidthSelector)
        }
    }

    private var menuButton: some View {
        Menu {
            self.terminalMenuItems
        } label: {
            Image(systemName: "ellipsis.circle")
                .foregroundColor(Theme.Colors.primaryAccent)
        }
    }

    @ViewBuilder private var terminalMenuItems: some View {
        Button(action: { self.viewModel.clearTerminal() }, label: {
            Label("Clear", systemImage: "clear")
        })

        Button(action: { self.showingFullscreenInput = true }, label: {
            Label("Compose Command", systemImage: "text.viewfinder")
        })

        Button(action: { self.showingCtrlKeyGrid = true }, label: {
            Label("Ctrl Shortcuts", systemImage: "command.square")
        })

        Divider()

        Menu {
            Button(action: {
                self.fontSize = max(8, self.fontSize - 1)
                HapticFeedback.impact(.light)
            }, label: {
                Label("Decrease", systemImage: "minus")
            })
            .disabled(self.fontSize <= 8)

            Button(action: {
                self.fontSize = min(32, self.fontSize + 1)
                HapticFeedback.impact(.light)
            }, label: {
                Label("Increase", systemImage: "plus")
            })
            .disabled(self.fontSize >= 32)

            Button(action: {
                self.fontSize = 14
                HapticFeedback.impact(.light)
            }, label: {
                Label("Reset to Default", systemImage: "arrow.counterclockwise")
            })
            .disabled(self.fontSize == 14)

            Divider()

            Button(action: { self.showingFontSizeSheet = true }, label: {
                Label("More Options...", systemImage: "slider.horizontal.3")
            })
        } label: {
            Label("Font Size (\(Int(self.fontSize))pt)", systemImage: "textformat.size")
        }

        Button(action: { self.showingTerminalWidthSheet = true }, label: {
            Label("Terminal Width", systemImage: "arrow.left.and.right")
        })

        Button(action: { self.viewModel.toggleFitToWidth() }, label: {
            Label(
                self.viewModel.fitToWidth ? "Fixed Width" : "Fit to Width",
                systemImage: self.viewModel
                    .fitToWidth ? "arrow.left.and.right.square" : "arrow.left.and.right.square.fill")
        })

        Button(action: { self.showingTerminalThemeSheet = true }, label: {
            Label("Theme", systemImage: "paintbrush")
        })

        Button(action: { self.viewModel.copyBuffer() }, label: {
            Label("Copy All", systemImage: "square.on.square")
        })

        Button(action: { self.exportTerminalBuffer() }, label: {
            Label("Export as Text", systemImage: "square.and.arrow.up")
        })

        Divider()

        self.recordingMenuItems
    }

    @ViewBuilder private var recordingMenuItems: some View {
        if self.viewModel.castRecorder.isRecording {
            Button(action: {
                self.viewModel.stopRecording()
                self.showingRecordingSheet = true
            }, label: {
                Label("Stop Recording", systemImage: "stop.circle.fill")
                    .foregroundColor(.red)
            })
        } else {
            Button(action: { self.viewModel.startRecording() }, label: {
                Label("Start Recording", systemImage: "record.circle")
            })
        }

        Button(action: { self.showingRecordingSheet = true }, label: {
            Label("Export Recording", systemImage: "square.and.arrow.up")
        })
        .disabled(self.viewModel.castRecorder.events.isEmpty)
    }

    @ViewBuilder private var terminalSizeIndicator: some View {
        if self.viewModel.terminalCols > 0, self.viewModel.terminalRows > 0 {
            Text("\(self.viewModel.terminalCols)×\(self.viewModel.terminalRows)")
                .font(Theme.Typography.terminalSystem(size: 11))
                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.5))
        }
    }

    private var recordingView: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(Theme.Colors.errorAccent)
                .frame(width: 8, height: 8)
                .overlay(
                    Circle()
                        .fill(Theme.Colors.errorAccent.opacity(0.3))
                        .frame(width: 16, height: 16)
                        .scaleEffect(self.viewModel.recordingPulse ? 1.5 : 1.0)
                        .animation(
                            .easeInOut(duration: 1.0).repeatForever(autoreverses: true),
                            value: self.viewModel.recordingPulse))
            Text("REC")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(Theme.Colors.errorAccent)
        }
        .onAppear {
            self.viewModel.recordingPulse = true
        }
    }

    private var loadingView: some View {
        VStack(spacing: Theme.Spacing.large) {
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: Theme.Colors.primaryAccent))
                .scaleEffect(1.5)

            Text("Connecting to session...")
                .font(Theme.Typography.terminalSystem(size: 14))
                .foregroundColor(Theme.Colors.terminalForeground)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorView(_ error: String) -> some View {
        VStack(spacing: Theme.Spacing.large) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundColor(Theme.Colors.errorAccent)

            Text("Connection Error")
                .font(.headline)
                .foregroundColor(Theme.Colors.terminalForeground)

            Text(error)
                .font(Theme.Typography.terminalSystem(size: 12))
                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Button("Retry") {
                self.viewModel.connect()
            }
            .terminalButton()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var terminalContent: some View {
        let terminalSize = self.viewModel.terminalCols > 0 && self.viewModel.terminalRows > 0
            ? GhosttyWebView.TerminalSize(
                cols: self.viewModel.terminalCols,
                rows: self.viewModel.terminalRows)
            : nil

        return VStack(spacing: 0) {
            GhosttyWebView(
                fontSize: self.$fontSize,
                theme: self.selectedTheme,
                onInput: { text in
                    self.viewModel.sendInput(text)
                },
                onResize: { cols, rows in
                    self.viewModel.resize(cols: cols, rows: rows)
                },
                viewModel: self.viewModel,
                disableInput: !self.session.isRunning,
                terminalSize: terminalSize)
                .id(self.viewModel.terminalViewId)
                .background(self.selectedTheme.background)
                .focused(self.$isInputFocused)
                .overlay(
                    ScrollToBottomButton(
                        isVisible: self.showScrollToBottom)
                    {
                        self.viewModel.scrollToBottom()
                        self.showScrollToBottom = false
                    }
                    .padding(.bottom, Theme.Spacing.large)
                    .padding(.leading, Theme.Spacing.large),
                    alignment: .bottomLeading)

            // Keyboard toolbar
            if self.keyboardHeight > 0 {
                TerminalToolbar(
                    onSpecialKey: { key in
                        self.viewModel.sendInput(key.rawValue)
                    },
                    onDismissKeyboard: {
                        self.isInputFocused = false
                    },
                    onRawInput: { input in
                        self.viewModel.sendInput(input)
                    })
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }
}

/// View model for terminal session management.
/// View model for terminal session management.
/// Handles terminal I/O, recording, state management, and WebSocket communication.
@MainActor
@Observable
class TerminalViewModel {
    var isConnecting = true
    var isConnected = false
    var errorMessage: String?
    var terminalViewId = UUID()
    var terminalCols: Int = 0
    var terminalRows: Int = 0
    var isAutoScrollEnabled = true
    var recordingPulse = false
    var isResizeBlockedByServer = false
    var isAtBottom = true
    var fitToWidth = false

    let session: Session
    let castRecorder: CastRecorder
    let bufferWebSocketClient: BufferWebSocketClient
    private var connectionStatusTask: Task<Void, Never>?
    private var connectionErrorTask: Task<Void, Never>?
    private var resizeDebounceTask: Task<Void, Never>?
    private var hasPerformedInitialResize = false
    private var isPerformingInitialResize = false
    weak var terminalCoordinator: (any TerminalCoordinating)?

    init(session: Session) {
        self.session = session
        self.castRecorder = CastRecorder(sessionId: session.id, width: 80, height: 24)
        self.bufferWebSocketClient = BufferWebSocketClient.shared
        self.setupTerminal()
    }

    private func setupTerminal() {
        // Terminal setup handled by GhosttyWebView
    }

    func startRecording() {
        self.castRecorder.startRecording()
    }

    func stopRecording() {
        self.castRecorder.stopRecording()
    }

    func connect() {
        self.isConnecting = true
        self.errorMessage = nil

        // Subscribe to terminal events first (stores the handler)
        self.bufferWebSocketClient.subscribe(to: self.session.id) { [weak self] event in
            Task { @MainActor in
                self?.handleWebSocketEvent(event)
            }
        }

        // Connect to WebSocket - it will automatically subscribe to stored sessions
        self.bufferWebSocketClient.connect()

        // Monitor connection status
        self.connectionStatusTask?.cancel()
        self.connectionStatusTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                let connected = self.bufferWebSocketClient.isConnected
                await MainActor.run {
                    self.isConnecting = false
                    self.isConnected = connected
                    if !connected {
                        self.errorMessage = "WebSocket disconnected"
                    } else {
                        self.errorMessage = nil
                    }
                }
                try? await Task.sleep(nanoseconds: 500_000_000) // Check every 0.5 seconds
            }
        }

        // Monitor connection errors
        self.connectionErrorTask?.cancel()
        self.connectionErrorTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                if let error = self.bufferWebSocketClient.connectionError {
                    await MainActor.run {
                        self.errorMessage = error.localizedDescription
                        self.isConnecting = false
                    }
                }
                try? await Task.sleep(nanoseconds: 500_000_000) // Check every 0.5 seconds
            }
        }
    }

    func disconnect() {
        self.connectionStatusTask?.cancel()
        self.connectionErrorTask?.cancel()
        self.resizeDebounceTask?.cancel()
        self.bufferWebSocketClient.unsubscribe(from: self.session.id)
        // Note: Don't disconnect the shared client as other views might be using it
        self.isConnected = false
    }

    @MainActor
    private func handleWebSocketEvent(_ event: TerminalWebSocketEvent) {
        switch event {
        case let .header(width, height):
            // Initial terminal setup
            logger.info("Terminal initialized: \(width)x\(height)")
            self.terminalCols = width
            self.terminalRows = height
        // The terminal will be resized when created

        case let .output(_, data):
            // Feed output data directly to the terminal
            if let coordinator = terminalCoordinator {
                coordinator.feedData(data)
            } else {
                // Queue the data to be fed once coordinator is ready
                logger.warning("Terminal coordinator not ready, queueing data")
                Task {
                    // Wait a bit for coordinator to be initialized
                    try? await Task.sleep(nanoseconds: 100_000_000) // 0.1s
                    if let coordinator = self.terminalCoordinator {
                        coordinator.feedData(data)
                    }
                }
            }
            // Record output if recording
            self.castRecorder.recordOutput(data)

        case let .resize(_, dimensions):
            // Parse dimensions like "120x30"
            let parts = dimensions.split(separator: "x")
            if parts.count == 2,
               let cols = Int(parts[0]),
               let rows = Int(parts[1])
            {
                // Update terminal dimensions
                self.terminalCols = cols
                self.terminalRows = rows
                logger.info("Terminal resize: \(cols)x\(rows)")
                // Record resize event
                self.castRecorder.recordResize(cols: cols, rows: rows)
            }

        case let .exit(code):
            // Session has exited
            self.isConnected = false
            if code != 0 {
                self.errorMessage = "Session exited with code \(code)"
            }
            // Stop recording if active
            if self.castRecorder.isRecording {
                self.stopRecording()
            }

            // Session has exited - no need to load additional content

        case let .bufferUpdate(snapshot):
            // Update terminal buffer directly
            if let coordinator = terminalCoordinator {
                coordinator.updateBuffer(from: snapshot)
            } else {
                // Fallback: buffer updates not available yet
                logger.warning("Direct buffer update not available")
            }

        case .bell:
            // Terminal bell - play sound and/or haptic feedback
            self.handleTerminalBell()

        case let .alert(title, message):
            // Terminal alert - show notification
            self.handleTerminalAlert(title: title, message: message)
        }
    }

    func sendInput(_ text: String) {
        Task { @MainActor [weak self] in
            guard let self else { return }

            let sent = await self.bufferWebSocketClient.sendInput(sessionId: self.session.id, text: text)
            if sent { return }

            do {
                try await SessionService().sendInput(to: self.session.id, text: text)
            } catch {
                logger.error("Failed to send input: \(error)")
            }
        }
    }

    func sendSpecialKey(_ key: TerminalInput.SpecialKey) {
        self.sendInput(key.rawValue)
    }

    func resize(cols: Int, rows: Int) {
        // Guard against invalid dimensions
        guard cols > 0 && rows > 0 && cols <= 1000 && rows <= 1000 else {
            logger.warning("Ignoring invalid resize: \(cols)x\(rows)")
            return
        }

        // Guard against blocked resize
        guard !self.isResizeBlockedByServer else {
            logger.warning("Resize blocked by server, ignoring resize: \(cols)x\(rows)")
            return
        }

        // Handle initial resize with proper synchronization
        if !self.hasPerformedInitialResize && !self.isPerformingInitialResize {
            self.isPerformingInitialResize = true

            // Always update UI dimensions immediately for consistency
            self.terminalCols = cols
            self.terminalRows = rows

            // Perform initial resize after a short delay to let layout settle
            self.resizeDebounceTask?.cancel()
            self.resizeDebounceTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds for initial
                guard !Task.isCancelled else {
                    await MainActor.run {
                        self?.isPerformingInitialResize = false
                    }
                    return
                }
                await self?.performInitialResize(cols: cols, rows: rows)
            }
            return
        }

        // For subsequent resizes, compare against current UI dimensions (not server dimensions)
        guard cols != self.terminalCols || rows != self.terminalRows else {
            return
        }

        // Only allow significant changes for subsequent resizes
        let colDiff = abs(cols - self.terminalCols)
        let rowDiff = abs(rows - self.terminalRows)

        // Only resize if there's a significant change (more than 5 cols/rows difference)
        guard colDiff > 5 || rowDiff > 5 else {
            logger
                .debug(
                    "Ignoring minor resize change: \(cols)x\(rows) (current: \(self.terminalCols)x\(self.terminalRows))")
            return
        }

        // Update UI dimensions immediately
        self.terminalCols = cols
        self.terminalRows = rows

        self.resizeDebounceTask?.cancel()
        self.resizeDebounceTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second for subsequent
            guard !Task.isCancelled else { return }
            await self?.performResize(cols: cols, rows: rows)
        }
    }

    private func performInitialResize(cols: Int, rows: Int) async {
        logger.info("Performing initial terminal resize: \(cols)x\(rows)")

        do {
            let sent = await self.bufferWebSocketClient.resize(sessionId: self.session.id, cols: cols, rows: rows)
            if !sent {
                try await SessionService().resizeTerminal(sessionId: self.session.id, cols: cols, rows: rows)
            }
            // If resize succeeded, mark initial resize as complete and clear any server blocks
            await MainActor.run {
                self.hasPerformedInitialResize = true
                self.isPerformingInitialResize = false
                self.isResizeBlockedByServer = false
            }
        } catch {
            logger.error("Failed initial terminal resize: \(error)")
            // Check if the error is specifically about resize being disabled
            if case APIError.resizeDisabledByServer = error {
                await MainActor.run {
                    self.hasPerformedInitialResize = true // Mark as done even if blocked to prevent retries
                    self.isPerformingInitialResize = false
                    self.isResizeBlockedByServer = true
                }
            } else {
                // For other errors, allow retry by clearing the in-progress flag but leaving hasPerformedInitialResize
                // false
                await MainActor.run {
                    self.isPerformingInitialResize = false
                }
            }
        }
    }

    private func performResize(cols: Int, rows: Int) async {
        logger.info("Resizing terminal: \(cols)x\(rows)")

        do {
            let sent = await self.bufferWebSocketClient.resize(sessionId: self.session.id, cols: cols, rows: rows)
            if !sent {
                try await SessionService().resizeTerminal(sessionId: self.session.id, cols: cols, rows: rows)
            }
            // If resize succeeded, ensure the flag is cleared
            await MainActor.run {
                self.isResizeBlockedByServer = false
            }
        } catch {
            logger.error("Failed to resize terminal: \(error)")
            // Check if the error is specifically about resize being disabled
            if case APIError.resizeDisabledByServer = error {
                await MainActor.run {
                    self.isResizeBlockedByServer = true
                }
            }
            // Note: UI dimensions remain as set, representing the actual terminal view size
        }
    }

    func clearTerminal() {
        // Reset the terminal by recreating it
        self.terminalViewId = UUID()
        HapticFeedback.impact(.medium)
    }

    func copyBuffer() {
        if let content = getBufferContent() {
            UIPasteboard.general.string = content
            HapticFeedback.notification(.success)
        }
    }

    func getBufferContent() -> String? {
        // Get the current terminal buffer content
        self.terminalCoordinator?.getBufferContent()
    }

    @MainActor
    private func handleTerminalBell() {
        // Haptic feedback for bell
        HapticFeedback.notification(.warning)

        // Visual bell - flash the terminal briefly
        withAnimation(.easeInOut(duration: 0.1)) {
            // ghostty handles visual bell internally
            // but we can add additional feedback if needed
        }
    }

    @MainActor
    private func handleTerminalAlert(title: String?, message: String) {
        // Log the alert
        logger.info("Terminal Alert - \(title ?? "Alert"): \(message)")

        // Show as a system notification if app is in background
        // For now, just provide haptic feedback
        HapticFeedback.notification(.error)
    }

    func scrollToBottom() {
        // Signal the terminal to scroll to bottom
        self.isAutoScrollEnabled = true
        self.isAtBottom = true
        // The actual scrolling is handled by the terminal coordinator
        self.terminalCoordinator?.scrollToBottom()
    }

    func updateScrollState(isAtBottom: Bool) {
        self.isAtBottom = isAtBottom
        self.isAutoScrollEnabled = isAtBottom
    }

    func toggleFitToWidth() {
        self.fitToWidth.toggle()
        HapticFeedback.impact(.light)

        if self.fitToWidth {
            // Calculate optimal width to fit the screen
            let screenWidth = UIScreen.main.bounds.width
            let padding: CGFloat = 32 // Account for UI padding
            let charWidth: CGFloat = 9 // Approximate character width
            let optimalCols = Int((screenWidth - padding) / charWidth)

            // Resize to fit
            self.resize(cols: optimalCols, rows: self.terminalRows)
        }
    }

    func setMaxWidth(_ maxWidth: Int) {
        // Store the max width preference
        // When maxWidth is 0, it means unlimited
        let targetWidth = maxWidth == 0 ? nil : maxWidth

        if let width = targetWidth, width != terminalCols {
            // Maintain aspect ratio when changing width
            let aspectRatio = Double(terminalRows) / Double(self.terminalCols)
            let newHeight = Int(Double(width) * aspectRatio)
            self.resize(cols: width, rows: newHeight)
        }

        // Update the terminal coordinator if using constrained width
        self.terminalCoordinator?.setMaxWidth(maxWidth)
    }
}

@MainActor
protocol TerminalCoordinating: AnyObject {
    func feedData(_ data: String)
    func updateBuffer(from snapshot: BufferSnapshot)
    func scrollToBottom()
    func setMaxWidth(_ maxWidth: Int)
    func getBufferContent() -> String?
}
