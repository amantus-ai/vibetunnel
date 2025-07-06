import Foundation

extension Process {
    /// Async version that starts the process and returns immediately
    func runAsync() async throws {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    try self.run()
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// Run process with parent termination handling
    /// (The actual parent monitoring is handled by the shell wrapper)
    func runWithParentTermination() throws {
        try run()
    }

    /// Async version of runWithParentTermination
    func runWithParentTerminationAsync() async throws {
        try await runAsync()
    }

    /// Wait for the process to exit asynchronously
    func waitUntilExitAsync() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                self.waitUntilExit()
                continuation.resume()
            }
        }
    }

    /// Terminate the process asynchronously
    func terminateAsync() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                if self.isRunning {
                    self.terminate()
                }
                continuation.resume()
            }
        }
    }

    /// Wait for exit with timeout
    func waitUntilExitWithTimeout(seconds: TimeInterval) async -> Bool {
        await withTaskGroup(of: Bool.self) { group in
            group.addTask {
                await self.waitUntilExitAsync()
                return true
            }

            group.addTask {
                try? await Task.sleep(for: .seconds(seconds))
                return false
            }

            for await result in group {
                group.cancelAll()
                return result
            }

            return false
        }
    }
}
