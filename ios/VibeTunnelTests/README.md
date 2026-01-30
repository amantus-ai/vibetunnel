# VibeTunnel iOS Tests

This directory contains the test suite for the VibeTunnel iOS application using Swift Testing framework.

## Test Structure

```
VibeTunnelTests/
├── Mocks/                   # Mock implementations for testing
│   ├── MockAPIClient.swift
│   ├── MockURLProtocol.swift
│   └── MockWebSocketTask.swift
├── Services/                # Service layer tests
│   ├── APIClientTests.swift
│   ├── BufferWebSocketClientTests.swift
│   └── ConnectionManagerTests.swift
├── Models/                  # Data model tests
│   ├── SessionTests.swift
│   └── ServerConfigTests.swift
├── Utilities/              # Test utilities
│   ├── TestFixtures.swift
│   └── TestTags.swift
└── Integration/            # Integration tests (future)
```

## Running Tests

### Command Line
```bash
cd ios
swift test
```

### Xcode
1. Open `VibeTunnel.xcodeproj`
2. Select the VibeTunnel scheme
3. Press `Cmd+U` or choose Product → Test

### CI
Tests run automatically in GitHub Actions on every push and pull request.

## Test Tags

Tests are organized with tags for selective execution:
- `@Tag.critical` - Core functionality tests
- `@Tag.networking` - Network-related tests
- `@Tag.websocket` - WebSocket functionality
- `@Tag.models` - Data model tests
- `@Tag.persistence` - Data persistence tests
- `@Tag.integration` - Integration tests

Run specific tags:
```bash
swift test --filter .critical
swift test --filter .networking
```

## Writing Tests

This project uses Swift Testing (not XCTest). Key differences:
- Use `@Test` attribute instead of `test` prefix
- Use `#expect()` instead of `XCTAssert`
- Use `@Suite` to group related tests
- Tests run in parallel by default

Example:
```swift
@Suite("MyFeature Tests", .tags(.critical))
struct MyFeatureTests {
    @Test("Does something correctly")
    func testFeature() async throws {
        // Arrange
        let sut = MyFeature()
        
        // Act
        let result = try await sut.doSomething()
        
        // Assert
        #expect(result == expectedValue)
    }
}
```

## Coverage Goals

- APIClient: 90%+
- BufferWebSocketClient: 85%+
- Models: 95%+
- Overall: 80%+