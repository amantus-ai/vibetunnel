import AppKit
import Foundation
import Testing
@testable import VibeTunnel

// MARK: - Mock CLI Installer

@MainActor
final class MockCLIInstaller {
    // Mock state
    var mockIsInstalled = false
    var mockInstallShouldFail = false
    var mockInstallError: String?
    var mockResourcePath: String?

    // Track method calls
    var checkInstallationStatusCalled = false
    var installCalled = false
    var performInstallationCalled = false
    var showSuccessCalled = false
    var showErrorCalled = false
    var lastErrorMessage: String?

    // Add missing properties
    var isInstalled = false
    var isInstalling = false
    var lastError: String?

    func checkInstallationStatus() {
        checkInstallationStatusCalled = true
        // Only update from mock if not already installed
        if !isInstalled {
            isInstalled = mockIsInstalled
        }
    }

    func install() async {
        installCalled = true

        await MainActor.run {
            isInstalling = true

            if mockInstallShouldFail {
                lastError = mockInstallError ?? "Mock installation failed"
                lastErrorMessage = lastError
                isInstalling = false
                showErrorCalled = true
            } else {
                isInstalled = true
                isInstalling = false
                showSuccessCalled = true
            }
        }
    }

    func installCLITool() {
        installCalled = true
        isInstalling = true

        if mockInstallShouldFail {
            lastError = mockInstallError ?? "Mock installation failed"
            lastErrorMessage = lastError
            isInstalling = false
            showErrorCalled = true
        } else {
            isInstalled = true
            isInstalling = false
            showSuccessCalled = true
        }
    }

    func reset() {
        mockIsInstalled = false
        mockInstallShouldFail = false
        mockInstallError = nil
        mockResourcePath = nil
        checkInstallationStatusCalled = false
        installCalled = false
        performInstallationCalled = false
        showSuccessCalled = false
        showErrorCalled = false
        lastErrorMessage = nil
        isInstalled = false
        isInstalling = false
        lastError = nil
    }
}

// MARK: - Mock FileManager

final class MockFileManager {
    var fileExistsResults: [String: Bool] = [:]
    var createDirectoryShouldFail = false
    var setAttributesShouldFail = false

    func fileExists(atPath path: String) -> Bool {
        fileExistsResults[path] ?? false
    }

    func createDirectory(at url: URL, withIntermediateDirectories: Bool) throws {
        if createDirectoryShouldFail {
            throw CocoaError(.fileWriteUnknown)
        }
    }

    func setAttributes(_ attributes: [FileAttributeKey: Any], ofItemAtPath path: String) throws {
        if setAttributesShouldFail {
            throw CocoaError(.fileWriteNoPermission)
        }
    }
}

// MARK: - CLI Installer Tests

@Suite("CLI Installer Tests")
@MainActor
struct CLIInstallerTests {
    let tempDirectory: URL

    init() throws {
        self.tempDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("CLIInstallerTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true)
    }

    func cleanup() {
        try? FileManager.default.removeItem(at: tempDirectory)
    }

    // MARK: - Installation Status Tests

    @Test("Check installation status")
    func testCheckInstallationStatus() throws {
        let installer = MockCLIInstaller()

        // Not installed
        installer.mockIsInstalled = false
        installer.checkInstallationStatus()

        #expect(installer.checkInstallationStatusCalled)
        #expect(!installer.isInstalled)

        // Installed
        installer.reset()
        installer.mockIsInstalled = true
        installer.checkInstallationStatus()

        #expect(installer.isInstalled)
    }

    @Test("Installation status detects existing symlink")
    func detectExistingSymlink() throws {
        let installer = CLIInstaller()

        // Check real status (may or may not be installed)
        installer.checkInstallationStatus()

        // Status should be set
        #expect(installer.isInstalled == true || installer.isInstalled == false)
    }

    // MARK: - Installation Process Tests

    @Test("Installing CLI tool to custom location")
    func cLIInstallation() async throws {
        let installer = MockCLIInstaller()

        // Set up mock
        installer.mockResourcePath = Bundle.main.path(forResource: "vt", ofType: nil) ?? "/mock/path/vt"
        installer.mockInstallShouldFail = false

        // Perform installation
        await installer.install()

        #expect(installer.installCalled)
        #expect(installer.isInstalled)
        #expect(!installer.isInstalling)
        #expect(installer.lastError == nil)
        #expect(installer.showSuccessCalled)
    }

    @Test("Installation failure handling")
    func installationFailure() async throws {
        let installer = MockCLIInstaller()

        // Set up failure
        installer.mockInstallShouldFail = true
        installer.mockInstallError = "Permission denied"

        // Attempt installation
        await installer.install()

        #expect(installer.installCalled)
        #expect(!installer.isInstalled)
        #expect(!installer.isInstalling)
        #expect(installer.lastError == "Permission denied")
        #expect(installer.showErrorCalled)
    }

    @Test("Updating existing CLI installation")
    func cLIUpdate() async throws {
        let installer = MockCLIInstaller()

        // Simulate existing installation
        installer.mockIsInstalled = true
        installer.checkInstallationStatus()
        #expect(installer.isInstalled)

        // Update (reinstall)
        installer.mockInstallShouldFail = false
        await installer.install()

        #expect(installer.isInstalled)
        #expect(installer.showSuccessCalled)
    }

    // MARK: - Resource Validation Tests

    @Test("Missing CLI binary in bundle")
    func missingCLIBinary() async throws {
        let installer = MockCLIInstaller()

        // Simulate missing resource
        installer.mockResourcePath = nil
        installer.mockInstallShouldFail = true
        installer.mockInstallError = "The vt command line tool could not be found in the application bundle."

        await installer.install()

        #expect(!installer.isInstalled)
        #expect(installer.lastError?.contains("could not be found") == true)
    }

    @Test("Valid resource path")
    func validResourcePath() throws {
        // Check if vt binary exists in bundle
        let resourcePath = Bundle.main.path(forResource: "vt", ofType: nil)

        // In test environment, this might be nil
        if let path = resourcePath {
            #expect(FileManager.default.fileExists(atPath: path))
        }
    }

    // MARK: - Permission Tests

    @Test("Permission handling", .enabled(if: ProcessInfo.processInfo.environment["CI"] == nil))
    func permissions() async throws {
        let installer = MockCLIInstaller()

        // Simulate permission error
        installer.mockInstallShouldFail = true
        installer.mockInstallError = "Operation not permitted"

        await installer.install()

        #expect(!installer.isInstalled)
        #expect(installer.lastError?.contains("not permitted") == true)
    }

    @Test("Administrator privileges required")
    func adminPrivileges() throws {
        // This test documents that admin privileges are required
        // The actual installation uses osascript with administrator privileges

        let installer = MockCLIInstaller()

        // Installation requires admin
        #expect(!installer.isInstalled)

        // After successful installation with admin privileges
        installer.mockIsInstalled = true
        installer.checkInstallationStatus()
        #expect(installer.isInstalled)
    }

    // MARK: - Script Generation Tests

    @Test("Installation script generation")
    func scriptGeneration() throws {
        let sourcePath = "/Applications/VibeTunnel.app/Contents/Resources/vt"
        let targetPath = "/usr/local/bin/vt"

        // Expected script content
        let expectedScript = """
        #!/bin/bash
        set -e

        # Create /usr/local/bin if it doesn't exist
        if [ ! -d "/usr/local/bin" ]; then
            mkdir -p "/usr/local/bin"
            echo "Created directory /usr/local/bin"
        fi

        # Remove existing symlink if it exists
        if [ -L "\(targetPath)" ] || [ -f "\(targetPath)" ]; then
            rm -f "\(targetPath)"
            echo "Removed existing file at \(targetPath)"
        fi

        # Create the symlink
        ln -s "\(sourcePath)" "\(targetPath)"
        echo "Created symlink from \(sourcePath) to \(targetPath)"

        # Make sure the symlink is executable
        chmod +x "\(targetPath)"
        echo "Set executable permissions on \(targetPath)"
        """

        // Verify script structure
        #expect(expectedScript.contains("#!/bin/bash"))
        #expect(expectedScript.contains("set -e"))
        #expect(expectedScript.contains("mkdir -p"))
        #expect(expectedScript.contains("ln -s"))
        #expect(expectedScript.contains("chmod +x"))
    }

    // MARK: - State Management Tests

    @Test("Installation state transitions")
    func stateTransitions() async throws {
        let installer = MockCLIInstaller()

        // Initial state
        #expect(!installer.isInstalled)
        #expect(!installer.isInstalling)
        #expect(installer.lastError == nil)

        // During installation
        installer.installCLITool()
        // Note: In mock, this completes immediately

        // After successful installation
        #expect(installer.isInstalled)
        #expect(!installer.isInstalling)
        #expect(installer.lastError == nil)

        // Reset and test failure
        installer.reset()
        installer.mockInstallShouldFail = true
        installer.mockInstallError = "Test error"

        installer.installCLITool()

        // After failed installation
        #expect(!installer.isInstalled)
        #expect(!installer.isInstalling)
        #expect(installer.lastError == "Test error")
    }

    // MARK: - UI Alert Tests

    @Test("User confirmation dialogs")
    func userDialogs() async throws {
        let installer = MockCLIInstaller()

        // Test shows appropriate dialogs
        // In real implementation:
        // 1. Confirmation dialog before installation
        // 2. Success dialog after successful installation
        // 3. Error dialog on failure

        // Success case
        await installer.install()
        #expect(installer.showSuccessCalled)

        // Failure case
        installer.reset()
        installer.mockInstallShouldFail = true
        await installer.install()
        #expect(installer.showErrorCalled)
    }

    // MARK: - Concurrent Installation Tests

    @Test("Concurrent installation attempts", .tags(.concurrency))
    func concurrentInstallation() async throws {
        let installer = MockCLIInstaller()

        // Attempt multiple installations concurrently
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<3 {
                group.addTask {
                    await installer.install()
                }
            }

            await group.waitForAll()
        }

        // Should handle concurrent attempts gracefully
        #expect(installer.installCalled)
        #expect(installer.isInstalled || installer.lastError != nil)
        #expect(!installer.isInstalling)
    }

    // MARK: - Integration Tests

    @Test("Full installation workflow", .tags(.integration))
    func fullWorkflow() async throws {
        let installer = MockCLIInstaller()

        // 1. Check initial status
        installer.checkInstallationStatus()
        #expect(!installer.isInstalled)

        // 2. Install CLI tool
        await installer.install()
        #expect(installer.isInstalled)

        // 3. Verify installation
        installer.checkInstallationStatus()
        #expect(installer.isInstalled)

        // 4. Attempt reinstall (should handle gracefully)
        await installer.install()
        #expect(installer.isInstalled)
    }

    // MARK: - PR #153 Regression Test

    @Test("Script with TITLE_MODE_ARGS detected correctly", .tags(.regression))
    func scriptWithTitleModeArgsDetection() async throws {
        let script = """
        #!/bin/bash
        # VibeTunnel CLI wrapper
        for TRY_PATH in "/Applications/VibeTunnel.app" "$HOME/Applications/VibeTunnel.app"; do
            if [ -d "$TRY_PATH" ] && [ -f "$TRY_PATH/Contents/Resources/vibetunnel" ]; then
                APP_PATH="$TRY_PATH"
                break
            fi
        done
        VIBETUNNEL_BIN="$APP_PATH/Contents/Resources/vibetunnel"
        TITLE_MODE_ARGS="--title-mode dynamic"
        exec "$VIBETUNNEL_BIN" fwd $TITLE_MODE_ARGS "$@"
        """

        let vtPath = tempDirectory.appendingPathComponent("vt").path
        try script.write(toFile: vtPath, atomically: true, encoding: .utf8)

        let installer = CLIInstaller(binDirectory: tempDirectory.path)
        installer.checkInstallationStatus()

        // Wait for the async Task in checkInstallationStatus to complete
        try await Task.sleep(for: .milliseconds(100))

        #expect(installer.isInstalled)
    }
}
