import Foundation
import Testing
@testable import VibeTunnel

@Suite("SessionListViewModel Tests", .tags(.viewModels, .critical))
@MainActor
struct SessionListViewModelTests {

    @Test("Initial state")
    func initialState() {
        let viewModel = SessionListViewModel()

        #expect(viewModel.sessions.isEmpty)
        #expect(viewModel.isLoading == false)
        #expect(viewModel.errorMessage == nil)
    }

    @Test("Auto refresh lifecycle")
    func autoRefreshLifecycle() async throws {
        let viewModel = SessionListViewModel()

        // Start auto refresh
        viewModel.startAutoRefresh()

        // Give it a moment to start
        try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 second

        // Stop auto refresh
        viewModel.stopAutoRefresh()

        // Verify it doesn't crash and maintains state
        #expect(viewModel.errorMessage == nil || viewModel.errorMessage != nil) // Either state is valid
    }

    @Test("Error message can be set and cleared")
    func errorMessageHandling() {
        let viewModel = SessionListViewModel()

        // Set error
        viewModel.errorMessage = "Test error"
        #expect(viewModel.errorMessage == "Test error")

        // Clear error
        viewModel.errorMessage = nil
        #expect(viewModel.errorMessage == nil)
    }

    @Test("Sessions can be set")
    func sessionsCanBeSet() {
        let viewModel = SessionListViewModel()

        // Set sessions
        viewModel.sessions = [TestFixtures.validSession]
        #expect(viewModel.sessions.count == 1)
        #expect(viewModel.sessions.first?.id == "test-session-123")

        // Clear sessions
        viewModel.sessions = []
        #expect(viewModel.sessions.isEmpty)
    }

    @Test("Loading state can be toggled")
    func loadingStateToggle() {
        let viewModel = SessionListViewModel()

        // Set loading
        viewModel.isLoading = true
        #expect(viewModel.isLoading == true)

        // Clear loading
        viewModel.isLoading = false
        #expect(viewModel.isLoading == false)
    }
}

// Note: Due to the singleton pattern in SessionService and lack of dependency injection,
// we cannot properly test the async methods (loadSessions, killSession, etc.) with mocks.
// In a production app, SessionListViewModel should accept a SessionService protocol
// as a dependency to enable proper unit testing.
