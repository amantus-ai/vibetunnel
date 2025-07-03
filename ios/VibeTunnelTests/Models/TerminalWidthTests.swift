import Foundation
import Testing
@testable import VibeTunnel

@Suite("TerminalWidth Tests", .tags(.models))
struct TerminalWidthTests {

    @Test("All predefined widths have correct values")
    func predefinedWidthValues() {
        #expect(TerminalWidth.unlimited.value == 0)
        #expect(TerminalWidth.classic80.value == 80)
        #expect(TerminalWidth.modern100.value == 100)
        #expect(TerminalWidth.wide120.value == 120)
        #expect(TerminalWidth.mainframe132.value == 132)
        #expect(TerminalWidth.ultraWide160.value == 160)
    }

    @Test("Custom width has correct value")
    func customWidthValue() {
        let customWidth = TerminalWidth.custom(95)
        #expect(customWidth.value == 95)
    }

    @Test("Width labels are correct")
    func widthLabels() {
        #expect(TerminalWidth.unlimited.label == "∞")
        #expect(TerminalWidth.classic80.label == "80")
        #expect(TerminalWidth.modern100.label == "100")
        #expect(TerminalWidth.wide120.label == "120")
        #expect(TerminalWidth.mainframe132.label == "132")
        #expect(TerminalWidth.ultraWide160.label == "160")
        #expect(TerminalWidth.custom(95).label == "95")
    }

    @Test("Width descriptions are correct")
    func widthDescriptions() {
        #expect(TerminalWidth.unlimited.description == "Unlimited")
        #expect(TerminalWidth.classic80.description == "Classic terminal")
        #expect(TerminalWidth.modern100.description == "Modern standard")
        #expect(TerminalWidth.wide120.description == "Wide terminal")
        #expect(TerminalWidth.mainframe132.description == "Mainframe width")
        #expect(TerminalWidth.ultraWide160.description == "Ultra-wide")
        #expect(TerminalWidth.custom(95).description == "Custom width")
    }

    @Test("All cases contains expected widths")
    func allCasesContainsExpectedWidths() {
        let allCases = TerminalWidth.allCases
        #expect(allCases.count == 6)
        #expect(allCases.contains(.unlimited))
        #expect(allCases.contains(.classic80))
        #expect(allCases.contains(.modern100))
        #expect(allCases.contains(.wide120))
        #expect(allCases.contains(.mainframe132))
        #expect(allCases.contains(.ultraWide160))
    }

    @Test("From value creates correct width")
    func fromValueCreatesCorrectWidth() {
        #expect(TerminalWidth.from(value: 0) == .unlimited)
        #expect(TerminalWidth.from(value: 80) == .classic80)
        #expect(TerminalWidth.from(value: 100) == .modern100)
        #expect(TerminalWidth.from(value: 120) == .wide120)
        #expect(TerminalWidth.from(value: 132) == .mainframe132)
        #expect(TerminalWidth.from(value: 160) == .ultraWide160)
        
        // Custom values
        #expect(TerminalWidth.from(value: 95) == .custom(95))
        #expect(TerminalWidth.from(value: 200) == .custom(200))
    }

    @Test("Preset identification")
    func presetIdentification() {
        #expect(TerminalWidth.unlimited.isPreset == true)
        #expect(TerminalWidth.classic80.isPreset == true)
        #expect(TerminalWidth.modern100.isPreset == true)
        #expect(TerminalWidth.wide120.isPreset == true)
        #expect(TerminalWidth.mainframe132.isPreset == true)
        #expect(TerminalWidth.ultraWide160.isPreset == true)
        #expect(TerminalWidth.custom(95).isPreset == false)
    }

    @Test("Width equality")
    func widthEquality() {
        #expect(TerminalWidth.classic80 == TerminalWidth.classic80)
        #expect(TerminalWidth.classic80 != TerminalWidth.modern100)
        #expect(TerminalWidth.custom(95) == TerminalWidth.custom(95))
        #expect(TerminalWidth.custom(95) != TerminalWidth.custom(100))
    }

    @Test("Width manager default width")
    @MainActor
    func widthManagerDefaultWidth() {
        let manager = TerminalWidthManager.shared
        
        // Store original value
        let originalDefault = manager.defaultWidth
        defer {
            // Restore original value
            manager.defaultWidth = originalDefault
        }
        
        // Set and get default width
        manager.defaultWidth = 100
        #expect(manager.defaultWidth == 100)
        
        manager.defaultWidth = 120
        #expect(manager.defaultWidth == 120)
    }

    @Test("Width manager custom widths")
    @MainActor
    func widthManagerCustomWidths() {
        let manager = TerminalWidthManager.shared
        
        // Store original custom widths
        let originalCustom = manager.customWidths
        defer {
            // Restore original custom widths
            manager.customWidths = originalCustom
        }
        
        // Clear custom widths
        manager.customWidths = []
        #expect(manager.customWidths.isEmpty)
        
        // Add custom widths
        manager.addCustomWidth(95)
        manager.addCustomWidth(110)
        #expect(manager.customWidths.count == 2)
        #expect(manager.customWidths.contains(95))
        #expect(manager.customWidths.contains(110))
        
        // Adding duplicate should not increase count
        manager.addCustomWidth(95)
        #expect(manager.customWidths.count == 2)
        
        // Adding invalid widths should be ignored
        manager.addCustomWidth(10) // Too small
        manager.addCustomWidth(600) // Too large
        #expect(manager.customWidths.count == 2)
    }

    @Test("Width manager custom width limits")
    @MainActor
    func widthManagerCustomWidthLimits() {
        let manager = TerminalWidthManager.shared
        
        // Store original custom widths
        let originalCustom = manager.customWidths
        defer {
            // Restore original custom widths
            manager.customWidths = originalCustom
        }
        
        // Clear and add many custom widths
        manager.customWidths = []
        for i in 1...10 {
            manager.addCustomWidth(90 + i)
        }
        
        // Should only keep last 5
        #expect(manager.customWidths.count == 5)
        #expect(manager.customWidths.contains(96))  // 90 + 6
        #expect(manager.customWidths.contains(100)) // 90 + 10
        #expect(!manager.customWidths.contains(91)) // 90 + 1 (should be removed)
    }

    @Test("Width manager all widths includes custom")
    @MainActor
    func widthManagerAllWidthsIncludesCustom() {
        let manager = TerminalWidthManager.shared
        
        // Store original custom widths
        let originalCustom = manager.customWidths
        defer {
            // Restore original custom widths
            manager.customWidths = originalCustom
        }
        
        // Clear and add custom width
        manager.customWidths = []
        manager.addCustomWidth(95)
        
        let allWidths = manager.allWidths()
        
        // Should include all presets plus custom
        #expect(allWidths.count >= 7) // 6 presets + 1 custom
        #expect(allWidths.contains(.unlimited))
        #expect(allWidths.contains(.classic80))
        #expect(allWidths.contains(.custom(95)))
    }

    @Test("Width manager ignores duplicate preset values in custom")
    @MainActor
    func widthManagerIgnoresDuplicatePresets() {
        let manager = TerminalWidthManager.shared
        
        // Store original custom widths
        let originalCustom = manager.customWidths
        defer {
            // Restore original custom widths
            manager.customWidths = originalCustom
        }
        
        // Add a preset value as custom
        manager.customWidths = [80, 95] // 80 is already a preset
        
        let allWidths = manager.allWidths()
        
        // Should not have duplicate 80 width
        let width80Count = allWidths.filter { $0.value == 80 }.count
        #expect(width80Count == 1)
        
        // Should still have the custom 95
        #expect(allWidths.contains(.custom(95)))
    }

    @Test("Width manager validates input ranges")
    @MainActor
    func widthManagerValidatesRanges() {
        let manager = TerminalWidthManager.shared
        
        // Store original custom widths
        let originalCustom = manager.customWidths
        defer {
            // Restore original custom widths
            manager.customWidths = originalCustom
        }
        
        // Clear custom widths
        manager.customWidths = []
        
        // Test edge case values
        manager.addCustomWidth(19) // Below minimum
        manager.addCustomWidth(20) // At minimum
        manager.addCustomWidth(500) // At maximum
        manager.addCustomWidth(501) // Above maximum
        
        // Should only accept valid ranges
        #expect(manager.customWidths.contains(20))
        #expect(manager.customWidths.contains(500))
        #expect(!manager.customWidths.contains(19))
        #expect(!manager.customWidths.contains(501))
    }
}