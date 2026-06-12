import ApplicationServices
import Testing
@testable import VibeTunnel

@Suite("Accessibility Permission Probe Tests")
struct AccessibilityPermissionProbeTests {
    @Test
    func rejectsOwnProcessAccessWhenSystemTrustIsMissing() {
        #expect(!AccessibilityPermissionProbe.evaluate(
            apiTrusted: false,
            crossProcessResults: [.success]))
    }

    @Test
    func acceptsTrustedCrossProcessAccess() {
        #expect(AccessibilityPermissionProbe.evaluate(
            apiTrusted: true,
            crossProcessResults: [.success]))
    }

    @Test
    func rejectsStaleTrustWithoutCrossProcessAccess() {
        #expect(!AccessibilityPermissionProbe.evaluate(
            apiTrusted: true,
            crossProcessResults: [.apiDisabled, .cannotComplete]))
    }

    @Test
    func rejectsTrustWhenNoProbeTargetIsAvailable() {
        #expect(!AccessibilityPermissionProbe.evaluate(
            apiTrusted: true,
            crossProcessResults: []))
    }

    @Test
    func opensSettingsWhenPromptTrustIsStale() {
        #expect(AccessibilityPermissionProbe.shouldOpenSettings(
            promptReportedTrusted: true,
            probeGranted: false))
    }

    @Test
    func opensSettingsWhenPromptReportsNoTrust() {
        #expect(AccessibilityPermissionProbe.shouldOpenSettings(
            promptReportedTrusted: false,
            probeGranted: false))
    }

    @Test
    func doesNotOpenSettingsForWorkingPermission() {
        #expect(!AccessibilityPermissionProbe.shouldOpenSettings(
            promptReportedTrusted: true,
            probeGranted: true))
    }
}
