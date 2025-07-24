import Darwin
import Foundation
import OSLog

/// Utility to detect and terminate other VibeTunnel instances
@MainActor
enum ProcessKiller {
    private static let logger = Logger(subsystem: BundleIdentifiers.loggerSubsystem, category: "ProcessKiller")

    /// Kill all other VibeTunnel instances except the current one
    static func killOtherInstances() {
        let currentPID = ProcessInfo.processInfo.processIdentifier
        logger.info("🔍 Current process PID: \(currentPID)")

        // Find all VibeTunnel processes
        let vibeTunnelProcesses = findVibeTunnelProcesses()

        // Kill other instances
        var killedCount = 0
        for process in vibeTunnelProcesses where process.pid != currentPID {
            logger.info("🎯 Found other VibeTunnel instance: PID \(process.pid) at \(process.path)")

            // Skip if this appears to be a debug session (has NSDocumentRevisionsDebugMode argument)
            // This indicates it's being debugged by Xcode
            if isDebugProcess(pid: process.pid) {
                logger.info("⏭️ Skipping debug instance PID \(process.pid)")
                continue
            }

            if killProcess(pid: process.pid) {
                killedCount += 1
                logger.info("✅ Successfully killed PID \(process.pid)")
            } else {
                logger.warning("⚠️ Failed to kill PID \(process.pid)")
            }
        }

        if killedCount > 0 {
            logger.info("🧹 Killed \(killedCount) other VibeTunnel instance(s)")

            // Give processes time to fully terminate
            Thread.sleep(forTimeInterval: 0.5)
        } else {
            logger.info("✨ No other VibeTunnel instances found")
        }
    }

    /// Find all running VibeTunnel processes
    private static func findVibeTunnelProcesses() -> [(pid: Int32, path: String)] {
        var processes: [(pid: Int32, path: String)] = []

        // Get all processes
        let allProcesses = getAllProcesses()
        logger.debug("🔍 Found \(allProcesses.count) total processes")

        for process in allProcesses where process.path.contains("VibeTunnel.app/Contents/MacOS/VibeTunnel") {
            logger.debug("🎯 Found VibeTunnel process: PID \(process.pid) at \(process.path)")
            processes.append(process)
        }

        logger.info("📊 Found \(processes.count) VibeTunnel app processes")
        return processes
    }

    /// Get all running processes with their paths
    private static func getAllProcesses() -> [(pid: Int32, path: String)] {
        var processes: [(pid: Int32, path: String)] = []

        logger.debug("🔎 Getting process list...")

        // Set up the mib (Management Information Base) for getting all processes
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0]

        // Get process list size
        var size: size_t = 0
        if sysctl(&mib, 4, nil, &size, nil, 0) != 0 {
            logger.error("❌ Failed to get process list size, errno: \(errno)")
            return processes
        }

        // Allocate memory for process list
        let count = size / MemoryLayout<kinfo_proc>.size
        var procList = [kinfo_proc](repeating: kinfo_proc(), count: count)
        size = procList.count * MemoryLayout<kinfo_proc>.size

        // Get process list - reuse the same mib
        if sysctl(&mib, 4, &procList, &size, nil, 0) != 0 {
            logger.error("❌ Failed to get process list, errno: \(errno)")
            return processes
        }

        // Extract process information
        let actualCount = size / MemoryLayout<kinfo_proc>.size
        for i in 0..<actualCount {
            let proc = procList[i]
            let pid = proc.kp_proc.p_pid

            // Get process path
            var pathBuffer = [CChar](repeating: 0, count: Int(MAXPATHLEN))
            let pathSize = UInt32(MAXPATHLEN)

            if proc_pidpath(pid, &pathBuffer, pathSize) > 0 {
                // Convert CChar array to String safely
                pathBuffer.withUnsafeBufferPointer { buffer in
                    if let baseAddress = buffer.baseAddress,
                       let path = String(validatingCString: baseAddress)
                    {
                        processes.append((pid: pid, path: path))
                    }
                }
            }
        }

        return processes
    }

    /// Check if a process appears to be running under Xcode debugger
    private static func isDebugProcess(pid: Int32) -> Bool {
        // Get process arguments using sysctl
        var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
        var argmax: Int = 0
        var size = MemoryLayout<Int>.size

        // Get the maximum argument size
        if sysctl(&mib, 3, &argmax, &size, nil, 0) == -1 {
            return false
        }

        // Allocate memory for arguments
        var procargs = [CChar](repeating: 0, count: argmax)
        size = argmax

        // Get the arguments
        if sysctl(&mib, 3, &procargs, &size, nil, 0) == -1 {
            return false
        }

        // Convert to string and check for debug indicators
        let argsString = procargs.withUnsafeBufferPointer { buffer in
            if let baseAddress = buffer.baseAddress {
                return String(validatingCString: baseAddress) ?? ""
            }
            return ""
        }

        // Check for common Xcode debug arguments
        return argsString.contains("-NSDocumentRevisionsDebugMode") ||
            argsString.contains("__XCODE_BUILT_PRODUCTS_DIR_PATHS") ||
            argsString.contains("__XPC_DYLD_FRAMEWORK_PATH")
    }

    /// Kill a process by PID
    private static func killProcess(pid: Int32) -> Bool {
        // First check if we can signal the process
        if kill(pid, 0) != 0 {
            // Process doesn't exist or we don't have permission
            if errno == ESRCH {
                // Process doesn't exist, consider it a success
                logger.debug("Process \(pid) doesn't exist")
                return true
            } else if errno == EPERM {
                logger.error("No permission to kill process \(pid)")
                return false
            }
        }

        // For suspended processes or stubborn ones, try SIGKILL first
        // This is more aggressive but ensures we clean up properly
        if kill(pid, SIGKILL) == 0 {
            logger.info("Forcefully killed process \(pid) with SIGKILL")
            // Give it a moment to be reaped
            Thread.sleep(forTimeInterval: 0.1)
            return true
        }

        // If SIGKILL failed, check why
        if errno == ESRCH {
            // Process died between our check and kill attempt
            return true
        }

        logger.error("Failed to kill process \(pid), errno: \(errno)")
        return false
    }
}
