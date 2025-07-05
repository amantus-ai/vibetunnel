import Foundation
import Testing
@testable import VibeTunnel

/// Comprehensive tests for SessionListViewModel
///
/// Tests all functionality including:
/// - Session loading and management
/// - Search and filtering
/// - UI state management
/// - Network connectivity handling
/// - Error handling
/// - Session operations (kill, cleanup)
@MainActor
struct SessionListViewModelTests {
    // MARK: - Mock Dependencies - Use shared mocks from Mocks/

    /// Test-specific subclass to inject mock ConnectionManager
    class TestableSessionListViewModel: SessionListViewModel {
        private let mockConnectionManager: MockConnectionManager

        init(
            sessionService: SessionServiceProtocol,
            networkMonitor: NetworkMonitoring,
            connectionManager: MockConnectionManager
        ) {
            self.mockConnectionManager = connectionManager
            super.init(sessionService: sessionService, networkMonitor: networkMonitor)
        }

        override func disconnect() async {
            await mockConnectionManager.disconnect()
        }
    }

    // MARK: - Helper Methods

    func createMockSession(id: String, name: String? = nil, isRunning: Bool = true, pid: Int? = nil) -> Session {
        Session(
            id: id,
            command: ["bash"],
            workingDir: "/Users/test",
            name: name,
            status: isRunning ? .running : .exited,
            exitCode: isRunning ? nil : 0,
            startedAt: "2024-01-01T12:00:00Z",
            lastModified: "2024-01-01T12:00:00Z",
            pid: pid,
            width: 80,
            height: 24,
            waiting: false,
            source: nil,
            remoteId: nil,
            remoteName: nil,
            remoteUrl: nil
        )
    }

    func createViewModel(
        mockSessionService: MockSessionService = MockSessionService(),
        mockNetworkMonitor: MockNetworkMonitor = MockNetworkMonitor()
    )
        -> (SessionListViewModel, MockConnectionManager)
    {
        let mockConnectionManager = MockConnectionManager()
        let viewModel = TestableSessionListViewModel(
            sessionService: mockSessionService,
            networkMonitor: mockNetworkMonitor,
            connectionManager: mockConnectionManager
        )
        return (viewModel, mockConnectionManager)
    }

    // MARK: - Initialization Tests

    @Test("ViewModel initializes with correct default state")
    func initialState() async {
        let (viewModel, _) = createViewModel()

        #expect(viewModel.sessions.isEmpty)
        #expect(viewModel.filteredSessions.isEmpty)
        #expect(viewModel.isLoading == false)
        #expect(viewModel.errorMessage == nil)
        #expect(viewModel.showExitedSessions == true)
        #expect(viewModel.searchText.isEmpty)
        #expect(viewModel.isNetworkConnected == true)

        // UI State
        #expect(viewModel.showingCreateSession == false)
        #expect(viewModel.selectedSession == nil)
        #expect(viewModel.showingFileBrowser == false)
        #expect(viewModel.showingSettings == false)
        #expect(viewModel.showingCastImporter == false)
        #expect(viewModel.importedCastFile == nil)
        #expect(viewModel.presentedError == nil)
        #expect(viewModel.enableLivePreviews == true)
    }

    // MARK: - Session Loading Tests

    @Test("loadSessions successfully loads and sets sessions")
    func loadSessionsSuccess() async {
        let mockService = MockSessionService()
        let mockSessions = [
            createMockSession(id: "1", name: "Test Session 1"),
            createMockSession(id: "2", name: "Test Session 2", isRunning: false)
        ]
        mockService.sessions = mockSessions

        let (viewModel, _) = createViewModel(mockSessionService: mockService)

        await viewModel.loadSessions()

        #expect(mockService.getSessionsCallCount == 1)
        #expect(viewModel.sessions.count == 2)
        #expect(viewModel.sessions[0].id == "1")
        #expect(viewModel.sessions[1].id == "2")
        #expect(viewModel.errorMessage == nil)
        #expect(viewModel.isLoading == false)
    }

    @Test("loadSessions shows loading state during first load")
    func loadSessionsLoadingState() async {
        let mockService = MockSessionService()
        let (viewModel, _) = createViewModel(mockSessionService: mockService)

        // Verify initial state
        #expect(viewModel.isLoading == false)
        #expect(viewModel.sessions.isEmpty)

        // Load sessions and verify loading state is cleared
        await viewModel.loadSessions()
        #expect(viewModel.isLoading == false)
    }

    @Test("loadSessions doesn't show loading when sessions already exist")
    func loadSessionsNoLoadingWhenSessionsExist() async {
        let mockService = MockSessionService()
        let existingSessions = [createMockSession(id: "1")]
        mockService.sessions = existingSessions

        let (viewModel, _) = createViewModel(mockSessionService: mockService)

        // Load initial sessions
        await viewModel.loadSessions()
        #expect(viewModel.sessions.count == 1)

        // Add more sessions and reload
        mockService.sessions.append(createMockSession(id: "2"))

        await viewModel.loadSessions()

        // Should not have shown loading state since sessions weren't empty
        #expect(viewModel.isLoading == false)
        #expect(viewModel.sessions.count == 2)
    }

    @Test("loadSessions handles error correctly")
    func loadSessionsError() async {
        let mockService = MockSessionService()
        mockService.shouldThrowError = true
        mockService.thrownError = APIError.serverError(500, "Test error")

        let (viewModel, _) = createViewModel(mockSessionService: mockService)

        await viewModel.loadSessions()

        #expect(mockService.getSessionsCallCount == 1)
        #expect(viewModel.sessions.isEmpty)
        #expect(viewModel.errorMessage != nil)
        #expect(viewModel.isLoading == false)
    }

    // MARK: - Filtering Tests

    @Test("filteredSessions shows all sessions when showExitedSessions is true")
    func filteredSessionsShowAll() async {
        let mockService = MockSessionService()
        mockService.sessions = [
            createMockSession(id: "1", name: "Running", isRunning: true),
            createMockSession(id: "2", name: "Exited", isRunning: false)
        ]

        let (viewModel, _) = createViewModel(mockSessionService: mockService)
        await viewModel.loadSessions()

        viewModel.showExitedSessions = true

        #expect(viewModel.filteredSessions.count == 2)
        #expect(viewModel.filteredSessions.contains { $0.id == "1" })
        #expect(viewModel.filteredSessions.contains { $0.id == "2" })
    }

    @Test("filteredSessions hides exited sessions when showExitedSessions is false")
    func filteredSessionsHideExited() async {
        let mockService = MockSessionService()
        mockService.sessions = [
            createMockSession(id: "1", name: "Running", isRunning: true),
            createMockSession(id: "2", name: "Exited", isRunning: false)
        ]

        let (viewModel, _) = createViewModel(mockSessionService: mockService)
        await viewModel.loadSessions()

        viewModel.showExitedSessions = false

        #expect(viewModel.filteredSessions.count == 1)
        #expect(viewModel.filteredSessions[0].id == "1")
    }

    // MARK: - Search Tests

    @Test("filteredSessions filters by session name")
    func searchByName() async {
        let mockService = MockSessionService()
        mockService.sessions = [
            createMockSession(id: "1", name: "Frontend Dev"),
            createMockSession(id: "2", name: "Backend API"),
            createMockSession(id: "3", name: "Database Work")
        ]

        let (viewModel, _) = createViewModel(mockSessionService: mockService)
        await viewModel.loadSessions()

        viewModel.searchText = "front"

        #expect(viewModel.filteredSessions.count == 1)
        #expect(viewModel.filteredSessions[0].id == "1")
    }

    @Test("filteredSessions filters by command")
    func searchByCommand() async {
        let mockService = MockSessionService()
        mockService.sessions = [
            Session(
                id: "1",
                command: ["npm", "run", "dev"],
                workingDir: "/",
                name: nil,
                status: .running,
                exitCode: nil,
                startedAt: "2024-01-01T12:00:00Z",
                lastModified: nil,
                pid: 1,
                width: 80,
                height: 24,
                waiting: false,
                source: nil,
                remoteId: nil,
                remoteName: nil,
                remoteUrl: nil
            ),
            Session(
                id: "2",
                command: ["python", "server.py"],
                workingDir: "/",
                name: nil,
                status: .running,
                exitCode: nil,
                startedAt: "2024-01-01T12:00:00Z",
                lastModified: nil,
                pid: 2,
                width: 80,
                height: 24,
                waiting: false,
                source: nil,
                remoteId: nil,
                remoteName: nil,
                remoteUrl: nil
            )
        ]

        let (viewModel, _) = createViewModel(mockSessionService: mockService)
        await viewModel.loadSessions()

        viewModel.searchText = "npm"

        #expect(viewModel.filteredSessions.count == 1)
        #expect(viewModel.filteredSessions[0].id == "1")
    }

    @Test("filteredSessions filters by working directory")
    func searchByWorkingDir() async {
        let mockService = MockSessionService()
        mockService.sessions = [
            Session(
                id: "1",
                command: ["bash"],
                workingDir: "/home/user/frontend",
                name: nil,
                status: .running,
                exitCode: nil,
                startedAt: "2024-01-01T12:00:00Z",
                lastModified: nil,
                pid: 1,
                width: 80,
                height: 24,
                waiting: false,
                source: nil,
                remoteId: nil,
                remoteName: nil,
                remoteUrl: nil
            ),
            Session(
                id: "2",
                command: ["bash"],
                workingDir: "/home/user/backend",
                name: nil,
                status: .running,
                exitCode: nil,
                startedAt: "2024-01-01T12:00:00Z",
                lastModified: nil,
                pid: 2,
                width: 80,
                height: 24,
                waiting: false,
                source: nil,
                remoteId: nil,
                remoteName: nil,
                remoteUrl: nil
            )
        ]

        let (viewModel, _) = createViewModel(mockSessionService: mockService)
        await viewModel.loadSessions()

        viewModel.searchText = "frontend"

        #expect(viewModel.filteredSessions.count == 1)
        #expect(viewModel.filteredSessions[0].id == "1")
    }

    @Test("filteredSessions filters by PID")
    func searchByPID() async {
        let mockService = MockSessionService()
        mockService.sessions = [
            createMockSession(id: "1", name: "Session 1", pid: 1_234),
            createMockSession(id: "2", name: "Session 2", pid: 5_678)
        ]

        let (viewModel, _) = createViewModel(mockSessionService: mockService)
        await viewModel.loadSessions()

        viewModel.searchText = "1234"

        #expect(viewModel.filteredSessions.count == 1)
        #expect(viewModel.filteredSessions[0].id == "1")
    }

    @Test("filteredSessions returns all when search is empty")
    func searchEmpty() async {
        let mockService = MockSessionService()
        mockService.sessions = [
            createMockSession(id: "1", name: "Session 1"),
            createMockSession(id: "2", name: "Session 2")
        ]

        let (viewModel, _) = createViewModel(mockSessionService: mockService)
        await viewModel.loadSessions()

        viewModel.searchText = ""

        #expect(viewModel.filteredSessions.count == 2)
    }

    @Test("search is case insensitive")
    func searchCaseInsensitive() async {
        let mockService = MockSessionService()
        mockService.sessions = [
            createMockSession(id: "1", name: "Frontend Development")
        ]

        let (viewModel, _) = createViewModel(mockSessionService: mockService)
        await viewModel.loadSessions()

        viewModel.searchText = "FRONTEND"

        #expect(viewModel.filteredSessions.count == 1)
        #expect(viewModel.filteredSessions[0].id == "1")
    }

    // MARK: - Network Connectivity Tests

    @Test("isNetworkConnected reflects network monitor state")
    func networkConnectivity() async {
        let mockNetworkMonitor = MockNetworkMonitor(isConnected: true)
        let (viewModel, _) = createViewModel(mockNetworkMonitor: mockNetworkMonitor)

        #expect(viewModel.isNetworkConnected == true)

        mockNetworkMonitor.simulateStateChange(to: false)
        #expect(viewModel.isNetworkConnected == false)

        mockNetworkMonitor.simulateStateChange(to: true)
        #expect(viewModel.isNetworkConnected == true)
    }

    // MARK: - Session Operations Tests

    @Test("killSession calls service and reloads sessions")
    func killSessionSuccess() async {
        let mockService = MockSessionService()
        mockService.sessions = [createMockSession(id: "test-session")]

        let (viewModel, _) = createViewModel(mockSessionService: mockService)
        await viewModel.loadSessions()

        await viewModel.killSession("test-session")

        #expect(mockService.killSessionCallCount == 1)
        #expect(mockService.killedSessionIds.contains("test-session"))
        #expect(mockService.getSessionsCallCount == 2) // Initial load + reload after kill
        #expect(viewModel.errorMessage == nil)
    }

    @Test("killSession handles error correctly")
    func killSessionError() async {
        let mockService = MockSessionService()
        mockService.shouldThrowError = true
        mockService.thrownError = APIError.serverError(500, "Kill failed")

        let (viewModel, _) = createViewModel(mockSessionService: mockService)

        await viewModel.killSession("test-session")

        #expect(mockService.killSessionCallCount == 1)
        #expect(viewModel.errorMessage != nil)
    }

    @Test("cleanupSession calls service and reloads sessions")
    func cleanupSessionSuccess() async {
        let mockService = MockSessionService()
        mockService.sessions = [createMockSession(id: "test-session", isRunning: false)]

        let (viewModel, _) = createViewModel(mockSessionService: mockService)
        await viewModel.loadSessions()

        await viewModel.cleanupSession("test-session")

        #expect(mockService.cleanupSessionCallCount == 1)
        #expect(mockService.cleanedUpSessionIds.contains("test-session"))
        #expect(mockService.getSessionsCallCount == 2) // Initial load + reload after cleanup
        #expect(viewModel.errorMessage == nil)
    }

    @Test("cleanupSession handles error correctly")
    func cleanupSessionError() async {
        let mockService = MockSessionService()
        mockService.shouldThrowError = true
        mockService.thrownError = APIError.serverError(500, "Cleanup failed")

        let (viewModel, _) = createViewModel(mockSessionService: mockService)

        await viewModel.cleanupSession("test-session")

        #expect(mockService.cleanupSessionCallCount == 1)
        #expect(viewModel.errorMessage != nil)
    }

    @Test("cleanupAllExited calls service and reloads sessions")
    func cleanupAllExitedSuccess() async {
        let mockService = MockSessionService()
        mockService.sessions = [
            createMockSession(id: "running", isRunning: true),
            createMockSession(id: "exited1", isRunning: false),
            createMockSession(id: "exited2", isRunning: false)
        ]

        let (viewModel, _) = createViewModel(mockSessionService: mockService)
        await viewModel.loadSessions()

        await viewModel.cleanupAllExited()

        #expect(mockService.cleanupAllExitedCallCount == 1)
        #expect(mockService.getSessionsCallCount == 2) // Initial load + reload after cleanup
        #expect(viewModel.errorMessage == nil)
    }

    @Test("cleanupAllExited handles error correctly")
    func cleanupAllExitedError() async {
        let mockService = MockSessionService()
        mockService.shouldThrowError = true
        mockService.thrownError = APIError.serverError(500, "Cleanup all failed")

        let (viewModel, _) = createViewModel(mockSessionService: mockService)

        await viewModel.cleanupAllExited()

        #expect(mockService.cleanupAllExitedCallCount == 1)
        #expect(viewModel.errorMessage != nil)
    }

    @Test("killAllSessions calls service and reloads sessions")
    func killAllSessionsSuccess() async {
        let mockService = MockSessionService()
        mockService.sessions = [
            createMockSession(id: "session1"),
            createMockSession(id: "session2")
        ]

        let (viewModel, _) = createViewModel(mockSessionService: mockService)
        await viewModel.loadSessions()

        await viewModel.killAllSessions()

        #expect(mockService.killAllSessionsCallCount == 1)
        #expect(mockService.getSessionsCallCount == 2) // Initial load + reload after kill all
        #expect(viewModel.errorMessage == nil)
    }

    @Test("killAllSessions handles error correctly")
    func killAllSessionsError() async {
        let mockService = MockSessionService()
        mockService.shouldThrowError = true
        mockService.thrownError = APIError.serverError(500, "Kill all failed")

        let (viewModel, _) = createViewModel(mockSessionService: mockService)

        await viewModel.killAllSessions()

        #expect(mockService.killAllSessionsCallCount == 1)
        #expect(viewModel.errorMessage != nil)
    }

    // MARK: - Connection Management Tests

    @Test("disconnect calls connection manager")
    func testDisconnect() async {
        let (viewModel, mockConnectionManager) = createViewModel()

        await viewModel.disconnect()

        #expect(mockConnectionManager.disconnectCallCount == 1)
    }

    // MARK: - UI State Tests

    @Test("UI state properties can be modified")
    func uIStateManagement() async {
        let (viewModel, _) = createViewModel()

        // Test all UI state properties
        viewModel.showingCreateSession = true
        #expect(viewModel.showingCreateSession == true)

        let mockSession = createMockSession(id: "test")
        viewModel.selectedSession = mockSession
        #expect(viewModel.selectedSession?.id == "test")

        viewModel.showingFileBrowser = true
        #expect(viewModel.showingFileBrowser == true)

        viewModel.showingSettings = true
        #expect(viewModel.showingSettings == true)

        viewModel.showingCastImporter = true
        #expect(viewModel.showingCastImporter == true)

        let mockCastFile = CastFileItem(url: URL(string: "file://test.cast")!)
        viewModel.importedCastFile = mockCastFile
        #expect(viewModel.importedCastFile?.url.absoluteString == "file://test.cast")

        let mockError = IdentifiableError(error: APIError.networkError(URLError(.notConnectedToInternet)))
        viewModel.presentedError = mockError
        #expect(viewModel.presentedError != nil)

        viewModel.enableLivePreviews = false
        #expect(viewModel.enableLivePreviews == false)
    }

    // MARK: - Complex Scenarios

    @Test("search and filter work together correctly")
    func searchAndFilterCombined() async {
        let mockService = MockSessionService()
        mockService.sessions = [
            createMockSession(id: "1", name: "Frontend Running", isRunning: true),
            createMockSession(id: "2", name: "Frontend Exited", isRunning: false),
            createMockSession(id: "3", name: "Backend Running", isRunning: true),
            createMockSession(id: "4", name: "Backend Exited", isRunning: false)
        ]

        let (viewModel, _) = createViewModel(mockSessionService: mockService)
        await viewModel.loadSessions()

        // Search for "Frontend" and hide exited sessions
        viewModel.searchText = "Frontend"
        viewModel.showExitedSessions = false

        #expect(viewModel.filteredSessions.count == 1)
        #expect(viewModel.filteredSessions[0].id == "1")
        #expect(viewModel.filteredSessions[0].name == "Frontend Running")
    }

    @Test("error handling preserves previous sessions on failure")
    func errorPreservesData() async {
        let mockService = MockSessionService()
        mockService.sessions = [createMockSession(id: "existing")]

        let (viewModel, _) = createViewModel(mockSessionService: mockService)

        // First successful load
        await viewModel.loadSessions()
        #expect(viewModel.sessions.count == 1)
        #expect(viewModel.errorMessage == nil)

        // Second load fails
        mockService.shouldThrowError = true
        await viewModel.loadSessions()

        // Sessions should remain unchanged, but error should be set
        #expect(viewModel.sessions.count == 1) // Previous data preserved
        #expect(viewModel.errorMessage != nil) // Error is shown
    }

    @Test("multiple concurrent operations handle correctly")
    func concurrentOperations() async {
        let mockService = MockSessionService()
        mockService.sessions = [
            createMockSession(id: "1"),
            createMockSession(id: "2")
        ]

        let (viewModel, _) = createViewModel(mockSessionService: mockService)
        await viewModel.loadSessions()

        // Start multiple operations concurrently
        async let killResult: () = viewModel.killSession("1")
        async let cleanupResult: () = viewModel.cleanupSession("2")
        async let loadResult: () = viewModel.loadSessions()

        // Wait for all to complete
        await killResult
        await cleanupResult
        await loadResult

        // Verify all operations were called
        #expect(mockService.killSessionCallCount == 1)
        #expect(mockService.cleanupSessionCallCount == 1)
        #expect(mockService.getSessionsCallCount >= 3) // At least initial + reloads
    }
}
