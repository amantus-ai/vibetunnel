# VibeTunnel iOS Testing Approach

## Overview

The VibeTunnel iOS project uses a hybrid testing approach due to the separation between the Xcode project (for the app) and Swift Package Manager (for dependencies and tests).

## Test Structure

### 1. Standalone Tests (`StandaloneTests.swift`)
These tests verify core concepts and logic without importing the actual app module:
- API endpoint construction
- JSON encoding/decoding
- WebSocket binary protocol
- Model validation
- Data persistence patterns

### 2. Mock-Based Tests (Future Implementation)
The test infrastructure includes comprehensive mocks for when the app code can be properly tested:
- `MockAPIClient` - Full API client mock with response configuration
- `MockURLProtocol` - Network request interception
- `MockWebSocketTask` - WebSocket connection mocking

## Running Tests

### Command Line
```bash
cd ios
swift test              # Run all tests
swift test --parallel   # Run tests in parallel
swift test --filter Standalone  # Run specific test suite
```

### CI/CD
Tests run automatically in GitHub Actions:
1. Swift tests run using `swift test`
2. iOS app builds separately to ensure compilation

## Test Categories

### Critical Tests (`.tags(.critical)`)
- Core API functionality
- Connection management
- Essential data models

### Networking Tests (`.tags(.networking)`)
- HTTP request/response handling
- Error scenarios
- URL construction

### WebSocket Tests (`.tags(.websocket)`)
- Binary protocol parsing
- Message handling
- Connection lifecycle

### Model Tests (`.tags(.models)`)
- Data encoding/decoding
- Model validation
- Computed properties

### Persistence Tests (`.tags(.persistence)`)
- UserDefaults storage
- Connection state restoration
- Data migration

## Why This Approach?

1. **Xcode Project Limitations**: The iOS app uses an Xcode project which doesn't easily integrate with Swift Testing when running via SPM.

2. **Swift Testing Benefits**: Using the modern Swift Testing framework provides:
   - Better async/await support
   - Parallel test execution
   - Expressive assertions with `#expect`
   - Tag-based organization

3. **Standalone Tests**: By testing concepts rather than importing the app module directly, we can:
   - Run tests via SPM
   - Verify core logic independently
   - Maintain fast test execution

## Future Improvements

1. **Xcode Test Target**: Add a proper test target to the Xcode project to enable testing of actual app code.

2. **Integration Tests**: Create integration tests that run against a mock server.

3. **UI Tests**: Add XCUITest target for end-to-end testing.

4. **Code Coverage**: Enable coverage reporting once tests can import the app module.

## Adding New Tests

1. Add test functions to `StandaloneTests.swift` or create new test files
2. Use appropriate tags for organization
3. Follow the pattern:
   ```swift
   @Test("Description of what is being tested")
   func testFeature() {
       // Arrange
       let input = ...
       
       // Act
       let result = ...
       
       // Assert
       #expect(result == expected)
   }
   ```
4. Run tests locally before committing
5. Ensure CI passes