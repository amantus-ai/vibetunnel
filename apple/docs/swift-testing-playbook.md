---
description: Comprehensive guide for migrating from XCTest to Swift Testing with best practices from WWDC 2024
globs: "**/*Tests.swift, **/*Test.swift"
alwaysApply: false
---

# The Ultimate Swift Testing Playbook (2024 WWDC Edition, expanded with Apple docs from June 2025)
https://developer.apple.com/xcode/swift-testing/

A hands-on, comprehensive guide for migrating from XCTest to Swift Testing and mastering the new framework. This playbook integrates the latest patterns and best practices from WWDC 2024 and official Apple documentation to make your tests more powerful, expressive, and maintainable.

---

## **1. Migration & Tooling Baseline**

Ensure your environment is set up for a smooth, gradual migration.

| What | Why |
|---|---|
| **Xcode 16 & Swift 6** | Swift Testing is bundled with the latest toolchain. It leverages modern Swift features like macros, structured concurrency, and powerful type-system checks. |
| **Keep XCTest Targets** | **Incremental Migration is Key.** You can have XCTest and Swift Testing tests in the same target, allowing you to migrate file-by-file without breaking CI. Both frameworks can coexist. |
| **Enable Parallel Execution**| In your Test Plan, ensure "Use parallel execution" is enabled. Swift Testing runs tests in parallel by default, which dramatically speeds up test runs and helps surface hidden state dependencies that serial execution might miss. |

### Migration Action Items
- [ ] Ensure all developer machines and CI runners are on macOS 15+ and Xcode 16+.
- [ ] For projects supporting Linux/Windows, add the `swift-testing` SPM package to your `Package.swift`. It's bundled in Xcode and not needed for Apple platforms.
- [ ] For **existing test targets**, you must explicitly enable the framework. In the target's **Build Settings**, find **Enable Testing Frameworks** and set its value to **Yes**. Without this, `import Testing` will fail.
- [ ] In your primary test plan, confirm that **“Use parallel execution”** is enabled. This is the default and recommended setting.

---

## **2. Expressive Assertions: `#expect` & `#require`**

Replace the entire `XCTAssert` family with two powerful, expressive macros. They accept regular Swift expressions, eliminating the need for dozens of specialized `XCTAssert` functions.

| Macro | Use Case & Behavior |
|---|---|
| **`#expect(expression)`** | **Soft Check.** Use for most validations. If the expression is `false`, the issue is recorded, but the test function continues executing. This allows you to find multiple failures in a single run. |
| **`#require(expression)`**| **Hard Check.** Use for critical preconditions (e.g., unwrapping an optional). If the expression is `false` or throws, the test is immediately aborted. This prevents cascading failures from an invalid state. |

### Power Move: Visual Failure Diagnostics
Unlike `XCTAssert`, which often only reports that a comparison failed, `#expect` shows you the exact values that caused the failure, directly in the IDE and logs. This visual feedback is a massive productivity boost.

**Code:**
```swift
@Test("User count meets minimum requirement")
func testUserCount() {
    let userCount = 5
    // This check will fail
    #expect(userCount > 10)
}
```

**Failure Output in Xcode:**
```
▽ Expected expression to be true
#expect(userCount > 10)
      |         | |
      5         | 10
                false
```

### Power Move: Optional-Safe Unwrapping
`#require` is the new, safer replacement for `XCTUnwrap`. It not only checks for `nil` but also unwraps the value for subsequent use.

**Before: The XCTest Way**
```swift
// In an XCTestCase subclass...
func testFetchUser_XCTest() async throws {
    let user = try XCTUnwrap(await fetchUser(id: "123"), "Fetching user should not return nil")
    XCTAssertEqual(user.id, "123")
}
```

**After: The Swift Testing Way**
```swift
@Test("Fetching a valid user succeeds")
func testFetchUser() async throws {
    // #require both checks for nil and unwraps `user` in one step.
    // If fetchUser returns nil, the test stops here and fails.
    let user = try #require(await fetchUser(id: "123"))

    // `user` is now a non-optional User, ready for further assertions.
    #expect(user.id == "123")
    #expect(user.age == 37)
}
```

### Common Assertion Conversions Quick-Reference

Use this table as a cheat sheet when migrating your `XCTest` assertions.

| XCTest Assertion | Swift Testing Equivalent | Notes |
|---|---|---|
| `XCTAssert(expr)` | `#expect(expr)` | Direct replacement for a boolean expression. |
| `XCTAssertEqual(a, b)` | `#expect(a == b)` | Use the standard `==` operator. |
| `XCTAssertNotEqual(a, b)`| `#expect(a != b)` | Use the standard `!=` operator. |
| `XCTAssertNil(a)` | `#expect(a == nil)` | Direct comparison to `nil`. |
| `XCTAssertNotNil(a)` | `#expect(a != nil)` | Direct comparison to `nil`. |
| `XCTAssertTrue(a)` | `#expect(a)` | No change needed if `a` is already a Bool. |
| `XCTAssertFalse(a)` | `#expect(!a)` | Use the `!` operator to negate the expression. |
| `XCTAssertGreaterThan(a, b)` | `#expect(a > b)` | Use any standard comparison operator: `>`, `<`, `>=`, `<=` |
| `XCTUnwrap(a)` | `try #require(a)` | The preferred, safer way to unwrap optionals. |
| `XCTAssertThrowsError(expr)` | `#expect(throws: Error.self) { expr }` | The basic form for checking any error. |
| `XCTAssertNoThrow(expr)` | `#expect(throws: Never.self) { expr }` | The explicit way to assert that no error is thrown. |

### Action Items
- [ ] Run `grep -R "XCTAssert" .` to find all legacy assertions.
- [ ] Convert `XCTUnwrap` calls to `try #require()`. This is a direct and superior replacement.
- [ ] Convert most `XCTAssert` calls to `#expect()`. Use `#require()` only for preconditions where continuing the test makes no sense.
- [ ] For multiple related checks on the same object, use separate `#expect()` statements. Each will be evaluated independently and all failures will be reported.

---

## **3. Setup, Teardown, and State Lifecycle**

Swift Testing replaces `setUpWithError` and `tearDownWithError` with a more natural, type-safe lifecycle using `init()` and `deinit`.

**The Core Concept:** A fresh, new instance of the test suite (`struct` or `class`) is created for **each** test function it contains. This is the cornerstone of test isolation, guaranteeing that state from one test cannot leak into another.

| Method | Replaces... | Behavior |
|---|---|---|
| `init()` | `setUpWithError()` | The initializer for your suite. Put all setup code here. It can be `async` and `throws`. |
| `deinit` | `tearDownWithError()` | The deinitializer. Put cleanup code here. It runs automatically after each test. **Note:** `deinit` is only available on `class` or `actor` suite types, not `struct`s. This is a common reason to choose a class for your suite. |

### Practical Example: Migrating a Database Test Suite

**Before: The XCTest Way**
```swift
final class DatabaseServiceXCTests: XCTestCase {
    var sut: DatabaseService!
    var tempDirectory: URL!

    override func setUpWithError() throws {
        try super.setUpWithError()
        tempDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true)
        
        let testDatabase = TestDatabase(storageURL: tempDirectory)
        sut = DatabaseService(database: testDatabase)
    }

    override func tearDownWithError() throws {
        try FileManager.default.removeItem(at: tempDirectory)
        sut = nil
        tempDirectory = nil
        try super.tearDownWithError()
    }

    func testSavingUser() throws {
        let user = User(id: "user-1", name: "Alex")
        try sut.save(user)
        let loadedUser = try sut.loadUser(id: "user-1")
        XCTAssertNotNil(loadedUser)
    }
}
```

**After: The Swift Testing Way (using `class` for `deinit`)**
```swift
@Suite final class DatabaseServiceTests {
    // Using a class here to demonstrate `deinit` for cleanup.
    let sut: DatabaseService
    let tempDirectory: URL

    init() throws {
        // ARRANGE: Runs before EACH test in this suite.
        self.tempDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true)
        
        let testDatabase = TestDatabase(storageURL: tempDirectory)
        self.sut = DatabaseService(database: testDatabase)
    }
    
    deinit {
        // TEARDOWN: Runs after EACH test.
        try? FileManager.default.removeItem(at: tempDirectory)
    }

    @Test func testSavingUser() throws {
        let user = User(id: "user-1", name: "Alex")
        try sut.save(user)
        #expect(try sut.loadUser(id: "user-1") != nil)
    }
}
```

### Action Items
- [ ] Convert test classes from `XCTestCase` to `struct`s (preferred for automatic state isolation) or `final class`es.
- [ ] Move `setUpWithError` logic into the suite's `init()`.
- [ ] Move `tearDownWithError` logic into the suite's `deinit` (and use a `class` or `actor` if needed).
- [ ] Define the SUT and its dependencies as `let` properties, initialized in `init()`.

---

## **4. Mastering Error Handling**

Go beyond `do/catch` with a dedicated, expressive API for validating thrown errors.

| Overload | Replaces... | Example & Use Case |
|---|---|---|
| **`#expect(throws: Error.self)`**| Basic `XCTAssertThrowsError` | Verifies that *any* error was thrown. |
| **`#expect(throws: BrewingError.self)`** | Typed `XCTAssertThrowsError` | Ensures an error of a specific *type* is thrown. |
| **`#expect(throws: BrewingError.outOfBeans)`**| Specific Error `XCTAssertThrowsError`| Validates a specific error *value* is thrown. |
| **`#expect(throws: ... ) catch: { ... }`** | `do/catch` with `switch` | **Payload Introspection.** The ultimate tool for errors with associated values. It gives you a closure to inspect the thrown error. <br> ```swift #expect(throws: BrewingError.self) { try brew(beans: 0) } catch: { error in guard case let .notEnoughBeans(needed) = error else { Issue.record("Wrong error case thrown"); return } #expect(needed > 0) } ``` |
| **`#expect(throws: Never.self)`** | `XCTAssertNoThrow` | Explicitly asserts that a function does *not* throw. Ideal for happy-path tests. |

---

## **5. Parameterized Tests: Drastically Reduce Boilerplate**

Run a single test function with multiple argument sets to maximize coverage with minimal code. This is superior to a `for-in` loop because each argument set runs as an independent test, can be run in parallel, and failures are reported individually.

| Pattern | How to Use It & When |
|---|---|
| **Single Collection** | `@Test(arguments: [0, 100, -40])` <br> The simplest form. Pass a collection of inputs. |
| **Zipped Collections** | `@Test(arguments: zip(inputs, expectedOutputs))` <br> The most common and powerful pattern. Use `zip` to pair inputs and expected outputs, ensuring a one-to-one correspondence. |
| **Multiple Collections** | `@Test(arguments: ["USD", "EUR"], [1, 10, 100])` <br> **⚠️ Caution: Cartesian Product.** This creates a test case for *every possible combination* of arguments. Use it deliberately when you need to test all combinations. |

### Example: Migrating Repetitive Tests to a Parameterized One

**Before: The XCTest Way**
```swift
func testFlavorVanillaContainsNoNuts() {
    let flavor = Flavor.vanilla
    XCTAssertFalse(flavor.containsNuts)
}
func testFlavorPistachioContainsNuts() {
    let flavor = Flavor.pistachio
    XCTAssertTrue(flavor.containsNuts)
}
func testFlavorChocolateContainsNoNuts() {
    let flavor = Flavor.chocolate
    XCTAssertFalse(flavor.containsNuts)
}
```

**After: The Swift Testing Way using `zip`**
```swift
@Test("Flavor nut content is correct", arguments: zip(
    [Flavor.vanilla, .pistachio, .chocolate],
    [false, true, false]
))
func testFlavorContainsNuts(flavor: Flavor, expected: Bool) {
    #expect(flavor.containsNuts == expected)
}
```

---

## **6. Conditional Execution & Skipping**

Dynamically control which tests run based on feature flags, environment, or known issues.

| Trait | What It Does & How to Use It |
|---|---|
| **`.disabled("Reason")`** | **Unconditionally skips a test.** The test is not run, but it is still compiled. Always provide a descriptive reason for CI visibility (e.g., `"Flaky on CI, see FB12345"`). |
| **`.enabled(if: condition)`** | **Conditionally runs a test.** The test only runs if the boolean `condition` is `true`. This is perfect for tests tied to feature flags or specific environments. <br> ```swift @Test(.enabled(if: FeatureFlags.isNewAPIEnabled)) func testNewAPI() { /* ... */ } ``` |
| **`@available(...)`** | **OS Version-Specific Tests.** Apply this attribute directly to the test function. It's better than a runtime `#available` check because it allows the test runner to know the test is skipped for platform reasons, which is cleaner in test reports. |

---

## **7. Specialized Assertions for Clearer Failures**

While `#expect(a == b)` works, purpose-built patterns provide sharper, more actionable failure messages by explaining *why* something failed, not just *that* it failed.

> **⚠️ Note:** Swift Testing is still evolving and doesn't have all the specialized assertion APIs that XCTest provides. Some common patterns require manual implementation or third-party libraries like Swift Numerics.

| Assertion Type | Why It's Better Than a Generic Check |
| :--- | :--- |
| **Comparing Collections (Unordered)**<br>Use Set comparison for order-independent equality | A simple `==` check on arrays fails if elements are the same but the order is different. Converting to Sets ignores order, preventing false negatives for tests where order doesn't matter. <br><br> **Brittle:** `#expect(tags == ["ios", "swift"])` <br> **Robust:** `#expect(Set(tags) == Set(["swift", "ios"]))` |
| **Floating-Point Accuracy**<br>Use manual tolerance checks or Swift Numerics | Floating-point math is imprecise. `#expect(0.1 + 0.2 == 0.3)` will fail. Use manual tolerance checking or Swift Numerics for robust floating-point comparisons. <br><br> **Fails:** `#expect(result == 0.3)` <br> **Passes:** `#expect(abs(result - 0.3) < 0.0001)` <br> **With Swift Numerics:** `#expect(result.isApproximatelyEqual(to: 0.3, absoluteTolerance: 0.0001))` |

---

## **8. Structure and Organization at Scale**

Use suites and tags to manage large and complex test bases.

### Suites and Nested Suites
A `@Suite` groups related tests and can be nested for a clear hierarchy. Traits applied to a suite are inherited by all tests and nested suites within it.

### Tags for Cross-Cutting Concerns
Tags associate tests with common characteristics (e.g., `.network`, `.ui`, `.regression`) regardless of their suite. This is invaluable for filtering.

1.  **Define Tags in a Central File:**
    ```swift
    // /Tests/Support/TestTags.swift
    import Testing

    extension Tag {
        @Tag static var fast: Self
        @Tag static var regression: Self
        @Tag static var flaky: Self
        @Tag static var networking: Self
    }
    ```
2.  **Apply Tags & Filter:**
    ```swift
    // Apply to a test or suite
    @Test("Username validation", .tags(.fast, .regression))
    func testUsername() { /* ... */ }

    // Run from CLI
    // swift test --filter .fast
    // swift test --skip .flaky
    // swift test --filter .networking --filter .regression

    // Filter in Xcode Test Plan
    // Add "fast" to the "Include Tags" field or "flaky" to the "Exclude Tags" field.
    ```
### Power Move: Xcode UI Integration for Tags
Xcode 16 deeply integrates with tags, turning them into a powerful organizational tool.

-   **Grouping by Tag in Test Navigator:** In the Test Navigator (`Cmd-6`), click the tag icon at the top. This switches the view from the file hierarchy to one where tests are grouped by their tags. It's a fantastic way to visualize and run all tests related to a specific feature.
-   **Test Report Insights:** After a test run, the Test Report can automatically find patterns. Go to the **Insights** tab to see messages like **"All 7 tests with the 'networking' tag failed."** This immediately points you to systemic issues, saving significant debugging time.

---

## **9. Concurrency and Asynchronous Testing**

### Async/Await and Confirmations
- **Async Tests**: Simply mark your test function `async` and use `await`.
- **Confirmations**: To test APIs with completion handlers or that fire multiple times (like delegates or notifications), use `confirmation`.
- **`fulfillment(of:timeout:)`**: This is the global function you `await` to pause the test until your confirmations are fulfilled or a timeout is reached.

```swift
@Test("Delegate is notified 3 times")
async func testDelegateNotifications() async throws {
    // Create a confirmation that expects to be fulfilled exactly 3 times.
    let confirmation = confirmation("delegate.didUpdate was called", expectedCount: 3)
    let delegate = MockDelegate { await confirmation.fulfill() }
    let sut = SystemUnderTest(delegate: delegate)

    sut.performActionThatNotifiesThreeTimes()
    
    // Explicitly wait for the confirmation to be fulfilled with a 1-second timeout.
    try await fulfillment(of: [confirmation], timeout: .seconds(1))
}
```

### Advanced Asynchronous Patterns

#### Asserting an Event Never Happens
Use a confirmation with `expectedCount: 0` to verify that a callback or delegate method is *never* called during an operation. If `fulfill()` is called on it, the test will fail.

```swift
@Test("Logging out does not trigger a data sync")
async func testLogoutDoesNotSync() async throws {
    let syncConfirmation = confirmation("data sync was triggered", expectedCount: 0)
    let mockSyncEngine = MockSyncEngine { await syncConfirmation.fulfill() }
    let sut = AccountManager(syncEngine: mockSyncEngine)
    
    sut.logout()
    
    // The test passes if the confirmation is never fulfilled within the timeout.
    // If it *is* fulfilled, this will throw an error and fail the test.
    await fulfillment(of: [syncConfirmation], timeout: .seconds(0.5), performing: {})
}
```

#### Bridging Legacy Completion Handlers
For older asynchronous code that uses completion handlers, use `withCheckedThrowingContinuation` to wrap it in a modern `async/await` call that Swift Testing can work with.

```swift
func legacyFetch(completion: @escaping (Result<Data, Error>) -> Void) {
    // ... legacy async code ...
}

@Test func testLegacyFetch() async throws {
    let data = try await withCheckedThrowingContinuation { continuation in
        legacyFetch { result in
            continuation.resume(with: result)
        }
    }
    #expect(!data.isEmpty)
}
```

### Controlling Parallelism
- **`.serialized`**: Apply this trait to a `@Test` or `@Suite` to force its contents to run serially (one at a time). Use this as a temporary measure for legacy tests that are not thread-safe or have hidden state dependencies. The goal should be to refactor them to run in parallel.
- **`.timeLimit`**: A safety net to prevent hung tests from stalling CI. The more restrictive (shorter) duration wins when applied at both the suite and test level.

---

## **10. Advanced API Cookbook**

| Feature | What it Does & How to Use It |
|---|---|
| **`withKnownIssue`** | Marks a test as an **Expected Failure**. It's better than `.disabled` for known bugs. The test still runs but won't fail the suite. Crucially, if the underlying bug gets fixed and the test *passes*, `withKnownIssue` will fail, alerting you to remove it. |
| **`CustomTestStringConvertible`** | Provides custom, readable descriptions for your types in test failure logs. Conform your key models to this protocol to make debugging much easier. |
| **`.bug("JIRA-123")` Trait** | Associates a test directly with a ticket in your issue tracker. This adds invaluable context to test reports in Xcode and Xcode Cloud. |
| **`Test.current`** | A static property (`Test.current`) that gives you runtime access to the current test's metadata, such as its name, tags, and source location. Useful for advanced custom logging. |
| **Multiple Expectations Pattern** | Use separate `#expect()` statements for validating multiple properties. Each expectation is evaluated independently, and all failures are reported even if earlier ones fail. This provides comprehensive feedback about object state. <br><br> ```swift let user = try #require(loadUser()) #expect(user.name == "John") #expect(user.age >= 18) #expect(user.isActive) ``` |

---

## **11. Common Pitfalls and How to Avoid Them**

A checklist of common mistakes developers make when adopting Swift Testing.

1.  **Overusing `#require()`**
    -   **The Pitfall:** Using `#require()` for every check. This makes tests brittle and hides information. If the first `#require()` fails, the rest of the test is aborted, and you won't know if other things were also broken.
    -   **The Fix:** Use `#expect()` for most checks. Only use `#require()` for essential setup conditions where the rest of the test would be nonsensical if they failed (e.g., a non-nil SUT, a valid URL).

2.  **Forgetting State is Isolated**
    -   **The Pitfall:** Assuming that a property modified in one test will retain its value for the next test in the same suite.
    -   **The Fix:** Remember that a **new instance** of the suite is created for every test. This is a feature, not a bug! All shared setup must happen in `init()`. Do not rely on state carrying over between tests.

3.  **Accidentally Using a Cartesian Product**
    -   **The Pitfall:** Passing multiple collections to a parameterized test without `zip`, causing an exponential explosion of test cases (`@Test(arguments: collectionA, collectionB)`).
    -   **The Fix:** Be deliberate. If you want one-to-one pairing, **always use `zip`**. Only use the multi-collection syntax when you explicitly want to test every possible combination.

4.  **Ignoring the `.serialized` Trait for Unsafe Tests**
    -   **The Pitfall:** Migrating old, stateful tests that are not thread-safe and seeing them fail randomly due to parallel execution.
    -   **The Fix:** As a temporary measure, apply the `.serialized` trait to the suite containing these tests. This forces them to run one-at-a-time, restoring the old behavior. The long-term goal should be to refactor the tests to be parallel-safe and remove the trait.

---

## **12. Migrating from XCTest**

Swift Testing and XCTest can coexist in the same target, enabling an incremental migration.

### Key Differences at a Glance

| Feature | XCTest | Swift Testing |
|---|---|---|
| **Test Discovery** | Method name must start with `test...` | `@Test` attribute on any function or method. |
| **Suite Type** | `class MyTests: XCTestCase` | `struct MyTests` (preferred), `class`, or `actor`. |
| **Assertions** | `XCTAssert...()` family of functions | `#expect()` and `#require()` macros with Swift expressions. |
| **Error Unwrapping** | `try XCTUnwrap(...)` | `try #require(...)` |
| **Setup/Teardown**| `setUpWithError()`, `tearDownWithError()` | `init()`, `deinit` (on classes/actors) |
| **Asynchronous Wait**| `XCTestExpectation` | `confirmation()` and `await fulfillment(of:timeout:)` |
| **Parallelism** | Opt-in, multi-process | Opt-out, in-process via Swift Concurrency. |

### What NOT to Migrate (Yet)
Continue using XCTest for the following, as they are not currently supported by Swift Testing:
- **UI Automation Tests** (using `XCUIApplication`)
- **Performance Tests** (using `XCTMetric` and `measure { ... }`)
- **Tests written in Objective-C**

---

## **13. Swift 6.2 Testing Enhancements (2025 Edition)**

Swift 6.2 introduces powerful new testing capabilities that take Swift Testing to the next level. These features provide enhanced debugging context, process lifecycle testing, and more sophisticated test control.

### 13.1 Exit Tests: Testing Process Lifecycle and Crashes

Exit tests allow you to verify that code properly handles process termination scenarios, crash recovery, and subprocess management. This is crucial for applications that spawn external processes or need robust crash recovery.

| Feature | Use Case | Benefits |
|---|---|---|
| **`#expect(processExitsWith: .success)`** | Test that processes terminate cleanly | Verifies graceful shutdown and cleanup |
| **`#expect(processExitsWith: .failure)`** | Test that invalid operations fail appropriately | Ensures proper error handling and exit codes |
| **Process Recovery Testing** | Test auto-restart and crash recovery logic | Validates resilience mechanisms |

#### Practical Example: Server Process Lifecycle

```swift
@Test("Server handles unexpected termination gracefully", .tags(.exitTests))
func serverCrashRecovery() async throws {
    await #expect(processExitsWith: .success) {
        let serverManager = ServerManager.shared
        
        // Start server process
        await serverManager.start()
        
        // Simulate unexpected termination
        if let server = serverManager.bunServer {
            server.terminate()
        }
        
        // Wait for auto-restart logic
        try await Task.sleep(for: .milliseconds(2_000))
        
        // Verify recovery behavior
        // Test should verify that the system handles the crash gracefully
        
        // Clean shutdown
        await serverManager.stop()
    }
}
```

#### CLI Tool Process Validation

```swift
@Test("Shell command executes successfully", .tags(.exitTests))
func shellCommandExecution() async throws {
    await #expect(processExitsWith: .success) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", "ls /tmp | head -5"]
        
        try process.run()
        process.waitUntilExit()
        
        guard process.terminationStatus == 0 else {
            throw ProcessError.commandFailed(process.terminationStatus)
        }
    }
}
```

### 13.2 Attachments: Rich Debugging Context

Attachments revolutionize test debugging by capturing system state, configuration details, and diagnostic information when tests fail. This provides invaluable context that makes debugging faster and more effective.

| Attachment Type | Best For | Example Use Cases |
|---|---|---|
| **System Information** | Environment debugging | OS version, memory, processor info |
| **Configuration State** | Settings and setup issues | Server ports, network config, feature flags |
| **Process Details** | Service lifecycle issues | PIDs, running state, error messages |
| **Performance Metrics** | Performance regression analysis | Timing data, memory usage, throughput |

#### Enhanced Test with Diagnostic Attachments

```swift
@Test("Network configuration with full diagnostics", .tags(.attachmentTests))
func networkConfigurationDiagnostics() throws {
    // Attach system environment for context
    Attachment.record("System Info", """
        OS: \(ProcessInfo.processInfo.operatingSystemVersionString)
        Environment: \(ProcessInfo.processInfo.environment["CI"] != nil ? "CI" : "Local")
        Timestamp: \(Date().ISO8601Format())
        """)
    
    // Attach network state
    let localIP = NetworkUtility.getLocalIPAddress()
    let allIPs = NetworkUtility.getAllIPAddresses()
    
    Attachment.record("Network Configuration", """
        Local IP: \(localIP ?? "none")
        All IPs: \(allIPs.joined(separator: ", "))
        Interface Count: \(allIPs.count)
        """)
    
    // Test logic with rich failure context
    #expect(localIP != nil || allIPs.isEmpty)
}
```

#### Performance Testing with Detailed Metrics

```swift
@Test("API performance with statistical analysis", .tags(.performance, .attachmentTests))
func apiPerformanceAnalysis() async throws {
    var timings: [TimeInterval] = []
    let iterations = 100
    
    // Capture test configuration
    Attachment.record("Performance Test Setup", """
        Iterations: \(iterations)
        Test Environment: \(ProcessInfo.processInfo.environment["CI"] != nil ? "CI" : "Local")
        API Endpoint: /api/sessions
        """)
    
    // Collect timing data
    for _ in 0..<iterations {
        let start = CFAbsoluteTimeGetCurrent()
        _ = await apiCall()
        let end = CFAbsoluteTimeGetCurrent()
        timings.append(end - start)
    }
    
    // Calculate comprehensive statistics
    let average = timings.reduce(0, +) / Double(timings.count)
    let stdDev = calculateStandardDeviation(timings)
    let p95 = timings.sorted()[Int(0.95 * Double(timings.count))]
    
    // Attach detailed performance metrics
    Attachment.record("Performance Results", """
        Average: \(String(format: "%.2f", average * 1000))ms
        Standard Deviation: \(String(format: "%.2f", stdDev * 1000))ms
        95th Percentile: \(String(format: "%.2f", p95 * 1000))ms
        Min: \(String(format: "%.2f", (timings.min() ?? 0) * 1000))ms
        Max: \(String(format: "%.2f", (timings.max() ?? 0) * 1000))ms
        """)
    
    // Attach raw timing data for analysis
    let timingData = timings.enumerated().map { i, timing in
        "Sample \(i + 1): \(String(format: "%.4f", timing * 1000))ms"
    }.joined(separator: "\n")
    Attachment.record("Raw Timing Data", timingData)
    
    #expect(average < 0.05, "Average response time exceeded 50ms")
}
```

### 13.3 Enhanced Conditional Testing with ConditionTrait.evaluate()

Swift 6.2 enhances conditional testing with the ability to check trait conditions outside of test context, enabling smarter test execution based on system capabilities.

#### Custom Condition Traits

```swift
/// Checks if the required server binary is available
struct ServerBinaryAvailableCondition: ConditionTrait {
    func evaluate(for test: Test) -> ConditionResult {
        let bunPath = "/usr/local/bin/bun"
        let altBunPath = "/opt/homebrew/bin/bun"
        
        let hasBinary = FileManager.default.fileExists(atPath: bunPath) || 
                       FileManager.default.fileExists(atPath: altBunPath)
        
        return hasBinary ? .continue : .skip(reason: "Server binary not available")
    }
}

/// Checks if network interfaces are available for testing
struct NetworkAvailableCondition: ConditionTrait {
    func evaluate(for test: Test) -> ConditionResult {
        let hasNetwork = !NetworkUtility.getAllIPAddresses().isEmpty
        return hasNetwork ? .continue : .skip(reason: "No network interfaces available")
    }
}

/// Checks if we're in a valid Git repository for repository-specific tests
struct ValidGitRepositoryCondition: ConditionTrait {
    func evaluate(for test: Test) -> ConditionResult {
        let gitDir = FileManager.default.fileExists(atPath: ".git")
        return gitDir ? .continue : .skip(reason: "Not in a Git repository")
    }
}

/// Checks if we're running in CI environment
struct NotInCICondition: ConditionTrait {
    func evaluate(for test: Test) -> ConditionResult {
        let isCI = ProcessInfo.processInfo.environment["CI"] != nil ||
                   ProcessInfo.processInfo.environment["GITHUB_ACTIONS"] != nil
        return isCI ? .skip(reason: "Disabled in CI environment") : .continue
    }
}
```

#### Smart Test Execution

```swift
// Replace broad .disabled() with intelligent conditions
@Suite("Server Manager Tests", .tags(.serverManager))
struct ServerManagerTests {
    
    @Test("Server lifecycle with full binary", ServerBinaryAvailableCondition(), NotInCICondition())
    func serverLifecycleWithBinary() async throws {
        // This test only runs when:
        // 1. The server binary is actually available
        // 2. We're not in a CI environment
        // This prevents false failures and provides clear skip reasons
    }
    
    @Test("Network configuration", NetworkAvailableCondition())
    func networkConfiguration() throws {
        // Only runs when network interfaces are available
        // Automatically skipped in containerized or network-less environments
    }
}
```

### 13.4 Enhanced Tag System for Better Organization

Expand your tag system to include the new Swift 6.2 testing capabilities:

```swift
// Enhanced TestTags.swift
extension Tag {
    // Existing tags
    @Tag static var critical: Self
    @Tag static var networking: Self
    @Tag static var concurrency: Self
    
    // Swift 6.2 Enhanced Tags
    @Tag static var exitTests: Self          // Tests using processExitsWith
    @Tag static var attachmentTests: Self    // Tests with rich diagnostic attachments
    @Tag static var requiresServerBinary: Self  // Tests needing actual server binary
    @Tag static var requiresNetwork: Self   // Tests needing network interfaces
    @Tag static var processSpawn: Self      // Tests that spawn external processes
    @Tag static var gitRepository: Self     // Tests that need to run in a Git repository
}
```

#### Strategic Test Filtering

```bash
# Run only tests with attachments for debugging
swift test --filter .attachmentTests

# Skip exit tests in CI environments
swift test --skip .exitTests

# Run performance tests with attachments for detailed analysis
swift test --filter .performance --filter .attachmentTests

# Run all tests that require external dependencies
swift test --filter .requiresServerBinary --filter .requiresNetwork

# Run Git repository tests only when in a Git repo
swift test --filter .gitRepository
```

### 13.5 Best Practices for Swift 6.2 Features

#### Exit Tests Guidelines
- **Use Sparingly**: Exit tests are powerful but should be used for critical process lifecycle scenarios
- **Clean State**: Always ensure proper cleanup in exit test blocks
- **Avoid Elevated Permissions**: Don't test operations requiring sudo or admin rights
- **Mock When Possible**: Use mock processes for testing logic without actual system processes

#### Attachment Strategy
- **Contextual Information**: Attach system state, configuration, and environment details
- **Progressive Detail**: Start with summary info, add detailed data as needed
- **Performance Focus**: Use attachments extensively in performance tests for trend analysis
- **Failure Context**: Attach diagnostic info that helps understand why tests failed

#### Condition Trait Design
- **Specific Conditions**: Create focused conditions for specific capabilities
- **Clear Skip Reasons**: Always provide descriptive reasons for skipped tests
- **Environment Awareness**: Consider CI, local development, and different platforms
- **Combine Thoughtfully**: Use multiple conditions when tests have multiple requirements

### Action Items for Swift 6.2 Adoption

- [ ] **Audit Disabled Tests**: Replace broad `.disabled()` with specific condition traits
- [ ] **Add Exit Tests**: Identify critical process lifecycle scenarios and add exit tests
- [ ] **Enhance Debugging**: Add attachments to complex tests and all performance tests
- [ ] **Update Tag Strategy**: Add Swift 6.2 tags and update filtering strategies
- [ ] **Create Condition Traits**: Build reusable conditions for common system requirements
- [ ] **Document Skip Reasons**: Ensure all conditional tests have clear skip explanations
- [ ] **CI Integration**: Update CI scripts to handle new test filtering and skip reasons

---

## **Appendix: Evergreen Testing Principles (The F.I.R.S.T. Principles)**

These foundational principles are framework-agnostic, and Swift Testing is designed to make adhering to them easier than ever.

| Principle | Meaning | Swift Testing Application |
|---|---|---|
| **Fast** | Tests must execute in milliseconds. | Lean on default parallelism. Use `.serialized` sparingly. |
| **Isolated**| Tests must not depend on each other. | Swift Testing enforces this by creating a new suite instance for every test. Random execution order helps surface violations. |
| **Repeatable** | A test must produce the same result every time. | Control all inputs (dates, network responses) with mocks/stubs. Reset state in `init`/`deinit`. |
| **Self-Validating**| The test must automatically report pass or fail. | Use `#expect` and `#require`. Never rely on `print()` for validation. |
| **Timely**| Write tests alongside the production code. | Use parameterized tests (`@Test(arguments:)`) to easily cover edge cases as you write code. |