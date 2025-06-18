import Foundation
import HTTPTypes
import Hummingbird
import HummingbirdCore
import NIOCore

/// Middleware that implements HTTP Basic Authentication.
///
/// Provides password-based access control for the VibeTunnel dashboard.
/// Validates incoming requests against a configured password using
/// standard HTTP Basic Authentication. Exempts health check endpoints
/// from authentication requirements.
struct BasicAuthMiddleware<Context: RequestContext>: RouterMiddleware {
    let password: String
    let realm: String

    init(password: String, realm: String = "VibeTunnel Dashboard") {
        self.password = password
        self.realm = realm
    }

    func handle(
        _ request: Request,
        context: Context,
        next: (Request, Context) async throws -> Response
    )
        async throws -> Response
    {
        // Skip auth for health check endpoint
        if request.uri.path == "/api/health" {
            return try await next(request, context)
        }

        // Extract authorization header
        guard let authHeader = request.headers[.authorization],
              authHeader.hasPrefix("Basic ")
        else {
            return unauthorizedResponse()
        }

        // Decode base64 credentials
        let base64Credentials = String(authHeader.dropFirst(6))
        guard let credentialsData = Data(base64Encoded: base64Credentials),
              let credentials = String(data: credentialsData, encoding: .utf8)
        else {
            return unauthorizedResponse()
        }

        // Split username:password
        // Find the first colon to separate username and password
        guard let colonIndex = credentials.firstIndex(of: ":") else {
            return unauthorizedResponse()
        }

        // Extract password (everything after the first colon)
        let passwordStartIndex = credentials.index(after: colonIndex)
        let providedPassword = String(credentials[passwordStartIndex...])

        // Verify password
        guard providedPassword == password else {
            return unauthorizedResponse()
        }

        // Password correct, continue with request
        return try await next(request, context)
    }

    private func unauthorizedResponse() -> Response {
        var headers = HTTPFields()
        headers[.wwwAuthenticate] = "Basic realm=\"\(realm)\""

        let message = "Authentication required"
        var buffer = ByteBuffer()
        buffer.writeString(message)

        return Response(
            status: .unauthorized,
            headers: headers,
            body: ResponseBody(byteBuffer: buffer)
        )
    }
}
