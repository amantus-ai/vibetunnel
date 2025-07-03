import Observation
import SwiftTerm
import SwiftUI

private let logger = Logger(category: "TerminalView")

/// Interactive terminal view for a session.
///
/// Displays a full terminal emulator using SwiftTerm with support for
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
    @State private var selectedRenderer = TerminalRenderer.selected
    @State private var showingDebugMenu = false
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
            mainContent
                .navigationTitle(session.displayName)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar(.visible, for: .bottomBar)
                .toolbarBackground(.automatic, for: .bottomBar)
                .toolbar {
                    navigationToolbarItems
                    bottomToolbarItems
                    recordingIndicator
                }
        }
        .focusable()
        .onAppear {
            viewModel.connect()
            isInputFocused = true
        }
        .onDisappear {
            viewModel.disconnect()
        }
        .sheet(isPresented: $showingFontSizeSheet) {
            FontSizeSheet(fontSize: $fontSize)
        }
        .sheet(isPresented: $showingRecordingSheet) {
            RecordingExportSheet(recorder: viewModel.castRecorder, sessionName: session.displayName)
        }
        .sheet(isPresented: $showingTerminalWidthSheet) {
            TerminalWidthSheet(
                selectedWidth: $selectedTerminalWidth,
                isResizeBlockedByServer: viewModel.isResizeBlockedByServer
            )
            .onAppear {
                selectedTerminalWidth = viewModel.terminalCols
            }
        }
        .sheet(isPresented: $showingTerminalThemeSheet) {
            TerminalThemeSheet(selectedTheme: $selectedTheme)
        }
        .sheet(isPresented: $showingFileBrowser) {
            FileBrowserView(
                initialPath: session.workingDir,
                mode: .insertPath,
                onSelect: { _ in
                    showingFileBrowser = false
                },
                onInsertPath: { [weak viewModel] path, _ in
                    // Insert the path into the terminal
                    viewModel?.sendInput(path)
                    showingFileBrowser = false
                }
            )
        }
        .sheet(isPresented: $showingFullscreenInput) {
            FullscreenTextInput(isPresented: $showingFullscreenInput) { [weak viewModel] text in
                viewModel?.sendInput(text)
            }
        }
        .sheet(isPresented: $showingCtrlKeyGrid) {
            CtrlKeyGrid(isPresented: $showingCtrlKeyGrid) { [weak viewModel] controlChar in
                viewModel?.sendInput(controlChar)
            }
        }
        .gesture(
            DragGesture()
                .onEnded { value in
                    if value.startLocation.x < 20 && value.translation.width > 50 {
                        dismiss()
                        HapticFeedback.impact(.light)
                    }
                }
        )
        .task {
            for await notification in NotificationCenter.default
                .notifications(named: UIResponder.keyboardWillShowNotification)
            {
                if let keyboardFrame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
                    withAnimation(Theme.Animation.standard) {
                        keyboardHeight = keyboardFrame.height
                    }
                }
            }
        }
        .task {
            for await _ in NotificationCenter.default.notifications(named: UIResponder.keyboardWillHideNotification) {
                withAnimation(Theme.Animation.standard) {
                    keyboardHeight = 0
                }
            }
        }
        .onChange(of: selectedTerminalWidth) { _, newValue in
            if let width = newValue, width != viewModel.terminalCols {
                let aspectRatio = Double(viewModel.terminalRows) / Double(viewModel.terminalCols)
                let newHeight = Int(Double(width) * aspectRatio)
                viewModel.resize(cols: width, rows: newHeight)
            }
        }
        .onChange(of: currentTerminalWidth) { _, newWidth in
            let targetWidth = newWidth.value == 0 ? nil : newWidth.value
            if targetWidth != selectedTerminalWidth {
                selectedTerminalWidth = targetWidth
                viewModel.setMaxWidth(targetWidth ?? 0)
                TerminalWidthManager.shared.defaultWidth = newWidth.value
            }
        }
        .onChange(of: viewModel.isAtBottom) { _, newValue in
            withAnimation(Theme.Animation.smooth) {
                showScrollToBottom = !newValue
            }
        }
        // iPad keyboard shortcuts
        .onKeyPress(keys: ["o"]) { press in
            if press.modifiers.contains(.command) && session.isRunning {
                showingFileBrowser = true
                return .handled
            }
            return .ignored
        }
        .onKeyPress(keys: ["+"]) { press in
            if press.modifiers.contains(.command) {
                // Increase font size
                withAnimation(Theme.Animation.quick) {
                    fontSize = min(fontSize + 2, 30)
                }
                return .handled
            }
            return .ignored
        }
        .onKeyPress(keys: ["-"]) { press in
            if press.modifiers.contains(.command) {
                // Decrease font size
                withAnimation(Theme.Animation.quick) {
                    fontSize = max(fontSize - 2, 8)
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
                    selectedTheme = themes[nextIndex]
                    TerminalTheme.selected = selectedTheme
                }
                return .handled
            }
            return .ignored
        }
        .onKeyPress(keys: ["k"]) { press in
            if press.modifiers.contains(.command) {
                // Clear terminal
                viewModel.sendSpecialKey(.ctrlL)
                return .handled
            }
            return .ignored
        }
        .onKeyPress(keys: ["c"]) { press in
            if press.modifiers.contains(.command) && !press.modifiers.contains(.shift) {
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
                if viewModel.castRecorder.isRecording {
                    viewModel.stopRecording()
                } else {
                    viewModel.startRecording()
                }
                return .handled
            }
            return .ignored
        }
        .onKeyPress(keys: ["w"]) { press in
            if press.modifiers.contains(.command) {
                // Change terminal width
                showingTerminalWidthSheet = true
                return .handled
            }
            return .ignored
        }
        .onKeyPress(keys: ["d"]) { press in
            if press.modifiers.contains(.command) {
                // Toggle debug menu
                showingDebugMenu.toggle()
                return .handled
            }
            return .ignored
        }
        .onKeyPress(keys: [.escape]) { _ in
            // Send escape key to terminal
            viewModel.sendSpecialKey(.escape)
            return .handled
        }
        .onKeyPress(keys: [.tab]) { _ in
            // Send tab key to terminal
            viewModel.sendSpecialKey(.tab)
            return .handled
        }
        .sheet(isPresented: $showingExportSheet) {
            if let url = exportedFileURL {
                ShareSheet(items: [url])
                    .onDisappear {
                        // Clean up temporary file
                        try? FileManager.default.removeItem(at: url)
                        exportedFileURL = nil
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
            exportedFileURL = tempURL
            showingExportSheet = true
        } catch {
            logger.error("Failed to export terminal buffer: \(error)")
        }
    }

    // MARK: - View Components

    private var mainContent: some View {
        ZStack {
            selectedTheme.background
                .ignoresSafeArea()

            VStack(spacing: 0) {
                if viewModel.isConnecting {
                    loadingView
                } else if let error = viewModel.errorMessage {
                    errorView(error)
                } else {
                    terminalContent
                }
            }
        }
    }

    private var navigationToolbarItems: some ToolbarContent {
        Group {
            ToolbarItem(placement: .navigationBarLeading) {
                Button("Close") {
                    dismiss()
                }
                .foregroundColor(Theme.Colors.primaryAccent)
            }

            ToolbarItemGroup(placement: .navigationBarTrailing) {
                QuickFontSizeButtons(fontSize: $fontSize)
                    .fixedSize()
                fileBrowserButton
                widthSelectorButton
                menuButton
            }
        }
    }

    private var bottomToolbarItems: some ToolbarContent {
        ToolbarItemGroup(placement: .bottomBar) {
            terminalSizeIndicator
            Spacer()
        }
    }

    private var recordingIndicator: some ToolbarContent {
        ToolbarItem(placement: .navigationBarTrailing) {
            if viewModel.castRecorder.isRecording {
                recordingView
            }
        }
    }

    // MARK: - Toolbar Components

    private var fileBrowserButton: some View {
        Button(action: {
            HapticFeedback.impact(.light)
            showingFileBrowser = true
        }, label: {
            Image(systemName: "folder")
                .font(.system(size: 16))
                .foregroundColor(Theme.Colors.primaryAccent)
        })
    }

    private var widthSelectorButton: some View {
        Button(action: { showingWidthSelector = true }, label: {
            HStack(spacing: 2) {
                Image(systemName: "arrow.left.and.right")
                    .font(.system(size: 12))
                Text(currentTerminalWidth.label)
                    .font(Theme.Typography.terminalSystem(size: 14))
                    .fontWeight(.medium)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Theme.Colors.cardBackground)
            .cornerRadius(6)
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(Theme.Colors.primaryAccent.opacity(0.3), lineWidth: 1)
            )
        })
        .foregroundColor(Theme.Colors.primaryAccent)
        .popover(isPresented: $showingWidthSelector, arrowEdge: .top) {
            WidthSelectorPopover(
                currentWidth: $currentTerminalWidth,
                isPresented: $showingWidthSelector
            )
        }
    }

    private var menuButton: some View {
        Menu {
            terminalMenuItems
        } label: {
            Image(systemName: "ellipsis.circle")
                .foregroundColor(Theme.Colors.primaryAccent)
        }
    }

    @ViewBuilder
    private var terminalMenuItems: some View {
        Button(action: { viewModel.clearTerminal() }, label: {
            Label("Clear", systemImage: "clear")
        })

        Button(action: { showingFullscreenInput = true }, label: {
            Label("Compose Command", systemImage: "text.viewfinder")
        })

        Button(action: { showingCtrlKeyGrid = true }, label: {
            Label("Ctrl Shortcuts", systemImage: "command.square")
        })

        Divider()

        Menu {
            Button(action: {
                fontSize = max(8, fontSize - 1)
                HapticFeedback.impact(.light)
            }, label: {
                Label("Decrease", systemImage: "minus")
            })
            .disabled(fontSize <= 8)

            Button(action: {
                fontSize = min(32, fontSize + 1)
                HapticFeedback.impact(.light)
            }, label: {
                Label("Increase", systemImage: "plus")
            })
            .disabled(fontSize >= 32)

            Button(action: {
                fontSize = 14
                HapticFeedback.impact(.light)
            }, label: {
                Label("Reset to Default", systemImage: "arrow.counterclockwise")
            })
            .disabled(fontSize == 14)

            Divider()

            Button(action: { showingFontSizeSheet = true }, label: {
                Label("More Options...", systemImage: "slider.horizontal.3")
            })
        } label: {
            Label("Font Size (\(Int(fontSize))pt)", systemImage: "textformat.size")
        }

        Button(action: { showingTerminalWidthSheet = true }, label: {
            Label("Terminal Width", systemImage: "arrow.left.and.right")
        })

        Button(action: { viewModel.toggleFitToWidth() }, label: {
            Label(
                viewModel.fitToWidth ? "Fixed Width" : "Fit to Width",
                systemImage: viewModel.fitToWidth ? "arrow.left.and.right.square" : "arrow.left.and.right.square.fill"
            )
        })

        Button(action: { showingTerminalThemeSheet = true }, label: {
            Label("Theme", systemImage: "paintbrush")
        })

        Button(action: { viewModel.copyBuffer() }, label: {
            Label("Copy All", systemImage: "square.on.square")
        })

        Button(action: { exportTerminalBuffer() }, label: {
            Label("Export as Text", systemImage: "square.and.arrow.up")
        })

        Divider()

        recordingMenuItems

        Divider()

        debugMenuItems
    }

    @ViewBuilder
    private var recordingMenuItems: some View {
        if viewModel.castRecorder.isRecording {
            Button(action: {
                viewModel.stopRecording()
                showingRecordingSheet = true
            }, label: {
                Label("Stop Recording", systemImage: "stop.circle.fill")
                    .foregroundColor(.red)
            })
        } else {
            Button(action: { viewModel.startRecording() }, label: {
                Label("Start Recording", systemImage: "record.circle")
            })
        }

        Button(action: { showingRecordingSheet = true }, label: {
            Label("Export Recording", systemImage: "square.and.arrow.up")
        })
        .disabled(viewModel.castRecorder.events.isEmpty)
    }

    @ViewBuilder
    private var debugMenuItems: some View {
        Menu {
            ForEach(TerminalRenderer.allCases, id: \.self) { renderer in
                Button(action: {
                    selectedRenderer = renderer
                    TerminalRenderer.selected = renderer
                    viewModel.terminalViewId = UUID() // Force recreate terminal view
                }, label: {
                    HStack {
                        Text(renderer.displayName)
                        if renderer == selectedRenderer {
                            Image(systemName: "checkmark")
                        }
                    }
                })
            }
        } label: {
            Label("Terminal Renderer", systemImage: "gearshape.2")
        }
    }

    @ViewBuilder
    private var terminalSizeIndicator: some View {
        if viewModel.terminalCols > 0 && viewModel.terminalRows > 0 {
            Text("\(viewModel.terminalCols)×\(viewModel.terminalRows)")
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
                        .scaleEffect(viewModel.recordingPulse ? 1.5 : 1.0)
                        .animation(
                            .easeInOut(duration: 1.0).repeatForever(autoreverses: true),
                            value: viewModel.recordingPulse
                        )
                )
            Text("REC")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(Theme.Colors.errorAccent)
        }
        .onAppear {
            viewModel.recordingPulse = true
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
                viewModel.connect()
            }
            .terminalButton()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var terminalContent: some View {
        VStack(spacing: 0) {
            // Terminal view based on selected renderer
            Group {
                switch selectedRenderer {
                case .swiftTerm:
                    TerminalHostingView(
                        session: session,
                        fontSize: $fontSize,
                        theme: selectedTheme,
                        onInput: { text in
                            viewModel.sendInput(text)
                        },
                        onResize: { cols, rows in
                            viewModel.terminalCols = cols
                            viewModel.terminalRows = rows
                            viewModel.resize(cols: cols, rows: rows)
                        },
                        viewModel: viewModel
                    )
                case .xterm:
                    XtermWebView(
                        session: session,
                        fontSize: $fontSize,
                        theme: selectedTheme,
                        onInput: { text in
                            viewModel.sendInput(text)
                        },
                        onResize: { cols, rows in
                            viewModel.terminalCols = cols
                            viewModel.terminalRows = rows
                            viewModel.resize(cols: cols, rows: rows)
                        },
                        viewModel: viewModel
                    )
                }
            }
            .id(viewModel.terminalViewId)
            .background(selectedTheme.background)
            .focused($isInputFocused)
            .overlay(
                ScrollToBottomButton(
                    isVisible: showScrollToBottom
                ) {
                    viewModel.scrollToBottom()
                    showScrollToBottom = false
                }
                .padding(.bottom, Theme.Spacing.large)
                .padding(.leading, Theme.Spacing.large),
                alignment: .bottomLeading
            )

            // Keyboard toolbar
            if keyboardHeight > 0 {
                TerminalToolbar(
                    onSpecialKey: { key in
                        viewModel.sendInput(key.rawValue)
                    },
                    onDismissKeyboard: {
                        isInputFocused = false
                    },
                    onRawInput: { input in
                        viewModel.sendInput(input)
                    }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }
}

/// View model for terminal session management.
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
    var bufferWebSocketClient: BufferWebSocketClient?
    private var connectionStatusTask: Task<Void, Never>?
    private var connectionErrorTask: Task<Void, Never>?
    weak var terminalCoordinator: AnyObject? // Can be TerminalHostingView.Coordinator

    init(session: Session) {
        self.session = session
        self.castRecorder = CastRecorder(sessionId: session.id, width: 80, height: 24)
        setupTerminal()
    }

    private func setupTerminal() {
        // Terminal setup now handled by SimpleTerminalView
    }

    func startRecording() {
        castRecorder.startRecording()
    }

    func stopRecording() {
        castRecorder.stopRecording()
    }

    func connect() {
        isConnecting = true
        errorMessage = nil

        // Create WebSocket client if needed
        if bufferWebSocketClient == nil {
            bufferWebSocketClient = BufferWebSocketClient()
        }

        // Connect to WebSocket
        bufferWebSocketClient?.connect()

        // Load initial snapshot after a brief delay to ensure terminal is ready
        Task { @MainActor in
            // Wait for terminal view to be initialized
            try? await Task.sleep(nanoseconds: 200_000_000) // 0.2s
            await loadSnapshot()
        }

        // Subscribe to terminal events
        bufferWebSocketClient?.subscribe(to: session.id) { [weak self] event in
            Task { @MainActor in
                self?.handleWebSocketEvent(event)
            }
        }

        // Monitor connection status
        connectionStatusTask?.cancel()
        connectionStatusTask = Task { [weak self] in
            guard let client = self?.bufferWebSocketClient else { return }
            while !Task.isCancelled {
                let connected = client.isConnected
                await MainActor.run {
                    self?.isConnecting = false
                    self?.isConnected = connected
                    if !connected {
                        self?.errorMessage = "WebSocket disconnected"
                    } else {
                        self?.errorMessage = nil
                    }
                }
                try? await Task.sleep(nanoseconds: 500_000_000) // Check every 0.5 seconds
            }
        }

        // Monitor connection errors
        connectionErrorTask?.cancel()
        connectionErrorTask = Task { [weak self] in
            guard let client = self?.bufferWebSocketClient else { return }
            while !Task.isCancelled {
                if let error = client.connectionError {
                    await MainActor.run {
                        self?.errorMessage = error.localizedDescription
                        self?.isConnecting = false
                    }
                }
                try? await Task.sleep(nanoseconds: 500_000_000) // Check every 0.5 seconds
            }
        }
    }

    @MainActor
    private func loadSnapshot() async {
        do {
            let snapshot = try await APIClient.shared.getSessionSnapshot(sessionId: session.id)

            // Process the snapshot events
            if let header = snapshot.header {
                // Initialize terminal with dimensions from header
                terminalCols = header.width
                terminalRows = header.height
                logger.debug("Snapshot header: \(header.width)x\(header.height)")
            }

            // Feed all output events to the terminal
            for event in snapshot.events {
                if event.type == .output {
                    // Feed the actual terminal output data
                    if let coordinator = terminalCoordinator as? TerminalHostingView.Coordinator {
                        coordinator.feedData(event.data)
                    }
                }
            }
        } catch {
            logger.error("Failed to load terminal snapshot: \(error)")
        }
    }

    func disconnect() {
        connectionStatusTask?.cancel()
        connectionErrorTask?.cancel()
        bufferWebSocketClient?.unsubscribe(from: session.id)
        bufferWebSocketClient?.disconnect()
        bufferWebSocketClient = nil
        isConnected = false
    }

    @MainActor
    private func handleWebSocketEvent(_ event: TerminalWebSocketEvent) {
        switch event {
        case .header(let width, let height):
            // Initial terminal setup
            logger.info("Terminal initialized: \(width)x\(height)")
            terminalCols = width
            terminalRows = height
        // The terminal will be resized when created

        case .output(_, let data):
            // Feed output data directly to the terminal
            if let coordinator = terminalCoordinator as? TerminalHostingView.Coordinator {
                coordinator.feedData(data)
            } else {
                // Queue the data to be fed once coordinator is ready
                logger.warning("Terminal coordinator not ready, queueing data")
                Task {
                    // Wait a bit for coordinator to be initialized
                    try? await Task.sleep(nanoseconds: 100_000_000) // 0.1s
                    if let coordinator = self.terminalCoordinator as? TerminalHostingView.Coordinator {
                        coordinator.feedData(data)
                    }
                }
            }
            // Record output if recording
            castRecorder.recordOutput(data)

        case .resize(_, let dimensions):
            // Parse dimensions like "120x30"
            let parts = dimensions.split(separator: "x")
            if parts.count == 2,
               let cols = Int(parts[0]),
               let rows = Int(parts[1])
            {
                // Update terminal dimensions
                terminalCols = cols
                terminalRows = rows
                logger.info("Terminal resize: \(cols)x\(rows)")
                // Record resize event
                castRecorder.recordResize(cols: cols, rows: rows)
            }

        case .exit(let code):
            // Session has exited
            isConnected = false
            if code != 0 {
                errorMessage = "Session exited with code \(code)"
            }
            // Stop recording if active
            if castRecorder.isRecording {
                stopRecording()
            }

            // Load final snapshot for exited session
            Task { @MainActor in
                // Give the server a moment to finalize the snapshot
                try? await Task.sleep(nanoseconds: 500_000_000) // 0.5s
                await loadSnapshot()
            }

        case .bufferUpdate(let snapshot):
            // Update terminal buffer directly
            if let coordinator = terminalCoordinator as? TerminalHostingView.Coordinator {
                coordinator.updateBuffer(from: TerminalHostingView.BufferSnapshot(
                    cols: snapshot.cols,
                    rows: snapshot.rows,
                    viewportY: snapshot.viewportY,
                    cursorX: snapshot.cursorX,
                    cursorY: snapshot.cursorY,
                    cells: snapshot.cells.map { row in
                        row.map { cell in
                            TerminalHostingView.BufferCell(
                                char: cell.char,
                                width: cell.width,
                                fg: cell.fg,
                                bg: cell.bg,
                                attributes: cell.attributes
                            )
                        }
                    }
                ))
            } else {
                // Fallback: buffer updates not available yet
                logger.warning("Direct buffer update not available")
            }

        case .bell:
            // Terminal bell - play sound and/or haptic feedback
            handleTerminalBell()

        case .alert(let title, let message):
            // Terminal alert - show notification
            handleTerminalAlert(title: title, message: message)
        }
    }

    func sendInput(_ text: String) {
        Task {
            do {
                try await SessionService().sendInput(to: session.id, text: text)
            } catch {
                logger.error("Failed to send input: \(error)")
            }
        }
    }

    func sendSpecialKey(_ key: TerminalInput.SpecialKey) {
        sendInput(key.rawValue)
    }

    func resize(cols: Int, rows: Int) {
        Task {
            do {
                try await SessionService().resizeTerminal(sessionId: session.id, cols: cols, rows: rows)
                // If resize succeeded, ensure the flag is cleared
                isResizeBlockedByServer = false
            } catch {
                logger.error("Failed to resize terminal: \(error)")
                // Check if the error is specifically about resize being disabled
                if case APIError.resizeDisabledByServer = error {
                    isResizeBlockedByServer = true
                }
            }
        }
    }

    func clearTerminal() {
        // Reset the terminal by recreating it
        terminalViewId = UUID()
        HapticFeedback.impact(.medium)
    }

    func copyBuffer() {
        // Terminal copy is handled by SwiftTerm's built-in functionality
        HapticFeedback.notification(.success)
    }

    func getBufferContent() -> String? {
        // Get the current terminal buffer content
        if let coordinator = terminalCoordinator as? TerminalHostingView.Coordinator {
            return coordinator.getBufferContent()
        }
        return nil
    }

    @MainActor
    private func handleTerminalBell() {
        // Haptic feedback for bell
        HapticFeedback.notification(.warning)

        // Visual bell - flash the terminal briefly
        withAnimation(.easeInOut(duration: 0.1)) {
            // SwiftTerm handles visual bell internally
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
        isAutoScrollEnabled = true
        isAtBottom = true
        // The actual scrolling is handled by the terminal coordinator
        if let coordinator = terminalCoordinator as? TerminalHostingView.Coordinator {
            coordinator.scrollToBottom()
        }
    }

    func updateScrollState(isAtBottom: Bool) {
        self.isAtBottom = isAtBottom
        self.isAutoScrollEnabled = isAtBottom
    }

    func toggleFitToWidth() {
        fitToWidth.toggle()
        HapticFeedback.impact(.light)

        if fitToWidth {
            // Calculate optimal width to fit the screen
            let screenWidth = UIScreen.main.bounds.width
            let padding: CGFloat = 32 // Account for UI padding
            let charWidth: CGFloat = 9 // Approximate character width
            let optimalCols = Int((screenWidth - padding) / charWidth)

            // Resize to fit
            resize(cols: optimalCols, rows: terminalRows)
        }
    }

    func setMaxWidth(_ maxWidth: Int) {
        // Store the max width preference
        // When maxWidth is 0, it means unlimited
        let targetWidth = maxWidth == 0 ? nil : maxWidth

        if let width = targetWidth, width != terminalCols {
            // Maintain aspect ratio when changing width
            let aspectRatio = Double(terminalRows) / Double(terminalCols)
            let newHeight = Int(Double(width) * aspectRatio)
            resize(cols: width, rows: newHeight)
        }

        // Update the terminal coordinator if using constrained width
        if let coordinator = terminalCoordinator as? TerminalHostingView.Coordinator {
            coordinator.setMaxWidth(maxWidth)
        }
    }
}
