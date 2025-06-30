import Observation
import SwiftTerm
import SwiftUI
import UniformTypeIdentifiers

/// View for playing back terminal recordings from cast files.
///
/// Displays recorded terminal sessions with playback controls,
/// supporting the Asciinema cast v2 format.
struct CastPlayerView: View {
    let castFileURL: URL
    @Environment(\.dismiss)
    var dismiss
    @State private var viewModel = CastPlayerViewModel()
    @State private var fontSize: CGFloat = 14
    @State private var isPlaying = false
    @State private var currentTime: TimeInterval = 0
    @State private var playbackSpeed: Double = 1.0

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.Colors.terminalBackground
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    if viewModel.isLoading {
                        loadingView
                    } else if let error = viewModel.errorMessage {
                        errorView(error)
                    } else if viewModel.player != nil {
                        playerContent
                    }
                }
            }
            .navigationTitle("Recording Playback")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") {
                        dismiss()
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
        .onAppear {
            viewModel.loadCastFile(from: castFileURL)
        }
    }

    private var loadingView: some View {
        VStack(spacing: Theme.Spacing.large) {
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: Theme.Colors.primaryAccent))
                .scaleEffect(1.5)

            Text("Loading recording...")
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

            Text("Failed to load recording")
                .font(.headline)
                .foregroundColor(Theme.Colors.terminalForeground)

            Text(error)
                .font(Theme.Typography.terminalSystem(size: 12))
                .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var playerContent: some View {
        VStack(spacing: 0) {
            // Terminal display
            CastTerminalView(fontSize: $fontSize, viewModel: viewModel)
                .background(Theme.Colors.terminalBackground)

            // Playback controls
            VStack(spacing: Theme.Spacing.medium) {
                // Progress bar
                VStack(spacing: Theme.Spacing.extraSmall) {
                    Slider(value: $currentTime, in: 0...viewModel.duration) { editing in
                        if !editing && isPlaying {
                            // Resume playback from new position
                            viewModel.seekTo(time: currentTime)
                        }
                    }
                    .accentColor(Theme.Colors.primaryAccent)

                    HStack {
                        Text(formatTime(currentTime))
                            .font(Theme.Typography.terminalSystem(size: 10))
                        Spacer()
                        Text(formatTime(viewModel.duration))
                            .font(Theme.Typography.terminalSystem(size: 10))
                    }
                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                }

                // Control buttons
                HStack(spacing: Theme.Spacing.extraLarge) {
                    // Speed control
                    Menu {
                        Button("0.5x") { playbackSpeed = 0.5 }
                        Button("1x") { playbackSpeed = 1.0 }
                        Button("2x") { playbackSpeed = 2.0 }
                        Button("4x") { playbackSpeed = 4.0 }
                    } label: {
                        Text("\(playbackSpeed, specifier: "%.1f")x")
                            .font(Theme.Typography.terminalSystem(size: 14))
                            .foregroundColor(Theme.Colors.primaryAccent)
                            .padding(.horizontal, Theme.Spacing.small)
                            .padding(.vertical, Theme.Spacing.extraSmall)
                            .background(
                                RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                    .stroke(Theme.Colors.primaryAccent, lineWidth: 1)
                            )
                    }

                    // Play/Pause
                    Button(action: togglePlayback) {
                        Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                            .font(.system(size: 44))
                            .foregroundColor(Theme.Colors.primaryAccent)
                    }

                    // Restart
                    Button(action: restart) {
                        Image(systemName: "arrow.counterclockwise")
                            .font(.system(size: 20))
                            .foregroundColor(Theme.Colors.primaryAccent)
                    }
                }
            }
            .padding()
            .background(Theme.Colors.cardBackground)
        }
        .onChange(of: viewModel.currentTime) { _, newTime in
            if !viewModel.isSeeking {
                currentTime = newTime
            }
        }
    }

    private func togglePlayback() {
        if isPlaying {
            viewModel.pause()
        } else {
            viewModel.play(speed: playbackSpeed)
        }
        isPlaying.toggle()
    }

    private func restart() {
        viewModel.restart()
        currentTime = 0
        if isPlaying {
            viewModel.play(speed: playbackSpeed)
        }
    }

    private func formatTime(_ seconds: TimeInterval) -> String {
        let minutes = Int(seconds) / 60
        let remainingSeconds = Int(seconds) % 60
        return String(format: "%d:%02d", minutes, remainingSeconds)
    }
}

/// Terminal view specialized for cast file playback.
///
/// Provides a read-only terminal emulator for displaying recorded
/// terminal sessions, handling font sizing and terminal dimensions
/// based on the cast file metadata.
struct CastTerminalView: UIViewRepresentable {
    @Binding var fontSize: CGFloat
    let viewModel: CastPlayerViewModel

    func makeUIView(context: Context) -> SwiftTerm.TerminalView {
        let terminal = SwiftTerm.TerminalView()

        terminal.backgroundColor = UIColor(Theme.Colors.terminalBackground)
        terminal.nativeForegroundColor = UIColor(Theme.Colors.terminalForeground)
        terminal.nativeBackgroundColor = UIColor(Theme.Colors.terminalBackground)

        terminal.allowMouseReporting = false
        // SwiftTerm doesn't have built-in link detection API
        // URL detection would need to be implemented manually

        updateFont(terminal, size: fontSize)

        // Set initial size from cast file if available
        if let header = viewModel.header {
            terminal.resize(cols: Int(header.width), rows: Int(header.height))
        } else {
            terminal.resize(cols: 80, rows: 24)
        }

        context.coordinator.terminal = terminal
        return terminal
    }

    func updateUIView(_ terminal: SwiftTerm.TerminalView, context: Context) {
        updateFont(terminal, size: fontSize)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(viewModel: viewModel)
    }

    private func updateFont(_ terminal: SwiftTerm.TerminalView, size: CGFloat) {
        let font: UIFont = if let customFont = UIFont(name: Theme.Typography.terminalFont, size: size) {
            customFont
        } else if let fallbackFont = UIFont(name: Theme.Typography.terminalFontFallback, size: size) {
            fallbackFont
        } else {
            UIFont.monospacedSystemFont(ofSize: size, weight: .regular)
        }
        terminal.font = font
    }

    /// Coordinator for managing terminal state and handling events.
    @MainActor
    class Coordinator: NSObject {
        weak var terminal: SwiftTerm.TerminalView?
        let viewModel: CastPlayerViewModel

        init(viewModel: CastPlayerViewModel) {
            self.viewModel = viewModel
            super.init()

            // Set up terminal output handler
            viewModel.onTerminalOutput = { [weak self] data in
                Task { @MainActor in
                    self?.terminal?.feed(text: data)
                }
            }

            viewModel.onTerminalClear = { [weak self] in
                Task { @MainActor in
                    // SwiftTerm uses standard ANSI escape sequences for clearing
                    // This is the correct approach for clearing the terminal
                    self?.terminal?.feed(text: "\u{001B}[2J\u{001B}[H")
                }
            }
        }
    }
}

/// View model for cast file playback control.
@MainActor
@Observable
class CastPlayerViewModel {
    var isLoading = true
    var errorMessage: String?
    var currentTime: TimeInterval = 0
    var isSeeking = false

    var player: CastPlayer?
    var header: CastFile? { player?.header }
    var duration: TimeInterval { player?.duration ?? 0 }

    var onTerminalOutput: ((String) -> Void)?
    var onTerminalClear: (() -> Void)?

    private var playbackTask: Task<Void, Never>?

    func loadCastFile(from url: URL) {
        Task {
            do {
                let data = try Data(contentsOf: url)

                guard let player = CastPlayer(data: data) else {
                    errorMessage = "Invalid cast file format"
                    isLoading = false
                    return
                }

                self.player = player
                isLoading = false
            } catch {
                errorMessage = error.localizedDescription
                isLoading = false
            }
        }
    }

    func play(speed: Double = 1.0) {
        playbackTask?.cancel()

        playbackTask = Task {
            guard let player else { return }

            player.play(from: currentTime, speed: speed) { [weak self] event in
                Task { @MainActor in
                    guard let self else { return }

                    switch event.type {
                    case "o":
                        self.onTerminalOutput?(event.data)
                    case "r":
                        // Handle resize if needed
                        break
                    default:
                        break
                    }

                    self.currentTime = event.time
                }
            } completion: {
                // Playback completed
            }
        }
    }

    func pause() {
        playbackTask?.cancel()
    }

    func seekTo(time: TimeInterval) {
        isSeeking = true
        currentTime = time

        // Clear terminal and replay up to the seek point
        onTerminalClear?()

        guard let player else { return }

        // Replay all events up to the seek time instantly
        for event in player.events where event.time <= time {
            if event.type == "o" {
                onTerminalOutput?(event.data)
            }
        }

        isSeeking = false
    }

    func restart() {
        playbackTask?.cancel()
        currentTime = 0
        onTerminalClear?()
    }
}

/// Extension to CastPlayer for playback from specific time
extension CastPlayer {
    /// Plays the cast file from a specific time with adjustable speed.
    ///
    /// - Parameters:
    ///   - startTime: Time offset to start playback from (default: 0).
    ///   - speed: Playback speed multiplier (default: 1.0).
    ///   - onEvent: Closure called for each event during playback.
    ///   - completion: Closure called when playback completes.
    ///
    /// This method supports seeking and variable speed playback,
    /// filtering events based on the start time and adjusting
    /// delays according to the speed multiplier.
    func play(
        from startTime: TimeInterval = 0,
        speed: Double = 1.0,
        onEvent: @escaping @Sendable (CastEvent) -> Void,
        completion: @escaping @Sendable () -> Void
    ) {
        let eventsToPlay = events.filter { $0.time > startTime }
        Task { @Sendable in
            var lastEventTime = startTime

            for event in eventsToPlay {
                // Calculate wait time adjusted for playback speed
                let waitTime = (event.time - lastEventTime) / speed
                if waitTime > 0 {
                    try? await Task.sleep(nanoseconds: UInt64(waitTime * 1_000_000_000))
                }

                // Check if task was cancelled
                if Task.isCancelled { break }

                await MainActor.run {
                    onEvent(event)
                }

                lastEventTime = event.time
            }

            await MainActor.run {
                completion()
            }
        }
    }
}
