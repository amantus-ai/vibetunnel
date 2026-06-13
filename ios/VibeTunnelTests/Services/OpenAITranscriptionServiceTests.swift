import Foundation
import Testing
@testable import VibeTunnel

@Suite("OpenAI Transcription Service Tests", .serialized)
@MainActor
struct OpenAITranscriptionServiceTests {
    @Test("Uploads bounded audio with model and terminal prompt")
    func uploadsAudio() async throws {
        let audioURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice.m4a")
        try Data("audio-data".utf8).write(to: audioURL)
        defer { try? FileManager.default.removeItem(at: audioURL) }

        let session = URLSession(configuration: .mockConfiguration)
        MockURLProtocol.requestHandler = { request in
            #expect(request.url?.absoluteString == "https://api.openai.com/v1/audio/transcriptions")
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer test-key")
            #expect(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data") == true)

            return try MockURLProtocol.jsonResponse(
                for: request.url!,
                json: ["text": "git status"])
        }

        let service = OpenAITranscriptionService(apiKey: "test-key", session: session)
        let request = try service.makeRequest(
            audioFileURL: audioURL,
            prompt: VoiceTranscriptionConfiguration.prompt)
        let body = String(decoding: request.httpBody ?? Data(), as: UTF8.self)
        #expect(body.contains("name=\"model\""))
        #expect(body.contains(VoiceTranscriptionConfiguration.model))
        #expect(body.contains("name=\"prompt\""))
        #expect(body.contains("filename=\"voice.m4a\""))
        #expect(body.contains("audio-data"))

        let transcript = try await service.transcribe(
            audioFileURL: audioURL,
            prompt: VoiceTranscriptionConfiguration.prompt)

        #expect(transcript == "git status")
        MockURLProtocol.requestHandler = nil
    }

    @Test("Returns the OpenAI API error message")
    func apiError() async throws {
        let audioURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice-error.m4a")
        try Data("audio-data".utf8).write(to: audioURL)
        defer { try? FileManager.default.removeItem(at: audioURL) }

        let session = URLSession(configuration: .mockConfiguration)
        MockURLProtocol.requestHandler = { request in
            try MockURLProtocol.jsonResponse(
                for: request.url!,
                statusCode: 401,
                json: ["error": ["message": "Invalid API key"]])
        }

        let service = OpenAITranscriptionService(apiKey: "test-key", session: session)

        await #expect(throws: OpenAITranscriptionService.TranscriptionError.self) {
            try await service.transcribe(
                audioFileURL: audioURL,
                prompt: VoiceTranscriptionConfiguration.prompt)
        }
        MockURLProtocol.requestHandler = nil
    }
}
