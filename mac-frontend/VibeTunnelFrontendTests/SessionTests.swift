import Testing
import Foundation
@testable import VibeTunnelFrontend

@Suite("Session Model Tests")
struct SessionTests {
    @Test("Display name uses custom name when available")
    func testDisplayNameWithCustomName() {
        let session = Session(
            id: "123",
            name: "My Session",
            command: "/bin/bash",
            cwd: "/home/user",
            createdAt: Date(),
            status: .running
        )
        
        #expect(session.displayName == "My Session")
    }
    
    @Test("Display name falls back to formatted date")
    func testDisplayNameWithoutCustomName() {
        let date = Date(timeIntervalSince1970: 1703300000) // Dec 23, 2023
        let session = Session(
            id: "123",
            name: nil,
            command: "/bin/bash",
            cwd: "/home/user",
            createdAt: date,
            status: .running
        )
        
        // The exact format depends on locale, but it should contain the date components
        let displayName = session.displayName
        #expect(displayName.contains("Dec") || displayName.contains("12"))
    }
    
    @Test("Running status check")
    func testIsRunning() {
        let runningSession = Session(
            id: "123",
            name: "Test",
            command: "/bin/bash",
            cwd: "/home/user",
            createdAt: Date(),
            status: .running
        )
        
        let exitedSession = Session(
            id: "456",
            name: "Test",
            command: "/bin/bash",
            cwd: "/home/user",
            createdAt: Date(),
            status: .exited,
            exitCode: 0
        )
        
        #expect(runningSession.isRunning == true)
        #expect(exitedSession.isRunning == false)
    }
    
    @Test("Session equality")
    func testEquality() {
        let session1 = Session(
            id: "123",
            name: "Test",
            command: "/bin/bash",
            cwd: "/home/user",
            createdAt: Date(),
            status: .running
        )
        
        let session2 = Session(
            id: "123",
            name: "Different Name",
            command: "/bin/zsh",
            cwd: "/home/other",
            createdAt: Date().addingTimeInterval(100),
            status: .exited
        )
        
        let session3 = Session(
            id: "456",
            name: "Test",
            command: "/bin/bash",
            cwd: "/home/user",
            createdAt: Date(),
            status: .running
        )
        
        // Sessions are equal based on all properties (Hashable)
        #expect(session1 != session2) // Different properties
        #expect(session1 != session3) // Different ID
    }
}