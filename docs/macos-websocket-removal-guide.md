# macOS WebSocket Configuration Sync Removal Guide

This guide explains how to remove WebSocket-based configuration sync from the macOS app, complementing the server-side changes in PR #439.

## Components to Remove

### 1. RepositoryPathSyncService

The `RepositoryPathSyncService.swift` monitors UserDefaults changes and sends updates via the Unix socket. Since we're removing real-time sync, this service can be simplified or removed entirely.

**Current flow to remove:**
```swift
// In RepositoryPathSyncService.swift
private func observeRepositoryPathChanges() {
    // This observer sends updates to the server when repository path changes
    repositoryPathObserver = UserDefaults.standard.observe(\.repositoryBasePath, options: [.new, .old]) { [weak self] _, change in
        guard let self = self,
              let newValue = change.newValue as? String,
              let oldValue = change.oldValue as? String,
              newValue != oldValue else { return }
        
        // Remove this server update call
        Task {
            await self.updateServerRepositoryPath(newValue)
        }
    }
}
```

**Options:**
1. **Complete removal**: Delete `RepositoryPathSyncService.swift` entirely if it's only used for sync
2. **Simplification**: Keep the service but remove the server update functionality

### 2. SystemControlHandler

In `SystemControlHandler.swift`, remove handling of repository path updates from the server:

```swift
// Remove this case from handleSystemRequest
case "repository-path-update":
    // This entire case can be removed as we no longer receive updates from server
    guard let path = payload["path"] as? String else {
        return ControlResponse(/* error */)
    }
    
    // Remove the temporary sync disable logic
    RepositoryPathSyncService.shared.temporarilyDisableSync()
    UserDefaults.standard.repositoryBasePath = path
    
    return ControlResponse(/* success */)
```

### 3. Unix Socket Message Removal

Remove repository path update messages from being sent to the server:

```swift
// In RepositoryPathSyncService or wherever it's called
private func updateServerRepositoryPath(_ path: String) async {
    // Remove this entire method that sends updates to server
    let message = ControlMessage(
        type: .request,
        category: .system,
        action: "repository-path-update",
        payload: RepositoryPathUpdateRequest(path: path, source: "mac")
    )
    
    // Don't send this message anymore
    // await unixClient.send(message)
}
```

## Simplified Architecture

After removal, the configuration flow becomes:

1. **Mac App → File**: User changes settings, app writes to UserDefaults (no server notification)
2. **File → Server**: Server watches `~/.vibetunnel/config.json` for changes
3. **Server → Web**: Web clients get updated config on page reload via `/api/config`

## Implementation Steps

### Step 1: Remove RepositoryPathSyncService usage

In `VibeTunnelApp.swift` or wherever it's initialized:
```swift
// Remove or comment out
// RepositoryPathSyncService.shared.startMonitoring()
```

### Step 2: Clean up SystemControlHandler

```swift
// SystemControlHandler.swift
func handleSystemRequest(_ message: ControlMessage) async -> ControlResponse {
    switch message.action {
    // Remove "repository-path-update" case
    // Keep other system actions that are still needed
    default:
        return ControlResponse(error: "Unknown system action")
    }
}
```

### Step 3: Remove sync-related UserDefaults extensions

If there are any UserDefaults extensions specifically for sync, remove them:
```swift
// Remove if exists
extension UserDefaults {
    func notifyServerOfRepositoryPathChange() {
        // Remove this method
    }
}
```

### Step 4: Update Settings UI (if needed)

If the settings UI has any real-time sync indicators, remove them:
```swift
// In settings view
// Remove any "Syncing..." or "Connected" status indicators related to config sync
```

## Benefits of Removal

1. **Simpler codebase**: Less complex state management
2. **Fewer race conditions**: No need to handle sync loops
3. **Reduced network traffic**: No constant WebSocket connections
4. **Clearer data flow**: Configuration changes follow a predictable path

## Testing After Removal

1. Change repository path in Mac app settings
2. Verify it's saved to UserDefaults
3. Verify server NO LONGER receives immediate updates
4. Reload web UI and confirm it shows the current path from `/api/config`
5. Verify no WebSocket errors in Console.app
6. Check that Unix socket still works for other operations (terminal control, git, etc.)

## Migration Notes

- Existing users won't notice any change in functionality
- Configuration updates still work, just require page reload
- All other Unix socket functionality remains intact
- This change only affects configuration sync, not terminal operations