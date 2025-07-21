import Foundation

/// Centralized network-related constants
enum NetworkConstants {
    // MARK: - Default Port

    static let defaultPort = 4_020

    // MARK: - Headers

    static let localAuthHeader = "X-VibeTunnel-Local"
    static let authorizationHeader = "Authorization"
    static let contentTypeHeader = "Content-Type"
    static let hostHeader = "Host"

    // MARK: - Content Types

    static let contentTypeJSON = "application/json"
    static let contentTypeHTML = "text/html"
    static let contentTypeText = "text/plain"

    // MARK: - Common Values

    static let localhost = "localhost"

    // MARK: - Timeout Values

    static let defaultTimeout: TimeInterval = 30.0
    static let uploadTimeout: TimeInterval = 300.0
    static let downloadTimeout: TimeInterval = 300.0

    // MARK: - HTTP Methods

    static let httpMethodGET = "GET"
    static let httpMethodPOST = "POST"
    static let httpMethodPUT = "PUT"
    static let httpMethodDELETE = "DELETE"
    static let httpMethodPATCH = "PATCH"
}
