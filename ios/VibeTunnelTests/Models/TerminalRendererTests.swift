import Foundation
import Testing
@testable import VibeTunnel

@Suite("TerminalRenderer Tests", .tags(.models))
struct TerminalRendererTests {

    let userDefaultsKey = "selectedTerminalRenderer"

    @Test("All cases have raw values")
    func allCasesRawValues() {
        #expect(TerminalRenderer.swiftTerm.rawValue == "SwiftTerm")
        #expect(TerminalRenderer.xterm.rawValue == "xterm.js")
    }

    @Test("Display names are correct")
    func displayNames() {
        #expect(TerminalRenderer.swiftTerm.displayName == "SwiftTerm (Native)")
        #expect(TerminalRenderer.xterm.displayName == "xterm.js (WebView)")
    }

    @Test("Descriptions are correct")
    func descriptions() {
        #expect(TerminalRenderer.swiftTerm.description == "Native Swift terminal emulator with best performance")
        #expect(TerminalRenderer.xterm.description == "JavaScript-based terminal, identical to web version")
    }

    @Test("Default selection is SwiftTerm")
    func defaultSelection() {
        // Ensure no value is set
        UserDefaults.standard.removeObject(forKey: userDefaultsKey)

        #expect(TerminalRenderer.selected == .swiftTerm)
    }

    @Test("Selection persists to UserDefaults", .disabled("UserDefaults direct usage needs dependency injection refactor"))
    func selectionPersistence() {
        // Store original value to restore after test
        let originalRenderer = TerminalRenderer.selected
        defer {
            // Restore original value
            TerminalRenderer.selected = originalRenderer
        }
        
        // Set to xterm
        TerminalRenderer.selected = .xterm

        // Verify it was saved
        let savedValue = UserDefaults.standard.string(forKey: userDefaultsKey)
        #expect(savedValue == "xterm.js")

        // Verify getter returns correct value
        #expect(TerminalRenderer.selected == .xterm)

        // Change to swiftTerm
        TerminalRenderer.selected = .swiftTerm

        // Verify it was updated
        let updatedValue = UserDefaults.standard.string(forKey: userDefaultsKey)
        #expect(updatedValue == "SwiftTerm")

        // Verify getter returns updated value
        #expect(TerminalRenderer.selected == .swiftTerm)
    }

    @Test("Invalid UserDefaults value returns default")
    func invalidUserDefaultsValue() {
        // Set invalid value directly
        UserDefaults.standard.set("InvalidRenderer", forKey: userDefaultsKey)

        // Should return default
        #expect(TerminalRenderer.selected == .swiftTerm)
    }

    @Test("Codable encoding and decoding")
    func codableSupport() throws {
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        // Test SwiftTerm
        let swiftTermData = try encoder.encode(TerminalRenderer.swiftTerm)
        let decodedSwiftTerm = try decoder.decode(TerminalRenderer.self, from: swiftTermData)
        #expect(decodedSwiftTerm == .swiftTerm)

        // Test xterm
        let xtermData = try encoder.encode(TerminalRenderer.xterm)
        let decodedXterm = try decoder.decode(TerminalRenderer.self, from: xtermData)
        #expect(decodedXterm == .xterm)
    }

    @Test("CaseIterable provides all cases")
    func caseIterableSupport() {
        let allCases = TerminalRenderer.allCases
        #expect(allCases.count == 2)
        #expect(allCases.contains(.swiftTerm))
        #expect(allCases.contains(.xterm))
    }

    @Test("Round trip through UserDefaults")
    func roundTripUserDefaults() {
        // Store original value to restore after test
        let originalRenderer = TerminalRenderer.selected
        defer {
            // Restore original value
            TerminalRenderer.selected = originalRenderer
        }
        
        // Test each renderer
        for renderer in TerminalRenderer.allCases {
            // Clear UserDefaults
            UserDefaults.standard.removeObject(forKey: userDefaultsKey)

            // Set the renderer
            TerminalRenderer.selected = renderer

            // Force UserDefaults synchronization
            UserDefaults.standard.synchronize()

            // Read back
            let retrieved = TerminalRenderer.selected
            #expect(retrieved == renderer)
        }
    }
}
