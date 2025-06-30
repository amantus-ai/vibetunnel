import Foundation
import IOKit.pwr_mgt

@MainActor
class PowerManagementService: ObservableObject {
    static let shared = PowerManagementService()
    
    @Published private(set) var isSleepPrevented = false
    
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
        // Ensure we release the assertion when the service is deallocated
        if isAssertionActive {
            let success = IOPMAssertionRelease(assertionID)
            if success == kIOReturnSuccess {
                print("Sleep assertion released in deinit")
            }
        }
    }
}