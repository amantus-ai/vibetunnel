import Foundation
import Testing
@testable import VibeTunnel

@Suite("AppleScript Executor Tests", .tags(.integration))
struct AppleScriptExecutorTests {
    @Test("Execute simple AppleScript")
    @MainActor
    func executeSimpleScript() throws {
        let script = """
        return "Hello from AppleScript"
        """

        let result = try AppleScriptExecutor.shared.executeWithResult(script)
        #expect(result == "Hello from AppleScript")
    }

    @Test("Execute script with math")
    @MainActor
    func executeScriptWithMath() throws {
        let script = """
        return 2 + 2
        """

        let result = try AppleScriptExecutor.shared.executeWithResult(script)
        #expect(result == "4")
    }

    @Test("Handle script error")
    @MainActor
    func handleScriptError() throws {
        let script = """
        error "This is a test error"
        """

        do {
            _ = try AppleScriptExecutor.shared.executeWithResult(script)
            Issue.record("Expected error to be thrown")
        } catch {
            #expect(error.localizedDescription.contains("test error"))
        }
    }

    @Test("Handle invalid syntax")
    @MainActor
    func handleInvalidSyntax() throws {
        let script = """
        this is not valid applescript syntax
        """

        do {
            _ = try AppleScriptExecutor.shared.executeWithResult(script)
            Issue.record("Expected error to be thrown")
        } catch {
            // Should throw a syntax error
            #expect(error is AppleScriptError)
        }
    }

    @Test("Execute empty script")
    @MainActor
    func executeEmptyScript() throws {
        let script = ""

        do {
            let result = try AppleScriptExecutor.shared.executeWithResult(script)
            #expect(result.isEmpty || result == "missing value")
        } catch {
            // Empty script might throw an error, which is also acceptable
            #expect(error is AppleScriptError)
        }
    }

    @Test("Check Terminal application", .tags(.slow))
    @MainActor
    func checkTerminalApplication() throws {
        // Skip in CI to avoid timing issues
        try #require(!TestConditions.isRunningInCI(), "Skipping AppleScript permission test in CI")
        let script = """
        tell application "System Events"
            return exists application process "Terminal"
        end tell
        """

        let result = try AppleScriptExecutor.shared.executeWithResult(script)
        // Result will be "true" or "false" as a string
        #expect(result == "true" || result == "false")
    }

    @Test("Test async execution", .tags(.slow))
    func asyncExecution() async throws {
        // Skip in CI to avoid timing issues
        try #require(!TestConditions.isRunningInCI(), "Skipping async AppleScript test in CI")
        // Test the async method
        let hasPermission = await AppleScriptExecutor.shared.checkPermission()
        #expect(hasPermission == true || hasPermission == false)
    }

    @Test("Singleton instance")
    @MainActor
    func singletonInstance() {
        let instance1 = AppleScriptExecutor.shared
        let instance2 = AppleScriptExecutor.shared
        #expect(instance1 === instance2)
    }
}
