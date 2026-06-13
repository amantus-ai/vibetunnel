import AVFoundation
import Foundation

@MainActor
protocol AudioRecording: AnyObject {
    var isRecording: Bool { get }

    func startRecording() async throws
    func stopRecording() throws -> URL
    func cancelRecording()
}

@MainActor
final class AudioRecordingService: NSObject, AudioRecording {
    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?

    var isRecording: Bool {
        self.recorder?.isRecording == true
    }

    func startRecording() async throws {
        guard !self.isRecording else {
            throw AudioRecordingError.alreadyRecording
        }
        guard await self.requestMicrophonePermission() else {
            throw AudioRecordingError.microphonePermissionDenied
        }

        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.record, mode: .measurement)
        try audioSession.setActive(true)

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("vibetunnel-voice-\(UUID().uuidString)")
            .appendingPathExtension("m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]

        do {
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.prepareToRecord()
            guard recorder.record() else {
                throw AudioRecordingError.unableToStart
            }
            self.recorder = recorder
            self.recordingURL = url
        } catch {
            try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)
            try? FileManager.default.removeItem(at: url)
            throw error
        }
    }

    func stopRecording() throws -> URL {
        guard let recorder = self.recorder,
              recorder.isRecording,
              let recordingURL = self.recordingURL
        else {
            throw AudioRecordingError.notRecording
        }

        recorder.stop()
        self.recorder = nil
        self.recordingURL = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        return recordingURL
    }

    func cancelRecording() {
        let shouldDeactivateAudioSession = self.recorder != nil || self.recordingURL != nil
        self.recorder?.stop()
        self.recorder = nil
        if let recordingURL {
            try? FileManager.default.removeItem(at: recordingURL)
        }
        self.recordingURL = nil
        if shouldDeactivateAudioSession {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    private func requestMicrophonePermission() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            true
        case .denied:
            false
        case .undetermined:
            await withCheckedContinuation { continuation in
                AVAudioApplication.requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }
        @unknown default:
            false
        }
    }

    enum AudioRecordingError: LocalizedError {
        case alreadyRecording
        case microphonePermissionDenied
        case notRecording
        case unableToStart

        var errorDescription: String? {
            switch self {
            case .alreadyRecording:
                "A voice recording is already in progress."
            case .microphonePermissionDenied:
                "Microphone access is required for voice input."
            case .notRecording:
                "No voice recording is in progress."
            case .unableToStart:
                "Voice recording could not be started."
            }
        }
    }
}
