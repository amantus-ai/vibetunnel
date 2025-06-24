import Testing
import Foundation
import AppKit
@testable import VibeTunnelFrontend

@Suite("ANSI Parser Tests")
struct ANSIParserTests {
    let font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
    
    @Test("Parse plain text")
    func testPlainText() {
        let input = "Hello, World!"
        let result = ANSIParser.parse(input, baseFont: font)
        
        #expect(result.string == "Hello, World!")
    }
    
    @Test("Parse basic colors")
    func testBasicColors() {
        let input = "\u{1B}[31mRed text\u{1B}[0m Normal text"
        let result = ANSIParser.parse(input, baseFont: font)
        
        #expect(result.string == "Red text Normal text")
        
        // Check that red color was applied
        var effectiveRange = NSRange()
        let color = result.attribute(.foregroundColor, at: 0, effectiveRange: &effectiveRange) as? NSColor
        #expect(color == NSColor(Theme.Colors.ansiRed))
        #expect(effectiveRange.location == 0)
        #expect(effectiveRange.length == 8) // "Red text"
    }
    
    @Test("Parse background colors")
    func testBackgroundColors() {
        let input = "\u{1B}[42mGreen background\u{1B}[0m"
        let result = ANSIParser.parse(input, baseFont: font)
        
        #expect(result.string == "Green background")
        
        // Check background color
        var effectiveRange = NSRange()
        let color = result.attribute(.backgroundColor, at: 0, effectiveRange: &effectiveRange) as? NSColor
        #expect(color == NSColor(Theme.Colors.ansiGreen))
    }
    
    @Test("Parse bold text")
    func testBoldText() {
        let input = "\u{1B}[1mBold text\u{1B}[0m"
        let result = ANSIParser.parse(input, baseFont: font)
        
        #expect(result.string == "Bold text")
        
        // Check font weight
        var effectiveRange = NSRange()
        if let appliedFont = result.attribute(.font, at: 0, effectiveRange: &effectiveRange) as? NSFont {
            #expect(appliedFont.fontDescriptor.symbolicTraits.contains(.bold))
        }
    }
    
    @Test("Parse multiple attributes")
    func testMultipleAttributes() {
        let input = "\u{1B}[1;31;42mBold red on green\u{1B}[0m"
        let result = ANSIParser.parse(input, baseFont: font)
        
        #expect(result.string == "Bold red on green")
        
        // Check all attributes are applied
        var effectiveRange = NSRange()
        let fgColor = result.attribute(.foregroundColor, at: 0, effectiveRange: &effectiveRange) as? NSColor
        let bgColor = result.attribute(.backgroundColor, at: 0, effectiveRange: &effectiveRange) as? NSColor
        let font = result.attribute(.font, at: 0, effectiveRange: &effectiveRange) as? NSFont
        
        #expect(fgColor == NSColor(Theme.Colors.ansiRed))
        #expect(bgColor == NSColor(Theme.Colors.ansiGreen))
        #expect(font?.fontDescriptor.symbolicTraits.contains(.bold) == true)
    }
    
    @Test("Handle malformed sequences")
    func testMalformedSequences() {
        let input = "\u{1B}[999mText\u{1B}[0m" // Invalid color code
        let result = ANSIParser.parse(input, baseFont: font)
        
        // Should still parse the text without crashing
        #expect(result.string == "Text")
    }
}