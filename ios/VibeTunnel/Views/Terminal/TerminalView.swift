import SwiftUI
import Combine
import SwiftTerm

struct TerminalView: View {
    let session: Session
    @Environment(\.dismiss) var dismiss
    @StateObject private var viewModel: TerminalViewModel
    @State private var fontSize: CGFloat = 14
    @State private var showingFontSizeSheet = false
    @State private var keyboardHeight: CGFloat = 0
    @FocusState private var isInputFocused: Bool
    
    init(session: Session) {
        self.session = session
        self._viewModel = StateObject(wrappedValue: TerminalViewModel(session: session))
    }
    
    var body: some View {
        NavigationView {
            ZStack {
                // Background
                Theme.Colors.terminalBackground
                    .ignoresSafeArea()
                
                // Terminal content
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
            .navigationTitle(session.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") {
                        dismiss()
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: { viewModel.clearTerminal() }) {
                            Label("Clear", systemImage: "clear")
                        }
                        
                        Button(action: { showingFontSizeSheet = true }) {
                            Label("Font Size", systemImage: "textformat.size")
                        }
                        
                        Button(action: { viewModel.copyBuffer() }) {
                            Label("Copy All", systemImage: "doc.on.doc")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .foregroundColor(Theme.Colors.primaryAccent)
                    }
                }
            }
            .sheet(isPresented: $showingFontSizeSheet) {
                FontSizeSheet(fontSize: $fontSize)
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
        .preferredColorScheme(.dark)
        .onAppear {
            viewModel.connect()
            isInputFocused = true
        }
        .onDisappear {
            viewModel.disconnect()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { notification in
            if let keyboardFrame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
                withAnimation(Theme.Animation.standard) {
                    keyboardHeight = keyboardFrame.height
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            withAnimation(Theme.Animation.standard) {
                keyboardHeight = 0
            }
        }
    }
    
    private var loadingView: some View {
        VStack(spacing: Theme.Spacing.lg) {
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
        VStack(spacing: Theme.Spacing.lg) {
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
            // Terminal hosting view
            TerminalHostingView(
                session: session,
                fontSize: $fontSize,
                onInput: { text in
                    viewModel.sendInput(text)
                },
                onResize: { cols, rows in
                    viewModel.resize(cols: cols, rows: rows)
                },
                viewModel: viewModel
            )
            .id(viewModel.terminalViewId)
            .background(Theme.Colors.terminalBackground)
            .focused($isInputFocused)
            
            // Keyboard toolbar
            if keyboardHeight > 0 {
                TerminalToolbar(
                    onSpecialKey: { key in
                        viewModel.sendInput(key.rawValue)
                    },
                    onDismissKeyboard: {
                        isInputFocused = false
                    }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }
}

@MainActor
class TerminalViewModel: ObservableObject {
    @Published var isConnecting = true
    @Published var isConnected = false
    @Published var errorMessage: String?
    @Published var terminalViewId = UUID()
    
    let session: Session
    private var sseClient: SSEClient?
    var cancellables = Set<AnyCancellable>()
    weak var terminalCoordinator: TerminalHostingView.Coordinator?
    
    init(session: Session) {
        self.session = session
        setupTerminal()
    }
    
    private func setupTerminal() {
        // Terminal setup now handled by SimpleTerminalView
    }
    
    func connect() {
        isConnecting = true
        errorMessage = nil
        
        guard let streamURL = APIClient.shared.streamURL(for: session.id) else {
            errorMessage = "Failed to create stream URL"
            isConnecting = false
            return
        }
        
        // Load existing terminal snapshot first if session is already running
        if session.isRunning {
            Task {
                await loadSnapshot()
            }
        }
        
        sseClient = SSEClient()
        
        Task {
            for await event in sseClient!.connect(to: streamURL) {
                handleTerminalEvent(event)
            }
        }
        
        isConnecting = false
        isConnected = true
    }
    
    @MainActor
    private func loadSnapshot() async {
        guard let snapshotURL = APIClient.shared.snapshotURL(for: session.id) else { return }
        
        do {
            let (data, _) = try await URLSession.shared.data(from: snapshotURL)
            if let snapshot = String(data: data, encoding: .utf8) {
                // Feed the snapshot to the terminal
                terminalCoordinator?.feedData(snapshot)
            }
        } catch {
            print("Failed to load terminal snapshot: \(error)")
        }
    }
    
    func disconnect() {
        sseClient?.disconnect()
        sseClient = nil
        isConnected = false
    }
    
    @MainActor
    private func handleTerminalEvent(_ event: TerminalEvent) {
        switch event {
        case .header(let header):
            // Initial terminal setup
            print("Terminal initialized: \(header.width)x\(header.height)")
            // The terminal will be resized when created
            
        case .output(_, let data):
            // Feed output data directly to the terminal
            terminalCoordinator?.feedData(data)
            
        case .resize(_, let dimensions):
            // Parse dimensions like "120x30"
            let parts = dimensions.split(separator: "x")
            if parts.count == 2,
               let cols = Int(parts[0]),
               let rows = Int(parts[1]) {
                // Handle resize if needed
                print("Terminal resize: \(cols)x\(rows)")
            }
            
        case .exit(let code, _):
            // Session has exited
            isConnected = false
            if code != 0 {
                errorMessage = "Session exited with code \(code)"
            }
        }
    }
    
    func sendInput(_ text: String) {
        Task {
            do {
                try await SessionService.shared.sendInput(to: session.id, text: text)
            } catch {
                print("Failed to send input: \(error)")
            }
        }
    }
    
    func resize(cols: Int, rows: Int) {
        Task {
            do {
                try await SessionService.shared.resizeTerminal(sessionId: session.id, cols: cols, rows: rows)
            } catch {
                print("Failed to resize terminal: \(error)")
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
}