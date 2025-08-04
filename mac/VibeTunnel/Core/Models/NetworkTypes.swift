import Foundation

// MARK: - Network Request Extensions

/// Extension to provide network error boundaries for common async operations
extension URLSession {
    /// Perform a data request with enhanced error handling
    func dataWithErrorBoundary(for request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await data(for: request)
        } catch {
            if let urlError = error as? URLError {
                throw NetworkError.from(urlError)
            }
            throw error
        }
    }
    
    /// Perform a data request from URL with enhanced error handling
    func dataWithErrorBoundary(from url: URL) async throws -> (Data, URLResponse) {
        do {
            return try await data(from: url)
        } catch {
            if let urlError = error as? URLError {
                throw NetworkError.from(urlError)
            }
            throw error
        }
    }
}

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

/// Common network errors for API requests with enhanced error handling
public enum NetworkError: LocalizedError {
    case invalidResponse
    case serverError(statusCode: Int, message: String)
    case decodingError(Error)
    case noData
    case connectionFailed(URLError)
    case timeout
    case serverUnavailable
    case authenticationRequired
    case forbidden
    case notFound
    case tooManyRequests
    case serverOverloaded
    case networkConnectionLost
    case cancelled

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
        case .connectionFailed:
            "Cannot connect to server"
        case .timeout:
            "Request timed out"
        case .serverUnavailable:
            "Server is currently unavailable"
        case .authenticationRequired:
            "Authentication required"
        case .forbidden:
            "Access denied"
        case .notFound:
            "Endpoint not found"
        case .tooManyRequests:
            "Too many requests, please try again later"
        case .serverOverloaded:
            "Server is overloaded, please try again later"
        case .networkConnectionLost:
            "Network connection lost"
        case .cancelled:
            "Request was cancelled"
        }
    }
    
    public var failureReason: String? {
        switch self {
        case .connectionFailed(let urlError):
            return urlError.localizedDescription
        case .serverError(_, let message):
            return message
        case .decodingError(let error):
            return error.localizedDescription
        default:
            return nil
        }
    }
    
    public var recoverySuggestion: String? {
        switch self {
        case .connectionFailed, .serverUnavailable:
            return "Check that the server is running and try again"
        case .timeout:
            return "The request took too long. Check your connection and try again"
        case .authenticationRequired:
            return "Please check your authentication credentials"
        case .forbidden:
            return "You don't have permission to access this resource"
        case .notFound:
            return "The requested resource was not found"
        case .tooManyRequests:
            return "Please wait a moment before trying again"
        case .serverOverloaded:
            return "The server is busy. Please try again in a few moments"
        case .networkConnectionLost:
            return "Check your network connection and try again"
        default:
            return "Please try again"
        }
    }
    
    /// Create a NetworkError from a URLError
    public static func from(_ urlError: URLError) -> NetworkError {
        switch urlError.code {
        case .cannotConnectToHost, .cannotFindHost:
            return .connectionFailed(urlError)
        case .timedOut:
            return .timeout
        case .networkConnectionLost:
            return .networkConnectionLost
        case .cancelled:
            return .cancelled
        case .userAuthenticationRequired:
            return .authenticationRequired
        case .fileDoesNotExist:
            return .notFound
        case .badServerResponse:
            return .serverUnavailable
        default:
            return .connectionFailed(urlError)
        }
    }
    
    /// Create a NetworkError from an HTTP status code
    public static func from(statusCode: Int, message: String? = nil) -> NetworkError {
        let defaultMessage = message ?? "Request failed with status \(statusCode)"
        
        switch statusCode {
        case 401:
            return .authenticationRequired
        case 403:
            return .forbidden
        case 404:
            return .notFound
        case 429:
            return .tooManyRequests
        case 500...503:
            return .serverOverloaded
        case 504:
            return .timeout
        case 500...599:
            return .serverError(statusCode: statusCode, message: defaultMessage)
        default:
            return .serverError(statusCode: statusCode, message: defaultMessage)
        }
    }
}
