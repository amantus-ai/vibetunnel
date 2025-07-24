# Disabled Test Note

## Date: 2025-01-24

### Test Disabled
- `worktree-workflows-refactored.test.ts` → `worktree-workflows-refactored.test.ts.disabled`

### Reason
This test is suspected to cause Out of Memory (OOM) crashes that kill ALL VibeTunnel instances.

### Investigation Summary
- E2E tests were verified to NOT cause crashes (13 tests checked individually)
- This integration test creates multiple TestServer instances with heavy services
- Sessions are not properly cleaned up (SESSION_NOT_FOUND errors observed)
- Crash reports show V8 heap allocation failures during object enumeration

### To Re-enable
1. Rename the file back: `mv worktree-workflows-refactored.test.ts.disabled worktree-workflows-refactored.test.ts`
2. Implement proper cleanup in afterEach/afterAll hooks:
   - Kill all sessions created during tests
   - Clear accumulated buffers
   - Properly dispose of TestServer instances
   - Consider running with increased memory: `NODE_OPTIONS="--max-old-space-size=8192"`

### Related Issue
See `web/crash.md` for full crash analysis and proposed fixes.