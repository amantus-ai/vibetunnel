import Foundation
import Testing
@testable import VibeTunnel

@Suite("JSONValue Tests", .tags(.utilities))
struct JSONValueTests {
    @Test("Decodes object with nested values")
    func decodeObject() throws {
        let json = """
        {
            "name": "VibeTunnel",
            "count": 3,
            "flag": true,
            "child": { "value": 1 },
            "list": [1, "two", false, null]
        }
        """
        let data = try #require(json.data(using: .utf8))

        let object = try #require(JSONValue.decodeObject(from: data))
        #expect(object["name"]?.string == "VibeTunnel")
        #expect(object["count"]?.int == 3)
        #expect(object["flag"]?.bool == true)
        #expect(object["child"]?.object?["value"]?.int == 1)
        #expect(object["list"]?.array?.count == 4)
        #expect(object["list"]?.array?.last == .null)
    }

    @Test("Decodes array values")
    func decodeArray() throws {
        let json = #"[1, "two", false, null]"#
        let data = try #require(json.data(using: .utf8))

        let array = try #require(JSONValue.decodeArray(from: data))
        #expect(array.count == 4)
        #expect(array[0].int == 1)
        #expect(array[1].string == "two")
        #expect(array[2].bool == false)
        #expect(array[3] == .null)
    }

    @Test("Round-trips via JSONEncoder/Decoder")
    func roundTrip() throws {
        let value: JSONValue = .object([
            "name": .string("vibe"),
            "count": .number(2),
            "active": .bool(true),
            "list": .array([.string("a"), .number(1)]),
        ])

        let data = try JSONEncoder().encode(value)
        let decoded = try JSONDecoder().decode(JSONValue.self, from: data)
        #expect(decoded == value)
    }

    @Test("Converts from Any payloads")
    func convertsFromAny() throws {
        let payload: [String: Any] = [
            "name": "vibe",
            "count": 2,
            "flag": true,
            "list": [1, "two", false, NSNull()],
        ]

        let value = try #require(JSONValue(any: payload))
        let object = try #require(value.object)
        #expect(object["name"]?.string == "vibe")
        #expect(object["count"]?.int == 2)
        #expect(object["flag"]?.bool == true)
        #expect(object["list"]?.array?.count == 4)
    }

    @Test("Unsupported Any payload returns nil")
    func rejectsUnsupportedAny() {
        struct Unsupported {}
        let value = JSONValue(any: Unsupported())
        #expect(value == nil)
    }
}
