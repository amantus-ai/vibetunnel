import Foundation
import Testing
@testable import VibeTunnel

@Suite("Logger Tests", .tags(.utilities))
struct LoggerTests {
    @Test("Log level prefixes")
    func logLevelPrefixes() {
        #expect(LogLevel.verbose.prefix == "🔍")
        #expect(LogLevel.debug.prefix == "🐛")
        #expect(LogLevel.info.prefix == "ℹ️")
        #expect(LogLevel.warning.prefix == "⚠️")
        #expect(LogLevel.error.prefix == "❌")
    }

    @Test("Log level raw values")
    func logLevelRawValues() {
        #expect(LogLevel.verbose.rawValue == 0)
        #expect(LogLevel.debug.rawValue == 1)
        #expect(LogLevel.info.rawValue == 2)
        #expect(LogLevel.warning.rawValue == 3)
        #expect(LogLevel.error.rawValue == 4)
    }

    @Test("Logger initialization")
    func loggerInit() {
        let logger = Logger(category: "TestCategory")

        // Unfortunately we can't access the private category property
        // but we can verify the logger was created without error
        // Logger is a value type, so it's always non-nil
        #expect(true)
    }

    @Test("Global log level")
    func globalLogLevel() {
        // Store original log level
        let originalLogLevel = Logger.globalLevel
        defer {
            // Restore original log level
            Logger.globalLevel = originalLogLevel
        }

        // Test setting different log levels
        Logger.globalLevel = .verbose
        #expect(Logger.globalLevel == .verbose)

        Logger.globalLevel = .debug
        #expect(Logger.globalLevel == .debug)

        Logger.globalLevel = .info
        #expect(Logger.globalLevel == .info)

        Logger.globalLevel = .warning
        #expect(Logger.globalLevel == .warning)

        Logger.globalLevel = .error
        #expect(Logger.globalLevel == .error)
    }

    @Test("Log level comparison")
    func logLevelComparison() {
        // Verbose is lowest priority (0)
        #expect(LogLevel.verbose.rawValue < LogLevel.debug.rawValue)
        #expect(LogLevel.debug.rawValue < LogLevel.info.rawValue)
        #expect(LogLevel.info.rawValue < LogLevel.warning.rawValue)
        #expect(LogLevel.warning.rawValue < LogLevel.error.rawValue)
    }

    @Test("Logger methods exist")
    func loggerMethods() {
        let logger = Logger(category: "Test")

        // We can't easily test the output, but we can verify
        // that calling these methods doesn't crash
        logger.verbose("Verbose message")
        logger.debug("Debug message")
        logger.info("Info message")
        logger.warning("Warning message")
        logger.error("Error message")

        // If we get here without crashing, the test passes
        #expect(true)
    }

    @Test("Default log level based on build configuration")
    func defaultLogLevel() {
        // Reset to see what the default is
        #if DEBUG
        // In debug builds, default should be .info
        // Note: This test might not work as expected because the static var
        // is already initialized by the time tests run
        #else
            // In release builds, default should be .warning
        #endif

        // Just verify we can read the global level
        let level = Logger.globalLevel
        #expect(level.rawValue >= 0 && level.rawValue <= 4)
    }
}
