import Foundation

// MARK: - Error Response

/// Unified error response structure for API errors
public struct ErrorResponse: Codable, Sendable {
    public let error: String
    public let code: String?
    public let details: String?

    public init(error: String, code: String? = nil, details: String? = nil) {
        self.error = error
        self.code = code
        self.details = details
    }
}

// MARK: - Network Errors

/// Common network errors for API requests
public enum NetworkError: LocalizedError {
    case invalidResponse
    case serverError(statusCode: Int, message: String)
    case decodingError(Error)
    case noData

    public var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "Invalid server response"
        case .serverError(let statusCode, let message):
            "Server error (\(statusCode)): \(message)"
        case .decodingError(let error):
            "Failed to decode response: \(error.localizedDescription)"
        case .noData:
            "No data received from server"
        }
    }
}
