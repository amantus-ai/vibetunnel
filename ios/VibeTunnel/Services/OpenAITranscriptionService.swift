import Foundation

@MainActor
protocol TranscriptionServicing {
    func transcribe(audioFileURL: URL, prompt: String) async throws -> String
}

@MainActor
struct OpenAITranscriptionService: TranscriptionServicing {
    private let apiKey: String
    private let session: URLSession
    private let endpoint: URL

    init(
        apiKey: String,
        session: URLSession = .shared,
        endpoint: URL = URL(string: "https://api.openai.com/v1/audio/transcriptions")!)
    {
        self.apiKey = apiKey
        self.session = session
        self.endpoint = endpoint
    }

    func transcribe(audioFileURL: URL, prompt: String) async throws -> String {
        let request = try self.makeRequest(audioFileURL: audioFileURL, prompt: prompt)

        let (data, response) = try await self.session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw TranscriptionError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            let apiError = try? JSONDecoder().decode(APIErrorResponse.self, from: data)
            throw TranscriptionError.apiError(
                apiError?.error.message ?? "OpenAI returned HTTP \(httpResponse.statusCode).")
        }

        guard let result = try? JSONDecoder().decode(TranscriptionResponse.self, from: data),
              !result.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            throw TranscriptionError.invalidResponse
        }
        return result.text
    }

    func makeRequest(audioFileURL: URL, prompt: String) throws -> URLRequest {
        guard !self.apiKey.isEmpty else {
            throw TranscriptionError.missingAPIKey
        }

        let audioData = try Data(contentsOf: audioFileURL)
        var form = MultipartFormData()
        form.append(name: "model", value: VoiceTranscriptionConfiguration.model)
        form.append(name: "response_format", value: "json")
        form.append(name: "prompt", value: prompt)
        form.append(
            name: "file",
            filename: audioFileURL.lastPathComponent,
            contentType: "audio/mp4",
            data: audioData)

        var request = URLRequest(url: self.endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 90
        request.setValue("Bearer \(self.apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue(form.contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = form.finalizedData
        return request
    }

    private struct TranscriptionResponse: Decodable {
        let text: String
    }

    private struct APIErrorResponse: Decodable {
        struct APIError: Decodable {
            let message: String
        }

        let error: APIError
    }

    enum TranscriptionError: LocalizedError {
        case apiError(String)
        case invalidResponse
        case missingAPIKey

        var errorDescription: String? {
            switch self {
            case let .apiError(message):
                "Voice transcription failed: \(message)"
            case .invalidResponse:
                "OpenAI returned an invalid transcription response."
            case .missingAPIKey:
                "Add an OpenAI API key in Settings > General > Voice Input."
            }
        }
    }
}

private struct MultipartFormData {
    private let boundary = "VibeTunnel-\(UUID().uuidString)"
    private var data = Data()

    var contentType: String {
        "multipart/form-data; boundary=\(self.boundary)"
    }

    var finalizedData: Data {
        var result = self.data
        result.appendUTF8("--\(self.boundary)--\r\n")
        return result
    }

    mutating func append(name: String, value: String) {
        self.data.appendUTF8("--\(self.boundary)\r\n")
        self.data.appendUTF8("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
        self.data.appendUTF8("\(value)\r\n")
    }

    mutating func append(name: String, filename: String, contentType: String, data: Data) {
        self.data.appendUTF8("--\(self.boundary)\r\n")
        self.data.appendUTF8(
            "Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n")
        self.data.appendUTF8("Content-Type: \(contentType)\r\n\r\n")
        self.data.append(data)
        self.data.appendUTF8("\r\n")
    }
}

extension Data {
    fileprivate mutating func appendUTF8(_ value: String) {
        self.append(contentsOf: value.utf8)
    }
}
