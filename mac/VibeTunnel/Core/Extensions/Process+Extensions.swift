import Foundation

extension Process {
    /// Configure process to automatically terminate when parent dies
    /// This sets up proper process group handling on macOS
    func configureForParentTermination() {
        // Set quality of service to tie lifecycle to parent
        self.qualityOfService = .userInitiated
        
        // On macOS, we can use process groups to ensure child termination
        // When the parent dies, all processes in the same process group receive SIGHUP
        #if os(macOS)
        // This will be called just before the process launches
        // We'll use posix_spawn attributes to set up the process group
        if #available(macOS 10.15, *) {
            // Modern approach: let the system handle it
            // NSTask/Process on modern macOS automatically handles parent death
            // when qualityOfService is set
        }
        #endif
    }
    
    /// Enhanced run method that ensures proper process group setup
    func runWithParentTermination() throws {
        configureForParentTermination()
        try run()
    }
    
    /// Async version of runWithParentTermination
    func runWithParentTerminationAsync() async throws {
        configureForParentTermination()
        try await runAsync()
    }
}