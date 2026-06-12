import Foundation
import Testing
@testable import VibeTunnel

@Suite("GhosttyWebView Tests")
struct GhosttyWebViewTests {
    @Test("Prefers Ghostty resources in their source subdirectory")
    func nestedResourcePreferred() {
        let nestedURL = URL(fileURLWithPath: "/tmp/ghostty/ghostty-web.js")
        let rootURL = URL(fileURLWithPath: "/tmp/ghostty-web.js")
        var requestedSubdirectories: [String?] = []

        let result = GhosttyResourceLocator.scriptURL { subdirectory in
            requestedSubdirectories.append(subdirectory)
            return subdirectory == "ghostty" ? nestedURL : rootURL
        }

        #expect(result == nestedURL)
        #expect(requestedSubdirectories == ["ghostty"])
    }

    @Test("Falls back to flattened iOS bundle resources")
    func rootResourceFallback() {
        let rootURL = URL(fileURLWithPath: "/tmp/ghostty-web.js")
        var requestedSubdirectories: [String?] = []

        let result = GhosttyResourceLocator.scriptURL { subdirectory in
            requestedSubdirectories.append(subdirectory)
            return subdirectory == nil ? rootURL : nil
        }

        #expect(result == rootURL)
        #expect(requestedSubdirectories == ["ghostty", nil])
    }

    @Test("Preserves output received before terminal readiness")
    func buffersOutputUntilReady() {
        var buffer = TerminalWriteBuffer()

        #expect(buffer.receive("first") == nil)
        #expect(buffer.receive("-second") == nil)
        #expect(buffer.markReady() == "first-second")
        #expect(buffer.receive("-third") == "-third")
        #expect(buffer.markReady() == nil)
    }

    @Test("Drops stale pending output before reconnect replay")
    func discardsPendingOutputForReplay() {
        var buffer = TerminalWriteBuffer()

        #expect(buffer.receive("stale") == nil)
        buffer.discardPending()
        #expect(buffer.receive("replayed") == nil)
        #expect(buffer.markReady() == "replayed")
    }
}
