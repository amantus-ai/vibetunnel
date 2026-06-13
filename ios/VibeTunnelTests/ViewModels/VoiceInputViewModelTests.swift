import Foundation
import Testing
@testable import VibeTunnel

@Suite("Voice Input View Model Tests")
@MainActor
struct VoiceInputViewModelTests {
    @Test("Requires an OpenAI API key before recording")
    func requiresAPIKey() async {
        let recorder = MockAudioRecorder()
        let viewModel = VoiceInputViewModel(
            audioRecorder: recorder,
            keyStore: TestKeyStore())

        await viewModel.toggleRecording()

        #expect(viewModel.state == .idle)
        #expect(viewModel.errorMessage?.contains("OpenAI API key") == true)
        #expect(recorder.startCount == 0)
    }

    @Test("Records, transcribes, normalizes, and deletes temporary audio")
    func successfulTranscription() async throws {
        let audioURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice-input-test-\(UUID().uuidString).m4a")
        try Data("audio".utf8).write(to: audioURL)

        let recorder = MockAudioRecorder(audioURL: audioURL)
        let service = MockTranscriptionService(result: .success("git status\n\u{1B}\t--short"))
        let viewModel = VoiceInputViewModel(
            audioRecorder: recorder,
            keyStore: TestKeyStore(apiKey: "test-key"),
            transcriptionServiceFactory: { _ in service })

        await viewModel.toggleRecording()
        #expect(viewModel.state == .recording)

        await viewModel.toggleRecording()

        #expect(viewModel.state == .idle)
        #expect(viewModel.completedTranscript?.text == "git status --short")
        #expect(recorder.stopCount == 1)
        #expect(!FileManager.default.fileExists(atPath: audioURL.path))
    }

    @Test("Ignores repeated taps while microphone startup is pending")
    func ignoresRepeatedTapsWhilePreparing() async throws {
        let recorder = MockAudioRecorder(startDelay: .milliseconds(50))
        let viewModel = VoiceInputViewModel(
            audioRecorder: recorder,
            keyStore: TestKeyStore(apiKey: "test-key"))

        let startTask = Task {
            await viewModel.toggleRecording()
        }
        try await Task.sleep(for: .milliseconds(10))

        #expect(viewModel.state == .preparing)
        await viewModel.toggleRecording()
        await startTask.value

        #expect(viewModel.state == .recording)
        #expect(recorder.startCount == 1)
        viewModel.cancelRecording()
    }

    @Test("Surfaces transcription errors and deletes temporary audio")
    func transcriptionFailure() async throws {
        let audioURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice-input-failure-\(UUID().uuidString).m4a")
        try Data("audio".utf8).write(to: audioURL)

        let recorder = MockAudioRecorder(audioURL: audioURL)
        let service = MockTranscriptionService(
            result: .failure(OpenAITranscriptionService.TranscriptionError.apiError("Invalid key")))
        let viewModel = VoiceInputViewModel(
            audioRecorder: recorder,
            keyStore: TestKeyStore(apiKey: "test-key"),
            transcriptionServiceFactory: { _ in service })

        await viewModel.toggleRecording()
        await viewModel.toggleRecording()

        #expect(viewModel.state == .idle)
        #expect(viewModel.errorMessage?.contains("Invalid key") == true)
        #expect(!FileManager.default.fileExists(atPath: audioURL.path))
    }

    @Test("Automatically stops bounded recordings")
    func automaticallyStopsRecording() async throws {
        let audioURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice-input-timeout-\(UUID().uuidString).m4a")
        try Data("audio".utf8).write(to: audioURL)

        let recorder = MockAudioRecorder(audioURL: audioURL)
        let service = MockTranscriptionService(
            result: .success("pwd"),
            failWhenCancelled: true)
        let viewModel = VoiceInputViewModel(
            audioRecorder: recorder,
            keyStore: TestKeyStore(apiKey: "test-key"),
            maximumRecordingDuration: .milliseconds(10),
            transcriptionServiceFactory: { _ in service })

        await viewModel.toggleRecording()
        try await Task.sleep(for: .milliseconds(100))

        #expect(viewModel.state == .idle)
        #expect(viewModel.completedTranscript?.text == "pwd")
        #expect(recorder.stopCount == 1)
    }
}

@MainActor
private final class MockAudioRecorder: AudioRecording {
    private let audioURL: URL
    private let startDelay: Duration?
    private(set) var startCount = 0
    private(set) var stopCount = 0
    var isRecording = false

    init(
        audioURL: URL = FileManager.default.temporaryDirectory.appendingPathComponent("unused.m4a"),
        startDelay: Duration? = nil)
    {
        self.audioURL = audioURL
        self.startDelay = startDelay
    }

    func startRecording() async throws {
        self.startCount += 1
        if let startDelay {
            try await Task.sleep(for: startDelay)
        }
        self.isRecording = true
    }

    func stopRecording() throws -> URL {
        self.stopCount += 1
        self.isRecording = false
        return self.audioURL
    }

    func cancelRecording() {
        self.isRecording = false
    }
}

private struct TestKeyStore: VoiceTranscriptionKeyStoring {
    var apiKey: String?

    func savePassword(_: String, for _: String) throws {}

    func loadPassword(for _: String) throws -> String {
        guard let apiKey else {
            throw KeychainService.KeychainError.itemNotFound
        }
        return apiKey
    }

    func deletePassword(for _: String) throws {}
}

@MainActor
private struct MockTranscriptionService: TranscriptionServicing {
    let result: Result<String, Error>
    var failWhenCancelled = false

    func transcribe(audioFileURL _: URL, prompt _: String) async throws -> String {
        if self.failWhenCancelled, Task.isCancelled {
            throw CancellationError()
        }
        return try self.result.get()
    }
}
