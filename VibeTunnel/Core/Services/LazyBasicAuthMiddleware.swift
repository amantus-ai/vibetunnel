import Foundation
import HTTPTypes
import Hummingbird
import HummingbirdCore
import NIOCore
import os

/// Middleware that implements HTTP Basic Authentication with lazy password loading.
///
/// This middleware defers keychain access until an authenticated request is received,
/// preventing unnecessary keychain prompts on app startup. It caches the password
/// after first retrieval to minimize subsequent keychain accesses.
struct LazyBasicAuthMiddleware<Context: RequestContext>: RouterMiddleware where Context: Sendable {
    private let realm: String
    private let logger = Logger(subsystem: "sh.vibetunnel.vibetunnel", category: "LazyBasicAuth")
    private let passwordCache = PasswordCache()

    init(realm: String = "VibeTunnel Dashboard") {
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

        // Check if password protection is enabled
        guard UserDefaults.standard.bool(forKey: "dashboardPasswordEnabled") else {
            // No password protection, allow request
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
        let parts = credentials.split(separator: ":", maxSplits: 1)
        guard parts.count == 2 else {
            return unauthorizedResponse()
        }

        // We ignore the username and only check password
        let providedPassword = String(parts[1])

        // Get password (cached or from keychain)
        let requiredPassword: String
        if let cached = await passwordCache.getPassword() {
            requiredPassword = cached
            logger.debug("Using cached password")
        } else {
            // First authentication attempt - access keychain
            guard let password = await MainActor.run(body: {
                DashboardKeychain.shared.getPassword()
            }) else {
                logger.error("Password protection enabled but no password found in keychain")
                return unauthorizedResponse()
            }
            await passwordCache.setPassword(password)
            requiredPassword = password
            logger.info("Password loaded from keychain and cached")
        }

        // Verify password
        guard providedPassword == requiredPassword else {
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

    /// Clears the cached password (useful when password is changed)
    func clearCache() async {
        await passwordCache.clear()
    }
}

/// Actor to manage password caching in a thread-safe way
private actor PasswordCache {
    private var cachedPassword: String?

    func getPassword() -> String? {
        cachedPassword
    }

    func setPassword(_ password: String) {
        cachedPassword = password
    }

    func clear() {
        cachedPassword = nil
    }
}
