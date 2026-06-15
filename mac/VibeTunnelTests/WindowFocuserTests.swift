import CoreGraphics
import Foundation
import Testing
@testable import VibeTunnel

@Suite("Window Focuser Tests", .serialized)
@MainActor
struct WindowFocuserTests {
    @Test
    func ranksSpecificTabMatchesAboveDirectoryMatches() throws {
        let matcher = WindowMatcher()
        let sessionInfo = Self.makeSessionInfo(
            id: "ghostty-tab-focus-test",
            name: "VT273-A",
            workingDir: "/tmp/vibetunnel")

        let sessionIDScore = try #require(
            matcher.tabMatchScore(for: "ghostty-tab-focus-test", sessionInfo: sessionInfo))
        let sessionNameScore = try #require(matcher.tabMatchScore(for: "VT273-A", sessionInfo: sessionInfo))
        let workingDirScore = try #require(
            matcher.tabMatchScore(for: "/tmp/vibetunnel", sessionInfo: sessionInfo))
        let directoryScore = try #require(matcher.tabMatchScore(for: "vibetunnel", sessionInfo: sessionInfo))

        #expect(sessionIDScore > sessionNameScore)
        #expect(sessionNameScore > workingDirScore)
        #expect(workingDirScore > directoryScore)
        #expect(sessionIDScore > WindowMatchScore.windowID + WindowMatchScore.bounds)
        #expect(sessionNameScore < WindowMatchScore.windowID)
        #expect(directoryScore < WindowMatchScore.windowID)
        let exactSession = WindowMatchScore.combined(identity: 0, content: sessionIDScore)
        let staleWeakMatch = WindowMatchScore.combined(
            identity: WindowMatchScore.windowID + WindowMatchScore.bounds,
            content: sessionNameScore)
        let trackedDuplicate = WindowMatchScore.combined(
            identity: WindowMatchScore.windowID,
            content: sessionNameScore)
        let untrackedDuplicate = WindowMatchScore.combined(identity: 0, content: sessionNameScore)

        #expect(exactSession > staleWeakMatch)
        #expect(trackedDuplicate > untrackedDuplicate)
        #expect(matcher.tabMatchScore(for: "unrelated", sessionInfo: sessionInfo) == nil)
    }

    @Test(
        .disabled(
            if: ProcessInfo.processInfo.environment["VIBETUNNEL_GHOSTTY_TEST_PID"] == nil ||
                ProcessInfo.processInfo.environment["VIBETUNNEL_GHOSTTY_TEST_TAB"] == nil,
            "Set VIBETUNNEL_GHOSTTY_TEST_PID and VIBETUNNEL_GHOSTTY_TEST_TAB for a live Ghostty tab test"))
    func focusesMatchingGhosttyTab() async throws {
        let environment = ProcessInfo.processInfo.environment
        let pid = try #require(environment["VIBETUNNEL_GHOSTTY_TEST_PID"].flatMap(Int32.init))
        let targetTitle = try #require(environment["VIBETUNNEL_GHOSTTY_TEST_TAB"])
        let application = AXElement.application(pid: pid)
        let window = try #require(application.windows?.first)
        let initialTitle = window.title

        #expect(initialTitle != targetTitle)

        let windowInfo = WindowInfo(
            windowID: CGWindowID(window.windowID ?? 0),
            ownerPID: pid,
            terminalApp: .ghostty,
            sessionID: "ghostty-tab-focus-test",
            createdAt: Date(),
            tabReference: nil,
            tabID: nil,
            bounds: window.frame(),
            title: initialTitle)
        let sessionInfo = Self.makeSessionInfo(
            id: windowInfo.sessionID,
            name: targetTitle,
            workingDir: "/tmp")

        WindowFocuser().focusWindowUsingAccessibility(windowInfo, sessionInfo: sessionInfo)
        try await Task.sleep(for: .milliseconds(300))

        let focusedWindow = try #require(AXElement.application(pid: pid).windows?.first)
        #expect(focusedWindow.title == targetTitle)
    }

    private static func makeSessionInfo(
        id: String,
        name: String,
        workingDir: String)
        -> ServerSessionInfo
    {
        ServerSessionInfo(
            id: id,
            name: name,
            command: [],
            workingDir: workingDir,
            status: "running",
            exitCode: nil,
            startedAt: "",
            pid: nil,
            initialCols: nil,
            initialRows: nil,
            lastClearOffset: nil,
            version: nil,
            gitRepoPath: nil,
            gitBranch: nil,
            gitAheadCount: nil,
            gitBehindCount: nil,
            gitHasChanges: nil,
            gitIsWorktree: nil,
            gitMainRepoPath: nil,
            lastModified: "",
            active: nil,
            activityStatus: nil,
            source: nil,
            remoteId: nil,
            remoteName: nil,
            remoteUrl: nil,
            attachedViaVT: nil)
    }
}
