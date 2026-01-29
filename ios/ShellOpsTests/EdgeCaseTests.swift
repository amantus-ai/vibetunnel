import Foundation
import Testing

@Suite("Edge Case and Boundary Tests", .tags(.critical))
struct EdgeCaseTests {
    // MARK: - String and Buffer Boundaries

    @Test("Empty and nil string handling")
    func emptyStrings() {
        // Test various empty string scenarios
        let emptyString = ""
        let whitespaceString = "   "
        let newlineString = "\n\n\n"

        #expect(emptyString.isEmpty)
        #expect(whitespaceString.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        #expect(newlineString.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

        // Test optional string handling
        let nilString: String? = nil
        let emptyOptional: String? = ""

        #expect(nilString?.isEmpty ?? true)
        #expect(emptyOptional?.isEmpty == true)
    }

    @Test("Maximum string length boundaries")
    func stringBoundaries() {
        // Test very long strings
        let maxReasonableLength = 1_000_000
        let longString = String(repeating: "a", count: maxReasonableLength)

        #expect(longString.count == maxReasonableLength)

        // Test string truncation
        func truncate(_ string: String, to maxLength: Int) -> String {
            if string.count <= maxLength {
                return string
            }
            let endIndex = string.index(string.startIndex, offsetBy: maxLength)
            return String(string[..<endIndex]) + "..."
        }

        let truncated = truncate(longString, to: 100)
        #expect(truncated.count == 103) // 100 + "..."
        #expect(truncated.hasSuffix("..."))
    }

    // MARK: - Numeric Boundaries

    @Test("Integer overflow and underflow")
    func integerBoundaries() {
        // Test boundaries
        let maxInt = Int.max
        let minInt = Int.min

        // Safe addition with overflow check
        func safeAdd(_ a: Int, _ b: Int) -> Int? {
            let (result, overflow) = a.addingReportingOverflow(b)
            return overflow ? nil : result
        }

        #expect(safeAdd(maxInt, 1) == nil)
        #expect(safeAdd(minInt, -1) == nil)
        #expect(safeAdd(100, 200) == 300)

        // Test conversion boundaries
        let uint32Max = UInt32.max
        let int32Max = Int32.max

        // On 64-bit systems, Int can hold UInt32.max
        #if arch(i386) || arch(arm)
        #expect(Int(exactly: uint32Max) == nil) // Can't fit in 32-bit Int
        #else
        #expect(Int(exactly: uint32Max) != nil) // Can fit in 64-bit Int
        #endif
        #expect(Int32(exactly: int32Max) == int32Max)
    }

    @Test("Floating point edge cases")
    func floatingPointEdgeCases() {
        let infinity = Double.infinity
        let negInfinity = -Double.infinity
        let nan = Double.nan

        #expect(infinity.isInfinite)
        #expect(negInfinity.isInfinite)
        #expect(nan.isNaN)

        // Test comparisons with special values
        #expect(nan.isNaN) // NaN is not equal to itself
        #expect(infinity > 1_000_000)
        #expect(negInfinity < -1_000_000)

        // Test safe division
        func safeDivide(_ a: Double, by b: Double) -> Double? {
            guard b != 0, !b.isNaN else { return nil }
            let result = a / b
            return result.isFinite ? result : nil
        }

        #expect(safeDivide(10, by: 0) == nil)
        #expect(safeDivide(10, by: 2) == 5)
        #expect(safeDivide(infinity, by: 2) == nil)
    }

    // MARK: - Collection Boundaries

    @Test("Empty collection handling")
    func emptyCollections() {
        let emptyArray: [Int] = []
        let emptyDict: [String: Any] = [:]
        let emptySet: Set<String> = []

        #expect(emptyArray.first == nil)
        #expect(emptyArray.last == nil)
        #expect(emptyDict.isEmpty)
        #expect(emptySet.isEmpty)

        // Safe array access
        func safeAccess<T>(_ array: [T], at index: Int) -> T? {
            guard index >= 0, index < array.count else { return nil }
            return array[index]
        }

        #expect(safeAccess(emptyArray, at: 0) == nil)
        #expect(safeAccess([1, 2, 3], at: 1) == 2)
        #expect(safeAccess([1, 2, 3], at: 10) == nil)
        #expect(safeAccess([1, 2, 3], at: -1) == nil)
    }

    @Test("Large collection performance boundaries")
    func largeCollections() {
        // Test with moderately large collections
        let largeSize = 10000
        let largeArray = Array(0..<largeSize)
        let largeSet = Set(0..<largeSize)
        let largeDict = Dictionary(uniqueKeysWithValues: (0..<largeSize).map { ($0, "value\($0)") })

        #expect(largeArray.count == largeSize)
        #expect(largeSet.count == largeSize)
        #expect(largeDict.count == largeSize)

        // Test contains performance
        #expect(largeSet.contains(5000))
        #expect(!largeSet.contains(largeSize))

        // Test dictionary access
        #expect(largeDict[5000] == "value5000")
        #expect(largeDict[largeSize] == nil)
    }

    // MARK: - Date and Time Boundaries

    @Test("Date boundary conditions")
    func dateBoundaries() {
        // Test distant dates
        let distantPast = Date.distantPast
        let distantFuture = Date.distantFuture
        let now = Date()

        #expect(distantPast < now)
        #expect(distantFuture > now)

        // Test date calculations near boundaries
        let oneDay: TimeInterval = 86400
        let farFuture = distantFuture.addingTimeInterval(-oneDay)
        #expect(farFuture < distantFuture)

        // Test date component validation
        var components = DateComponents()
        components.year = 2024
        components.month = 13 // Invalid month
        components.day = 32 // Invalid day

        let calendar = Calendar.current
        let date = calendar.date(from: components)

        // Calendar may adjust invalid dates rather than return nil
        if let date {
            let adjustedComponents = calendar.dateComponents([.year, .month, .day], from: date)
            // Should have adjusted the invalid values
            #expect(adjustedComponents.month != 13)
            #expect(adjustedComponents.day != 32)
        }
    }

    // MARK: - URL and Network Boundaries

    @Test("URL edge cases")
    func uRLEdgeCases() {
        // Test various URL formats
        let validURLs = [
            "https://example.com",
            "http://localhost:8080",
            "ftp://files.example.com",
            "file:///Users/test/file.txt",
            "https://example.com/path%20with%20spaces",
        ]

        for urlString in validURLs {
            let url = URL(string: urlString)
            #expect(url != nil)
        }

        // Test URLs that should be invalid or have issues
        let problematicURLs = [
            ("", false), // Empty string
            ("not a url", true), // Might be parsed as relative URL
            ("http://", true), // Has scheme but no host
            ("://missing-scheme", true), // Invalid format
            ("http://[invalid-ipv6", false), // Malformed IPv6
            ("https://example.com/\u{0000}", true), // Null character
        ]

        for (urlString, mightBeValid) in problematicURLs {
            let url = URL(string: urlString)
            if mightBeValid, url != nil {
                // Check if it's actually a useful URL
                #expect(url?.scheme != nil || url?.host != nil || url?.path != nil)
            } else {
                #expect(url == nil)
            }
        }

        // Test extremely long URLs
        let longPath = String(repeating: "a", count: 2000)
        let longURL = "https://example.com/\(longPath)"
        let url = URL(string: longURL)
        #expect(url != nil)
        #expect(url?.absoluteString.count ?? 0 > 2000)
    }

    // MARK: - Thread Safety Boundaries

    @Test("Concurrent access boundaries")
    func concurrentAccess() {
        // Test thread-safe counter
        final class ThreadSafeCounter: @unchecked Sendable {
            private var value = 0
            private let queue = DispatchQueue(label: "counter", attributes: .concurrent)

            func increment() {
                self.queue.async(flags: .barrier) {
                    self.value += 1
                }
            }

            func read() -> Int {
                self.queue.sync { self.value }
            }
        }

        let counter = ThreadSafeCounter()
        let iterations = 100
        let group = DispatchGroup()

        // Simulate concurrent increments
        for _ in 0..<iterations {
            group.enter()
            DispatchQueue.global().async {
                counter.increment()
                group.leave()
            }
        }

        group.wait()

        // Value should be exactly iterations (no race conditions)
        #expect(counter.read() == iterations)
    }

    // MARK: - Memory Boundaries

    @Test("Memory allocation boundaries")
    func memoryBoundaries() {
        // Test large data allocation
        let megabyte = 1024 * 1024
        let size = 10 * megabyte // 10 MB

        // Safely allocate memory
        func safeAllocate(bytes: Int) -> Data? {
            guard bytes > 0, bytes < Int.max / 2 else { return nil }
            return Data(count: bytes)
        }

        let data = safeAllocate(bytes: size)
        #expect(data?.count == size)

        // Test zero allocation
        let zeroData = safeAllocate(bytes: 0)
        #expect(zeroData == nil)

        // Test negative allocation (caught by guard)
        let negativeData = safeAllocate(bytes: -1)
        #expect(negativeData == nil)
    }

    // MARK: - Encoding Edge Cases

    @Test("Character encoding boundaries")
    func encodingBoundaries() {
        // Test various Unicode scenarios
        let testCases = [
            "Hello", // ASCII
            "你好", // Chinese
            "🇺🇸🇬🇧", // Flag emojis
            "👨‍👩‍👧‍👦", // Family emoji
            "\u{0000}", // Null character
            "\u{FFFF}", // Maximum BMP character
            "A\u{0301}", // Combining character (A + accent)
        ]

        for testString in testCases {
            // Test UTF-8 encoding
            let utf8Data = testString.data(using: .utf8)
            #expect(utf8Data != nil)

            // Test round-trip
            if let data = utf8Data {
                let decoded = String(data: data, encoding: .utf8)
                #expect(decoded == testString)
            }
        }

        // Test invalid UTF-8 sequences
        let invalidUTF8 = Data([0xFF, 0xFE, 0xFD])
        let decoded = String(data: invalidUTF8, encoding: .utf8)
        #expect(decoded == nil)
    }

    // MARK: - JSON Edge Cases

    @Test("JSON encoding special cases")
    func jSONEdgeCases() {
        struct TestModel: Codable {
            let value: Any?

            enum CodingKeys: String, CodingKey {
                case value
            }

            init(value: Any?) {
                self.value = value
            }

            init(from decoder: Decoder) throws {
                let container = try decoder.container(keyedBy: CodingKeys.self)
                if let intValue = try? container.decode(Int.self, forKey: .value) {
                    self.value = intValue
                } else if let doubleValue = try? container.decode(Double.self, forKey: .value) {
                    self.value = doubleValue
                } else if let stringValue = try? container.decode(String.self, forKey: .value) {
                    self.value = stringValue
                } else {
                    self.value = nil
                }
            }

            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                if let intValue = value as? Int {
                    try container.encode(intValue, forKey: .value)
                } else if let doubleValue = value as? Double {
                    try container.encode(doubleValue, forKey: .value)
                } else if let stringValue = value as? String {
                    try container.encode(stringValue, forKey: .value)
                } else {
                    try container.encodeNil(forKey: .value)
                }
            }
        }

        // Test edge case values
        let edgeCases: [(String, Bool)] = [
            (#"{"value": null}"#, true),
            (#"{"value": 9223372036854775807}"#, true), // Int.max
            (#"{"value": -9223372036854775808}"#, true), // Int.min
            (#"{"value": 1.7976931348623157e+308}"#, true), // Near Double.max
            (#"{"value": "string with \"quotes\""}"#, true),
            (#"{"value": "\u0000"}"#, true), // Null character
            (#"{invalid json}"#, false),
            (#"{"value": undefined}"#, false),
        ]

        for (json, shouldSucceed) in edgeCases {
            let data = json.data(using: .utf8)!
            let decoded = try? JSONDecoder().decode(TestModel.self, from: data)

            if shouldSucceed {
                #expect(decoded != nil)
            } else {
                #expect(decoded == nil)
            }
        }
    }
}
