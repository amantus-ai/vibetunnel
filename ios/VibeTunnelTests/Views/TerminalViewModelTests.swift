import Testing
@testable import VibeTunnel

@MainActor
private final class RecordingTerminalCoordinator: TerminalCoordinating {
    private(set) var events: [String] = []

    func feedData(_ data: String) {
        self.events.append("output:\(data)")
    }

    func updateBuffer(from snapshot: BufferSnapshot) {
        self.events.append("snapshot:\(snapshot.cols)x\(snapshot.rows)")
    }

    func resetForReplay() {
        self.events.append("reset")
    }

    func scrollToBottom() {
        _ = ()
    }

    func setMaxWidth(_ maxWidth: Int) {
        _ = maxWidth
    }

    func getBufferContent() async -> String? {
        nil
    }
}

@Suite("TerminalViewModel Tests")
@MainActor
struct TerminalViewModelTests {
    @Test("Flushes pre-coordinator terminal events in arrival order")
    func flushesPendingTerminalEvents() {
        let viewModel = TerminalViewModel(session: TestFixtures.validSession)
        let snapshot = BufferSnapshot(
            cols: 80,
            rows: 24,
            viewportY: 0,
            cursorX: 0,
            cursorY: 0,
            cells: [])

        viewModel.handleWebSocketEvent(.output(timestamp: 0, data: "first"))
        viewModel.handleWebSocketEvent(.bufferUpdate(snapshot: snapshot))
        viewModel.handleWebSocketEvent(.output(timestamp: 1, data: "second"))

        let coordinator = RecordingTerminalCoordinator()
        viewModel.terminalCoordinator = coordinator

        #expect(coordinator.events == [
            "output:first",
            "snapshot:80x24",
            "output:second",
        ])

        viewModel.handleWebSocketEvent(.output(timestamp: 2, data: "third"))
        #expect(coordinator.events.last == "output:third")
    }

    @Test("Resets terminal before rendering reconnect replay")
    func resetsBeforeReconnectReplay() {
        let viewModel = TerminalViewModel(session: TestFixtures.validSession)
        let coordinator = RecordingTerminalCoordinator()
        viewModel.terminalCoordinator = coordinator

        viewModel.handleWebSocketEvent(.output(timestamp: 0, data: "old"))
        viewModel.handleWebSocketEvent(.replayStarted)
        viewModel.handleWebSocketEvent(.output(timestamp: 1, data: "complete history"))

        #expect(coordinator.events == [
            "output:old",
            "reset",
            "output:complete history",
        ])
    }
}
