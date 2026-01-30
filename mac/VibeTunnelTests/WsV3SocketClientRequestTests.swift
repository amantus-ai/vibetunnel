import Testing
@testable import VibeTunnel

@Suite("WS v3 request auth headers (mac)")
struct WsV3SocketClientRequestTests {
    @Test("Local auth tokens use X-VibeTunnel-Local header")
    @MainActor
    func localTokenUsesLocalHeader() {
        let token = "local-token-value"
        let request = WsV3SocketClient.shared.makeRequest(serverPort: "4020", token: token)

        #expect(request != nil)
        #expect(request?.value(forHTTPHeaderField: NetworkConstants.localAuthHeader) == token)
        #expect(request?.value(forHTTPHeaderField: NetworkConstants.authorizationHeader) == nil)
        #expect(!(request?.url?.query?.contains("token=") ?? false))
    }

    @Test("JWT tokens use Bearer auth + query token")
    @MainActor
    func jwtTokenUsesBearerAndQuery() {
        let token = "header.payload.signature"
        let request = WsV3SocketClient.shared.makeRequest(serverPort: "4020", token: token)

        #expect(request != nil)
        #expect(request?.value(forHTTPHeaderField: NetworkConstants.localAuthHeader) == nil)
        #expect(request?.value(forHTTPHeaderField: NetworkConstants.authorizationHeader) == "Bearer \(token)")
        #expect(request?.url?.query?.contains("token=\(token)") == true)
    }
}
