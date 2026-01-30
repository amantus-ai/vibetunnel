import Foundation
@testable import VibeTunnel

/// Mock URLProtocol for intercepting and stubbing network requests in tests
class MockURLProtocol: URLProtocol {
    nonisolated(unsafe) static var requestHandler: ((URLRequest) throws -> (HTTPURLResponse, Data?))?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = MockURLProtocol.requestHandler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)

            if let data {
                client?.urlProtocol(self, didLoad: data)
            }

            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {
        // No-op
    }
}

// MARK: - Helper Methods

extension MockURLProtocol {
    static func successResponse(
        for url: URL,
        statusCode: Int = 200,
        data: Data? = nil,
        headers: [String: String] = [:])
        -> (HTTPURLResponse, Data?)
    {
        let response = HTTPURLResponse(
            url: url,
            statusCode: statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: headers)!
        return (response, data)
    }

    static func jsonResponse(
        for url: URL,
        statusCode: Int = 200,
        json: Any)
        throws -> (HTTPURLResponse, Data?)
    {
        let data = try self.encodeJSON(json)
        let headers = ["Content-Type": "application/json"]
        return self.successResponse(for: url, statusCode: statusCode, data: data, headers: headers)
    }

    static func errorResponse(
        for url: URL,
        statusCode: Int,
        message: String? = nil)
        -> (HTTPURLResponse, Data?)
    {
        var data: Data?
        if let message {
            let json = ["error": message]
            data = try? self.encodeJSON(json)
        }
        return self.successResponse(for: url, statusCode: statusCode, data: data)
    }

    private static func encodeJSON(_ json: Any) throws -> Data {
        guard let value = JSONValue(any: json) else {
            throw URLError(.cannotParseResponse)
        }
        return try JSONEncoder().encode(value)
    }
}

// MARK: - Test Configuration

extension URLSessionConfiguration {
    static var mockConfiguration: URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return config
    }
}
