import SwiftUI
import SwiftTerm
import Combine

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
            TerminalContainerView(
                terminal: viewModel.terminal,
                session: session,
                fontSize: $fontSize,
                onInput: { text in
                    viewModel.sendInput(text)
                },
                onResize: { cols, rows in
                    viewModel.resize(cols: cols, rows: rows)
                }
            )
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

// Terminal container to manage SwiftTerm lifecycle
struct TerminalContainerView: UIViewControllerRepresentable {
    let terminal: TerminalView?
    let session: Session
    @Binding var fontSize: CGFloat
    let onInput: (String) -> Void
    let onResize: (Int, Int) -> Void
    
    func makeUIViewController(context: Context) -> TerminalHostingController {
        let controller = TerminalHostingController()
        controller.session = session
        controller.fontSize = fontSize
        controller.onInput = onInput
        controller.onResize = onResize
        controller.terminalView = terminal
        return controller
    }
    
    func updateUIViewController(_ controller: TerminalHostingController, context: Context) {
        controller.fontSize = fontSize
        controller.updateTerminal()
    }
}

class TerminalHostingController: UIViewController {
    var terminalView: TerminalView?
    var session: Session?
    var fontSize: CGFloat = 14
    var onInput: ((String) -> Void)?
    var onResize: ((Int, Int) -> Void)?
    
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(Theme.Colors.terminalBackground)
        setupTerminal()
    }
    
    override func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        terminalView?.frame = view.bounds
    }
    
    func setupTerminal() {
        guard let terminal = terminalView else { return }
        
        terminal.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(terminal)
        
        NSLayoutConstraint.activate([
            terminal.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            terminal.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            terminal.topAnchor.constraint(equalTo: view.topAnchor),
            terminal.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        
        // Make terminal first responder for keyboard input
        terminal.becomeFirstResponder()
    }
    
    func updateTerminal() {
        // Update font size if needed
        if let terminal = terminalView {
            if let font = UIFont(name: Theme.Typography.terminalFont, size: fontSize) {
                terminal.font = font
            } else {
                terminal.font = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
            }
        }
    }
}

@MainActor
class TerminalViewModel: ObservableObject {
    @Published var isConnecting = true
    @Published var isConnected = false
    @Published var errorMessage: String?
    
    let session: Session
    var terminal: TerminalView?
    private var sseClient: SSEClient?
    private var cancellables = Set<AnyCancellable>()
    
    init(session: Session) {
        self.session = session
        setupTerminal()
    }
    
    private func setupTerminal() {
        let terminal = TerminalView()
        terminal.delegate = self
        self.terminal = terminal
        
        // Configure appearance
        terminal.backgroundColor = UIColor(Theme.Colors.terminalBackground)
        terminal.nativeForegroundColor = UIColor(Theme.Colors.terminalForeground)
        terminal.nativeBackgroundColor = UIColor(Theme.Colors.terminalBackground)
        terminal.caretColor = UIColor(Theme.Colors.primaryAccent)
        terminal.caretTextColor = UIColor(Theme.Colors.terminalBackground)
        terminal.selectedTextBackgroundColor = UIColor(Theme.Colors.terminalSelection)
        
        // Set initial size
        terminal.resize(cols: 80, rows: 24)
    }
    
    func connect() {
        isConnecting = true
        errorMessage = nil
        
        guard let streamURL = APIClient.shared.streamURL(for: session.id) else {
            errorMessage = "Failed to create stream URL"
            isConnecting = false
            return
        }
        
        sseClient = SSEClient()
        
        Task {
            for await event in sseClient!.connect(to: streamURL) {
                await handleTerminalEvent(event)
            }
        }
        
        isConnecting = false
        isConnected = true
    }
    
    func disconnect() {
        sseClient?.disconnect()
        sseClient = nil
        isConnected = false
    }
    
    @MainActor
    private func handleTerminalEvent(_ event: TerminalEvent) {
        switch event.type {
        case .output:
            let bytes = [UInt8](event.data.utf8)
            terminal?.feed(byteArray: bytes)
        case .resize:
            // Handle resize if needed
            break
        default:
            break
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
        terminal?.resize(cols: cols, rows: rows)
        
        Task {
            do {
                try await SessionService.shared.resizeTerminal(sessionId: session.id, cols: cols, rows: rows)
            } catch {
                print("Failed to resize terminal: \(error)")
            }
        }
    }
    
    func clearTerminal() {
        terminal?.terminal.resetToInitialState()
        HapticFeedback.impact(.medium)
    }
    
    func copyBuffer() {
        if let text = terminal?.getTerminalText() {
            UIPasteboard.general.string = text
            HapticFeedback.notification(.success)
        }
    }
}

extension TerminalViewModel: TerminalViewDelegate {
    nonisolated func send(source: TerminalView, data: ArraySlice<UInt8>) {
        if let string = String(bytes: data, encoding: .utf8) {
            Task { @MainActor in
                sendInput(string)
            }
        }
    }
    
    nonisolated func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
        Task { @MainActor in
            resize(cols: newCols, rows: newRows)
        }
    }
    
    nonisolated func scrolled(source: TerminalView, position: Double) {}
    nonisolated func setTerminalTitle(source: TerminalView, title: String) {}
    nonisolated func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    
    nonisolated func requestOpenLink(source: TerminalView, link: String, params: [String : String]) {
        if let url = URL(string: link) {
            Task { @MainActor in
                UIApplication.shared.open(url)
            }
        }
    }
}