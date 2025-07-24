# E2E Test Crash Investigation

Running each e2e test individually to identify which test crashes node.

## Test Results

### ✅ Completed Tests (did not crash node)
1. minimal-session.spec.ts - Completed with errors but did not crash
2. test-session-persistence.spec.ts - Completed with errors but did not crash
3. activity-monitoring.spec.ts - Completed with errors but did not crash
4. session-navigation.spec.ts - 2 failed, 1 skipped, did not crash
5. authentication.spec.ts - 12 failed, did not crash
6. debug-session.spec.ts - 1 failed, did not crash
7. file-browser.spec.ts - No tests found, did not crash

### ✅ Completed Tests (did not crash node)
1. minimal-session.spec.ts - Completed with errors but did not crash
2. test-session-persistence.spec.ts - Completed with errors but did not crash
3. activity-monitoring.spec.ts - Completed with errors but did not crash
4. session-navigation.spec.ts - 2 failed, 1 skipped, did not crash
5. authentication.spec.ts - 12 failed, did not crash
6. debug-session.spec.ts - 1 failed, did not crash
7. file-browser.spec.ts - No tests found, did not crash
8. basic-session.spec.ts - 3 failed, did not crash

9. file-browser-basic.spec.ts - 10 failed, did not crash
10. push-notifications.spec.ts - 11 failed, did not crash
11. session-creation.spec.ts - 4 failed, 1 skipped, did not crash
12. session-management-advanced.spec.ts - (not tested yet)
13. session-management.spec.ts - (not tested yet)
14. terminal-interaction.spec.ts - **HANGS/TIMES OUT** ⏱️ (not an actual crash)

### ⚠️ UPDATE: NOT A CRASH
**terminal-interaction.spec.ts** causes the test to hang and timeout after 2 minutes, but does NOT actually crash Node.js.
- No crash reports found in system logs for today
- The test process hangs but doesn't terminate
- Need to continue testing other files to find the actual crash

## Summary

The crash occurs when running `terminal-interaction.spec.ts`. This test file contains various terminal interaction tests including:
- Basic command execution
- Command interruption (Ctrl+C)
- Terminal clearing
- File system navigation
- Environment variables
- Terminal resizing
- ANSI colors and formatting

The crash likely happens during one of these test scenarios. The test file has 11 test cases that interact heavily with the terminal through keyboard input and command execution.

## Crash Confirmation

When running `terminal-interaction.spec.ts` again:
- The test hangs/times out after 2 minutes
- Multiple test cases fail with timeout errors
- The process appears to hang rather than crash immediately
- Tests that failed before timeout:
  1. should execute basic commands
  2. should handle command with special characters
  3. should execute multiple commands in sequence
  4. should handle long-running commands
  5. should handle command interruption
  6. should clear terminal screen
  7. should handle file system navigation
  8. should handle environment variables

The crash/hang appears to occur around test #8 or #9 based on the output.

### 🔄 Currently Testing
13. session-management.spec.ts

### 📋 Remaining Tests to Run
11. session-creation.spec.ts
12. session-management-advanced.spec.ts
13. session-management.spec.ts
15. file-browser-session-create.spec.ts
16. session-management-global.spec.ts
17. ssh-key-manager.spec.ts
18. ui-features.spec.ts
19. keyboard-shortcuts.spec.ts