import Foundation
import Testing

@Suite("Authentication and Security Tests", .tags(.critical, .security))
struct AuthenticationTests {
    // MARK: - Password Authentication

    @Test("Password hashing and validation")
    func passwordHashing() {
        // Test password requirements
        func isValidPassword(_ password: String) -> Bool {
            password.count >= 8 &&
                password.rangeOfCharacter(from: .uppercaseLetters) != nil &&
                password.rangeOfCharacter(from: .lowercaseLetters) != nil &&
                password.rangeOfCharacter(from: .decimalDigits) != nil
        }

        #expect(isValidPassword("Test1234") == true)
        #expect(isValidPassword("weak") == false)
        #expect(isValidPassword("ALLCAPS123") == false)
        #expect(isValidPassword("nocaps123") == false)
        #expect(isValidPassword("NoNumbers") == false)
    }

    @Test("Basic authentication header formatting")
    func basicAuthHeader() {
        let username = "testuser"
        let password = "Test@123"

        // Create Basic auth header
        let credentials = "\(username):\(password)"
        let encodedCredentials = credentials.data(using: .utf8)?.base64EncodedString() ?? ""
        let authHeader = "Basic \(encodedCredentials)"

        #expect(authHeader.hasPrefix("Basic "))
        #expect(!encodedCredentials.isEmpty)

        // Decode and verify
        if let decodedData = Data(base64Encoded: encodedCredentials),
           let decodedString = String(data: decodedData, encoding: .utf8)
        {
            #expect(decodedString == credentials)
        }
    }

    @Test("Token-based authentication")
    func tokenAuth() {
        struct AuthToken {
            let value: String
            let expiresAt: Date

            var isExpired: Bool {
                Date() > expiresAt
            }

            var authorizationHeader: String {
                "Bearer \(value)"
            }
        }

        let futureDate = Date().addingTimeInterval(3_600) // 1 hour
        let pastDate = Date().addingTimeInterval(-3_600) // 1 hour ago

        let validToken = AuthToken(value: "valid-token-123", expiresAt: futureDate)
        let expiredToken = AuthToken(value: "expired-token-456", expiresAt: pastDate)

        #expect(!validToken.isExpired)
        #expect(expiredToken.isExpired)
        #expect(validToken.authorizationHeader == "Bearer valid-token-123")
    }

    // MARK: - Session Security

    @Test("Session ID generation and validation")
    func sessionIdSecurity() {
        func generateSessionId() -> String {
            // Generate cryptographically secure session ID
            var bytes = [UInt8](repeating: 0, count: 32)
            _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
            return bytes.map { String(format: "%02x", $0) }.joined()
        }

        let sessionId1 = generateSessionId()
        let sessionId2 = generateSessionId()

        // Session IDs should be unique
        #expect(sessionId1 != sessionId2)

        // Should be 64 characters (32 bytes * 2 hex chars)
        #expect(sessionId1.count == 64)
        #expect(sessionId2.count == 64)

        // Should only contain hex characters
        let hexCharacterSet = CharacterSet(charactersIn: "0123456789abcdef")
        #expect(sessionId1.rangeOfCharacter(from: hexCharacterSet.inverted) == nil)
    }

    @Test("Session timeout handling")
    func sessionTimeout() {
        struct Session {
            let id: String
            let createdAt: Date
            let timeoutInterval: TimeInterval

            var isExpired: Bool {
                Date().timeIntervalSince(createdAt) > timeoutInterval
            }
        }

        let activeSession = Session(
            id: "active-123",
            createdAt: Date(),
            timeoutInterval: 3_600 // 1 hour
        )

        let expiredSession = Session(
            id: "expired-456",
            createdAt: Date().addingTimeInterval(-7_200), // 2 hours ago
            timeoutInterval: 3_600 // 1 hour timeout
        )

        #expect(!activeSession.isExpired)
        #expect(expiredSession.isExpired)
    }

    // MARK: - URL Security

    @Test("Secure URL validation")
    func secureURLValidation() {
        func isSecureURL(_ urlString: String) -> Bool {
            guard let url = URL(string: urlString) else { return false }
            return url.scheme == "https" || url.scheme == "wss"
        }

        #expect(isSecureURL("https://example.com") == true)
        #expect(isSecureURL("wss://example.com/socket") == true)
        #expect(isSecureURL("http://example.com") == false)
        #expect(isSecureURL("ws://example.com/socket") == false)
        #expect(isSecureURL("ftp://example.com") == false)
        #expect(isSecureURL("not-a-url") == false)
    }

    @Test("URL sanitization")
    func uRLSanitization() {
        func sanitizeURL(_ urlString: String) -> String? {
            // Remove trailing slashes and whitespace
            var sanitized = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
            if sanitized.hasSuffix("/") {
                sanitized = String(sanitized.dropLast())
            }

            // Validate URL - must have scheme and host
            guard let url = URL(string: sanitized),
                  url.scheme != nil,
                  url.host != nil else { return nil }

            return sanitized
        }

        #expect(sanitizeURL("https://example.com/") == "https://example.com")
        #expect(sanitizeURL("  https://example.com  ") == "https://example.com")
        #expect(sanitizeURL("https://example.com/path/") == "https://example.com/path")
        #expect(sanitizeURL("invalid url") == nil)
    }

    // MARK: - Certificate Pinning

    @Test("Certificate validation logic")
    func certificateValidation() {
        struct CertificateValidator {
            let pinnedCertificates: Set<String> // SHA256 hashes

            func isValid(certificateHash: String) -> Bool {
                pinnedCertificates.contains(certificateHash)
            }
        }

        let validator = CertificateValidator(pinnedCertificates: [
            "abc123def456", // Example hash
            "789ghi012jkl" // Another example
        ])

        #expect(validator.isValid(certificateHash: "abc123def456") == true)
        #expect(validator.isValid(certificateHash: "unknown-hash") == false)
    }

    // MARK: - Input Sanitization

    @Test("Command injection prevention")
    func commandSanitization() {
        func sanitizeCommand(_ input: String) -> String {
            // Remove potentially dangerous characters
            let dangerousCharacters = CharacterSet(charactersIn: ";&|`$(){}[]<>\"'\\")
            return input.components(separatedBy: dangerousCharacters).joined(separator: " ")
        }

        #expect(sanitizeCommand("ls -la") == "ls -la")
        #expect(sanitizeCommand("rm -rf /; echo 'hacked'") == "rm -rf /  echo  hacked ")
        #expect(sanitizeCommand("cat /etc/passwd | grep root") == "cat /etc/passwd   grep root")
        #expect(sanitizeCommand("$(malicious_command)") == "  malicious_command ")
    }

    @Test("Path traversal prevention")
    func pathTraversalPrevention() {
        func isValidPath(_ path: String, allowedRoot: String) -> Bool {
            // Normalize the path
            let normalizedPath = (path as NSString).standardizingPath

            // Check for path traversal attempts
            if normalizedPath.contains("..") {
                return false
            }

            // Ensure path is within allowed root
            return normalizedPath.hasPrefix(allowedRoot)
        }

        let allowedRoot = "/Users/app/documents"

        #expect(isValidPath("/Users/app/documents/file.txt", allowedRoot: allowedRoot) == true)
        #expect(isValidPath("/Users/app/documents/subfolder/file.txt", allowedRoot: allowedRoot) == true)
        #expect(isValidPath("/Users/app/documents/../../../etc/passwd", allowedRoot: allowedRoot) == false)
        #expect(isValidPath("/etc/passwd", allowedRoot: allowedRoot) == false)
    }

    // MARK: - Rate Limiting

    @Test("Rate limiting implementation")
    func rateLimiting() {
        class RateLimiter {
            private var requestCounts: [String: (count: Int, resetTime: Date)] = [:]
            private let maxRequests: Int
            private let windowDuration: TimeInterval

            init(maxRequests: Int, windowDuration: TimeInterval) {
                self.maxRequests = maxRequests
                self.windowDuration = windowDuration
            }

            func shouldAllowRequest(for identifier: String) -> Bool {
                let now = Date()

                if let (count, resetTime) = requestCounts[identifier] {
                    if now > resetTime {
                        // Window expired, reset
                        requestCounts[identifier] = (1, now.addingTimeInterval(windowDuration))
                        return true
                    } else if count >= maxRequests {
                        return false
                    } else {
                        requestCounts[identifier] = (count + 1, resetTime)
                        return true
                    }
                } else {
                    // First request
                    requestCounts[identifier] = (1, now.addingTimeInterval(windowDuration))
                    return true
                }
            }
        }

        let limiter = RateLimiter(maxRequests: 3, windowDuration: 60)
        let clientId = "client-123"

        // First 3 requests should be allowed
        #expect(limiter.shouldAllowRequest(for: clientId) == true)
        #expect(limiter.shouldAllowRequest(for: clientId) == true)
        #expect(limiter.shouldAllowRequest(for: clientId) == true)

        // 4th request should be blocked
        #expect(limiter.shouldAllowRequest(for: clientId) == false)

        // Different client should be allowed
        #expect(limiter.shouldAllowRequest(for: "other-client") == true)
    }

    // MARK: - Secure Storage

    @Test("Keychain storage security")
    func keychainStorage() {
        struct KeychainItem {
            let service: String
            let account: String
            let data: Data
            let accessGroup: String?

            var query: [String: Any] {
                var query: [String: Any] = [
                    kSecClass as String: kSecClassGenericPassword,
                    kSecAttrService as String: service,
                    kSecAttrAccount as String: account
                ]

                if let accessGroup {
                    query[kSecAttrAccessGroup as String] = accessGroup
                }

                return query
            }
        }

        let item = KeychainItem(
            service: "com.vibetunnel.app",
            account: "user-token",
            data: "secret-token".data(using: .utf8)!,
            accessGroup: nil
        )

        #expect(item.query[kSecClass as String] as? String == kSecClassGenericPassword as String)
        #expect(item.query[kSecAttrService as String] as? String == "com.vibetunnel.app")
        #expect(item.query[kSecAttrAccount as String] as? String == "user-token")
    }

    // MARK: - CORS and Origin Validation

    @Test("CORS origin validation")
    func cORSValidation() {
        func isAllowedOrigin(_ origin: String, allowedOrigins: Set<String>) -> Bool {
            // Check exact match
            if allowedOrigins.contains(origin) {
                return true
            }

            // Check wildcard patterns
            for allowed in allowedOrigins {
                if allowed == "*" {
                    return true
                }
                if allowed.contains("*") {
                    // Simple wildcard matching: replace * with any subdomain
                    let pattern = allowed.replacingOccurrences(of: "*", with: "[^.]+")
                    let regex = try? NSRegularExpression(pattern: "^" + pattern + "$")
                    if let regex,
                       regex.firstMatch(in: origin, range: NSRange(origin.startIndex..., in: origin)) != nil
                    {
                        return true
                    }
                }
            }

            return false
        }

        let allowedOrigins: Set<String> = [
            "https://app.vibetunnel.com",
            "https://*.vibetunnel.com",
            "http://localhost:3000"
        ]

        #expect(isAllowedOrigin("https://app.vibetunnel.com", allowedOrigins: allowedOrigins) == true)
        #expect(isAllowedOrigin("https://dev.vibetunnel.com", allowedOrigins: allowedOrigins) == true)
        #expect(isAllowedOrigin("http://localhost:3000", allowedOrigins: allowedOrigins) == true)
        #expect(isAllowedOrigin("https://evil.com", allowedOrigins: allowedOrigins) == false)
        #expect(isAllowedOrigin("http://app.vibetunnel.com", allowedOrigins: allowedOrigins) == false)
    }
}
