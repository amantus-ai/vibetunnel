import Foundation
import IOKit.pwr_mgt
import Observation

/// Manages system power assertions to prevent the Mac from sleeping while VibeTunnel is running.
///
/// This service uses IOKit's power management APIs to create power assertions that prevent
/// the system from entering idle sleep when terminal sessions are active. The service is
/// integrated with ServerManager to automatically manage sleep prevention based on server
/// state and user preferences.
@Observable
@MainActor
final class PowerManagementService {
    static let shared = PowerManagementService()

    private(set) var isSleepPrevented = false

    private var assertionID: IOPMAssertionID = 0
    private var isAssertionActive = false

    private init() {}

    /// Prevents the system from sleeping
    func preventSleep() {
        guard !isAssertionActive else { return }

        let reason = "VibeTunnel is running terminal sessions" as CFString
        let assertionType = kIOPMAssertionTypeNoIdleSleep as CFString

        let success = IOPMAssertionCreateWithName(
            assertionType,
            IOPMAssertionLevel(kIOPMAssertionLevelOn),
            reason,
            &assertionID
        )

        if success == kIOReturnSuccess {
            isAssertionActive = true
            isSleepPrevented = true
            print("Sleep prevention enabled")
        } else {
            print("Failed to prevent sleep: \(success)")
        }
    }

    /// Allows the system to sleep normally
    func allowSleep() {
        guard isAssertionActive else { return }

        let success = IOPMAssertionRelease(assertionID)

        if success == kIOReturnSuccess {
            isAssertionActive = false
            isSleepPrevented = false
            assertionID = 0
            print("Sleep prevention disabled")
        } else {
            print("Failed to release sleep assertion: \(success)")
        }
    }

    /// Updates sleep prevention based on user preference and server state
    func updateSleepPrevention(enabled: Bool, serverRunning: Bool) {
        if enabled && serverRunning {
            preventSleep()
        } else {
            allowSleep()
        }
    }

    deinit {
        // Deinit runs on arbitrary thread, but we need to check MainActor state
        // Since we can't access MainActor properties directly in deinit,
        // we handle cleanup in allowSleep() which is called when server stops
    }
}
