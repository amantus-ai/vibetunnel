import Darwin
import Foundation
import OSLog

/// Handles process tree traversal and process information extraction.
@MainActor
final class ProcessTracker {
    private let logger = Logger(
        subsystem: "sh.vibetunnel.vibetunnel",
        category: "ProcessTracker"
    )

    /// Get the parent process ID of a given process
    func getParentProcessID(of pid: pid_t) -> pid_t? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.size
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]

        let result = sysctl(&mib, u_int(mib.count), &info, &size, nil, 0)

        if result == 0 && size > 0 {
            return info.kp_eproc.e_ppid
        }

        return nil
    }

    /// Get process info including name
    func getProcessInfo(for pid: pid_t) -> (name: String, ppid: pid_t)? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.size
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]

        let result = sysctl(&mib, u_int(mib.count), &info, &size, nil, 0)

        if result == 0 && size > 0 {
            let name = withUnsafeBytes(of: &info.kp_proc.p_comm) { bytes in
                let commBytes = bytes.bindMemory(to: CChar.self)
                guard let baseAddress = commBytes.baseAddress else {
                    return ""
                }
                return String(cString: baseAddress)
            }
            return (name: name, ppid: info.kp_eproc.e_ppid)
        }

        return nil
    }

    /// Log the process tree for debugging
    func logProcessTree(for pid: pid_t) {
        logger.debug("Process tree for PID \(pid):")

        var currentPID = pid
        var depth = 0

        while depth < 20 {
            if let info = getProcessInfo(for: currentPID) {
                let indent = String(repeating: "  ", count: depth)
                logger.debug("\(indent)PID \(currentPID): \(info.name)")

                if info.ppid == 0 || info.ppid == 1 {
                    break
                }

                currentPID = info.ppid
                depth += 1
            } else {
                break
            }
        }
    }

    /// Find the terminal process in the ancestry of a given PID
    func findTerminalAncestor(for pid: pid_t, maxDepth: Int = 10) -> pid_t? {
        var currentPID = pid
        var depth = 0

        while depth < maxDepth {
            if let parentPID = getParentProcessID(of: currentPID) {
                logger.debug("Checking ancestor process PID: \(parentPID) at depth \(depth + 1)")

                // Check if this is a terminal process by examining windows
                // This will be coordinated with WindowEnumerator
                currentPID = parentPID
                depth += 1
            } else {
                break
            }
        }

        return nil
    }
}
