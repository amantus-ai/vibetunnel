import Foundation
import Testing
@testable import VibeTunnel

@Suite("TerminalWidth Tests", .tags(.models))
struct TerminalWidthTests {

    @Test("Default widths are correctly defined")
    func defaultWidths() {
        #expect(TerminalWidth.default80.columns == 80)
        #expect(TerminalWidth.default100.columns == 100)
        #expect(TerminalWidth.default120.columns == 120)
        #expect(TerminalWidth.default132.columns == 132)
    }

    @Test("Custom width initialization")
    func customWidthInit() {
        let custom = TerminalWidth.custom(95)

        switch custom {
        case .custom(let width):
            #expect(width == 95)
        default:
            Issue.record("Expected custom width")
        }
    }

    @Test("Width display names")
    func displayNames() {
        #expect(TerminalWidth.default80.displayName == "80 columns (default)")
        #expect(TerminalWidth.default100.displayName == "100 columns")
        #expect(TerminalWidth.default120.displayName == "120 columns")
        #expect(TerminalWidth.default132.displayName == "132 columns (wide)")
        #expect(TerminalWidth.custom(95).displayName == "95 columns")
    }

    @Test("All widths array contains expected values")
    func allWidthsArray() {
        let allWidths = TerminalWidth.allWidths

        #expect(allWidths.count == 4)
        #expect(allWidths[0].columns == 80)
        #expect(allWidths[1].columns == 100)
        #expect(allWidths[2].columns == 120)
        #expect(allWidths[3].columns == 132)
    }

    @Test("Width from columns lookup")
    func widthFromColumns() {
        #expect(TerminalWidth.from(columns: 80) == .default80)
        #expect(TerminalWidth.from(columns: 100) == .default100)
        #expect(TerminalWidth.from(columns: 120) == .default120)
        #expect(TerminalWidth.from(columns: 132) == .default132)

        // Custom widths
        let custom = TerminalWidth.from(columns: 95)
        switch custom {
        case .custom(let width):
            #expect(width == 95)
        default:
            Issue.record("Expected custom width for non-standard value")
        }
    }

    @Test("Width persistence key")
    func persistenceKey() {
        #expect(TerminalWidth.persistenceKey == "terminalWidth")
    }

    @Test("Saved width retrieval")
    func savedWidth() {
        // Clear any existing saved width
        UserDefaults.standard.removeObject(forKey: TerminalWidth.persistenceKey)

        // Should return default when nothing saved
        #expect(TerminalWidth.saved.columns == 80)

        // Save a custom width
        let customWidth = TerminalWidth.custom(110)
        customWidth.save()

        // Should retrieve the saved width
        #expect(TerminalWidth.saved.columns == 110)

        // Clean up
        UserDefaults.standard.removeObject(forKey: TerminalWidth.persistenceKey)
    }

    @Test("Width saving")
    func widthSaving() {
        // Clear any existing saved width
        UserDefaults.standard.removeObject(forKey: TerminalWidth.persistenceKey)

        // Save a standard width
        TerminalWidth.default100.save()
        #expect(UserDefaults.standard.integer(forKey: TerminalWidth.persistenceKey) == 100)

        // Save a custom width
        TerminalWidth.custom(95).save()
        #expect(UserDefaults.standard.integer(forKey: TerminalWidth.persistenceKey) == 95)

        // Clean up
        UserDefaults.standard.removeObject(forKey: TerminalWidth.persistenceKey)
    }

    @Test("Width equatable")
    func widthEquatable() {
        #expect(TerminalWidth.default80 == TerminalWidth.default80)
        #expect(TerminalWidth.custom(95) == TerminalWidth.custom(95))
        #expect(TerminalWidth.default80 != TerminalWidth.default100)
        #expect(TerminalWidth.custom(95) != TerminalWidth.custom(96))
    }

    @Test("Valid width range")
    func validWidthRange() {
        // Test minimum reasonable width
        let minWidth = TerminalWidth.custom(40)
        #expect(minWidth.columns == 40)

        // Test maximum reasonable width
        let maxWidth = TerminalWidth.custom(300)
        #expect(maxWidth.columns == 300)
    }
}
