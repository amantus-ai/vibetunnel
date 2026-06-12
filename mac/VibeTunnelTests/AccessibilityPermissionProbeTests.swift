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
}
