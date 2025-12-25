import Observation
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
                    if self.viewModel.isLoading {
                        self.loadingView
                    } else if let error = viewModel.errorMessage {
                        self.errorView(error)
                    } else if self.viewModel.player != nil {
                        self.playerContent
                    }
                }
            }
            .navigationTitle("Recording Playback")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") {
                        self.dismiss()
                    }
                    .foregroundColor(Theme.Colors.primaryAccent)
                }
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
        .onAppear {
            self.viewModel.loadCastFile(from: self.castFileURL)
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
            CastTerminalView(fontSize: self.$fontSize, viewModel: self.viewModel)
                .background(Theme.Colors.terminalBackground)

            // Playback controls
            VStack(spacing: Theme.Spacing.medium) {
                // Progress bar
                VStack(spacing: Theme.Spacing.extraSmall) {
                    Slider(value: self.$currentTime, in: 0...self.viewModel.duration) { editing in
                        if !editing, self.isPlaying {
                            // Resume playback from new position
                            self.viewModel.seekTo(time: self.currentTime)
                        }
                    }
                    .accentColor(Theme.Colors.primaryAccent)

                    HStack {
                        Text(self.formatTime(self.currentTime))
                            .font(Theme.Typography.terminalSystem(size: 10))
                        Spacer()
                        Text(self.formatTime(self.viewModel.duration))
                            .font(Theme.Typography.terminalSystem(size: 10))
                    }
                    .foregroundColor(Theme.Colors.terminalForeground.opacity(0.7))
                }

                // Control buttons
                HStack(spacing: Theme.Spacing.extraLarge) {
                    // Speed control
                    Menu {
                        Button("0.5x") { self.playbackSpeed = 0.5 }
                        Button("1x") { self.playbackSpeed = 1.0 }
                        Button("2x") { self.playbackSpeed = 2.0 }
                        Button("4x") { self.playbackSpeed = 4.0 }
                    } label: {
                        Text("\(self.playbackSpeed, specifier: "%.1f")x")
                            .font(Theme.Typography.terminalSystem(size: 14))
                            .foregroundColor(Theme.Colors.primaryAccent)
                            .padding(.horizontal, Theme.Spacing.small)
                            .padding(.vertical, Theme.Spacing.extraSmall)
                            .background(
                                RoundedRectangle(cornerRadius: Theme.CornerRadius.small)
                                    .stroke(Theme.Colors.primaryAccent, lineWidth: 1))
                    }

                    // Play/Pause
                    Button(action: self.togglePlayback) {
                        Image(systemName: self.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                            .font(.system(size: 44))
                            .foregroundColor(Theme.Colors.primaryAccent)
                    }

                    // Restart
                    Button(action: self.restart) {
                        Image(systemName: "arrow.counterclockwise")
                            .font(.system(size: 20))
                            .foregroundColor(Theme.Colors.primaryAccent)
                    }
                }
            }
            .padding()
            .background(Theme.Colors.cardBackground)
        }
        .onChange(of: self.viewModel.currentTime) { _, newTime in
            if !self.viewModel.isSeeking {
                self.currentTime = newTime
            }
        }
    }

    private func togglePlayback() {
        if self.isPlaying {
            self.viewModel.pause()
        } else {
            self.viewModel.play(speed: self.playbackSpeed)
        }
        self.isPlaying.toggle()
    }

    private func restart() {
        self.viewModel.restart()
        self.currentTime = 0
        if self.isPlaying {
            self.viewModel.play(speed: self.playbackSpeed)
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
/// UIKit terminal view for rendering cast file playback.
/// Displays terminal content frame-by-frame during recording playback.
struct CastTerminalView: View {
    @Binding var fontSize: CGFloat
    let viewModel: CastPlayerViewModel

    private var terminalSize: GhosttyWebView.TerminalSize? {
        guard let header = viewModel.header else { return nil }
        return GhosttyWebView.TerminalSize(cols: Int(header.width), rows: Int(header.height))
    }

    var body: some View {
        GhosttyWebView(
            fontSize: self.$fontSize,
            theme: TerminalTheme.selected,
            onInput: nil,
            onResize: nil,
            viewModel: nil,
            disableInput: true,
            terminalSize: self.terminalSize,
            onReady: { coordinator in
                self.viewModel.onTerminalOutput = { [weak coordinator] data in
                    coordinator?.feedData(data)
                }
                self.viewModel.onTerminalClear = { [weak coordinator] in
                    coordinator?.clear()
                }
            })
    }
}

/// View model for cast file playback control.
/// View model for cast file playback control.
/// Manages playback state, timing, and frame navigation for recordings.
@MainActor
@Observable
class CastPlayerViewModel {
    var isLoading = true
    var errorMessage: String?
    var currentTime: TimeInterval = 0
    var isSeeking = false

    var player: CastPlayer?
    var header: CastFile? { self.player?.header }
    var duration: TimeInterval { self.player?.duration ?? 0 }

    var onTerminalOutput: ((String) -> Void)?
    var onTerminalClear: (() -> Void)?

    private var playbackTask: Task<Void, Never>?

    func loadCastFile(from url: URL) {
        Task {
            do {
                let data = try Data(contentsOf: url)

                guard let player = CastPlayer(data: data) else {
                    self.errorMessage = "Invalid cast file format"
                    self.isLoading = false
                    return
                }

                self.player = player
                self.isLoading = false
            } catch {
                self.errorMessage = error.localizedDescription
                self.isLoading = false
            }
        }
    }

    func play(speed: Double = 1.0) {
        self.playbackTask?.cancel()

        self.playbackTask = Task {
            guard let player else { return }

            player.play(from: self.currentTime, speed: speed) { [weak self] event in
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
        self.playbackTask?.cancel()
    }

    func seekTo(time: TimeInterval) {
        self.isSeeking = true
        self.currentTime = time

        // Clear terminal and replay up to the seek point
        self.onTerminalClear?()

        guard let player else { return }

        // Replay all events up to the seek time instantly
        for event in player.events where event.time <= time {
            if event.type == "o" {
                onTerminalOutput?(event.data)
            }
        }

        self.isSeeking = false
    }

    func restart() {
        self.playbackTask?.cancel()
        self.currentTime = 0
        self.onTerminalClear?()
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
        completion: @escaping @Sendable () -> Void)
    {
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
