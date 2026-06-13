import Foundation
import Observation

enum VoiceTranscriptionConfiguration {
    static let apiKeyAccount = "openai-transcription-api-key"
    static let model = "gpt-4o-transcribe"
    static let prompt =
        """
        Terminal command or programming text. Preserve command names, flags, paths, package names, \
        punctuation, and capitalization. Common terms include git, gh, npm, pnpm, bun, docker, \
        kubectl, Swift, JavaScript, TypeScript, Python, JSON, YAML, and VibeTunnel.
        """
}

protocol VoiceTranscriptionKeyStoring {
    func savePassword(_ password: String, for key: String) throws
    func loadPassword(for key: String) throws -> String
    func deletePassword(for key: String) throws
}

extension KeychainService: VoiceTranscriptionKeyStoring {}

@MainActor
@Observable
final class VoiceInputViewModel {
    enum State: Equatable {
        case idle
        case preparing
        case recording
        case transcribing
    }

    struct CompletedTranscript: Equatable {
        let id = UUID()
        let text: String
    }

    private(set) var state: State = .idle
    private(set) var completedTranscript: CompletedTranscript?
    private(set) var errorMessage: String?

    private let audioRecorder: any AudioRecording
    private let keyStore: any VoiceTranscriptionKeyStoring
    private let transcriptionServiceFactory: (String) -> any TranscriptionServicing
    private let maximumRecordingDuration: Duration
    private var apiKey: String?
    private var autoStopTask: Task<Void, Never>?
    private var operationID = UUID()

    init(
        audioRecorder: any AudioRecording = AudioRecordingService(),
        keyStore: any VoiceTranscriptionKeyStoring = KeychainService(),
        maximumRecordingDuration: Duration = .seconds(60),
        transcriptionServiceFactory: @escaping (String) -> any TranscriptionServicing = {
            OpenAITranscriptionService(apiKey: $0)
        })
    {
        self.audioRecorder = audioRecorder
        self.keyStore = keyStore
        self.maximumRecordingDuration = maximumRecordingDuration
        self.transcriptionServiceFactory = transcriptionServiceFactory
    }

    func toggleRecording() async {
        switch self.state {
        case .idle:
            await self.startRecording()
        case .preparing:
            break
        case .recording:
            await self.stopAndTranscribe()
        case .transcribing:
            break
        }
    }

    func cancelRecording() {
        self.operationID = UUID()
        self.autoStopTask?.cancel()
        self.autoStopTask = nil
        self.audioRecorder.cancelRecording()
        self.apiKey = nil
        self.state = .idle
    }

    func clearError() {
        self.errorMessage = nil
    }

    func consumeCompletedTranscript() {
        self.completedTranscript = nil
    }

    private func startRecording() async {
        let operationID = UUID()
        self.operationID = operationID
        self.errorMessage = nil
        self.completedTranscript = nil
        self.state = .preparing

        do {
            let storedAPIKey: String
            do {
                storedAPIKey = try self.keyStore.loadPassword(
                    for: VoiceTranscriptionConfiguration.apiKeyAccount)
            } catch {
                throw OpenAITranscriptionService.TranscriptionError.missingAPIKey
            }

            let apiKey = storedAPIKey
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !apiKey.isEmpty else {
                throw OpenAITranscriptionService.TranscriptionError.missingAPIKey
            }

            self.apiKey = apiKey
            try await self.audioRecorder.startRecording()
            guard self.operationID == operationID else {
                self.audioRecorder.cancelRecording()
                return
            }
            self.state = .recording
            self.scheduleAutomaticStop()
        } catch {
            guard self.operationID == operationID else { return }
            self.apiKey = nil
            self.state = .idle
            self.errorMessage = self.message(for: error)
        }
    }

    private func stopAndTranscribe(cancelAutomaticStop: Bool = true) async {
        let operationID = self.operationID
        if cancelAutomaticStop {
            self.autoStopTask?.cancel()
        }
        self.autoStopTask = nil

        guard let apiKey = self.apiKey else {
            self.state = .idle
            self.errorMessage = OpenAITranscriptionService.TranscriptionError.missingAPIKey.localizedDescription
            return
        }

        let audioURL: URL
        do {
            audioURL = try self.audioRecorder.stopRecording()
        } catch {
            self.state = .idle
            self.errorMessage = self.message(for: error)
            return
        }

        self.state = .transcribing
        defer {
            try? FileManager.default.removeItem(at: audioURL)
            if self.operationID == operationID {
                self.apiKey = nil
                self.state = .idle
            }
        }

        do {
            let service = self.transcriptionServiceFactory(apiKey)
            let transcript = try await service.transcribe(
                audioFileURL: audioURL,
                prompt: VoiceTranscriptionConfiguration.prompt)
            guard self.operationID == operationID else { return }
            let normalizedTranscript = Self.normalizeTranscript(transcript)
            guard !normalizedTranscript.isEmpty else {
                throw OpenAITranscriptionService.TranscriptionError.invalidResponse
            }
            self.completedTranscript = CompletedTranscript(text: normalizedTranscript)
        } catch {
            guard self.operationID == operationID else { return }
            self.errorMessage = self.message(for: error)
        }
    }

    private func scheduleAutomaticStop() {
        self.autoStopTask?.cancel()
        self.autoStopTask = Task { [weak self, maximumRecordingDuration] in
            try? await Task.sleep(for: maximumRecordingDuration)
            guard !Task.isCancelled else { return }
            await self?.stopAndTranscribe(cancelAutomaticStop: false)
        }
    }

    private func message(for error: Error) -> String {
        if let localizedError = error as? LocalizedError,
           let description = localizedError.errorDescription
        {
            return description
        }
        return error.localizedDescription
    }

    private static func normalizeTranscript(_ transcript: String) -> String {
        transcript.unicodeScalars
            .map { CharacterSet.controlCharacters.contains($0) ? " " : String($0) }
            .joined()
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }
}
