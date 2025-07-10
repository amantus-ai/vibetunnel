# Asciinema File Truncation

VibeTunnel automatically manages the size of asciinema cast files to prevent performance issues when replaying terminal sessions with large amounts of output.

## Overview

When terminal sessions generate substantial output, the asciinema cast files (stored as `.cast` files) can grow very large. Loading and replaying these files in the web UI can take minutes, making the interface unusable. To address this, VibeTunnel implements automatic file size limiting with intelligent truncation.

## Configuration

The truncation behavior is configured in `/web/src/server/config.ts`:

```typescript
export const config = {
  // Maximum size for asciinema cast files (stdout)
  MAX_CAST_SIZE: 100 * 1024, // 100KB
  
  // How often to check cast file size (in milliseconds)
  CAST_SIZE_CHECK_INTERVAL: 60 * 1000, // 1 minute
  
  // When truncating, what percentage of the max size to keep
  CAST_TRUNCATION_TARGET_PERCENTAGE: 0.8, // 80%
};
```

## How It Works

### Startup Truncation

When the server starts or a new session begins, VibeTunnel checks if existing cast files exceed the size limit. If they do, the files are truncated before the session starts recording:

1. The system checks the file size before opening the write stream
2. If the file exceeds `MAX_CAST_SIZE`, it's truncated synchronously
3. Only the most recent events are kept (up to 80% of the max size)
4. A truncation marker is added to indicate events were removed

### Runtime Truncation

During active sessions, the file size is checked periodically:

1. A timer runs every `CAST_SIZE_CHECK_INTERVAL` (default: 60 seconds)
2. If the file exceeds `MAX_CAST_SIZE`, asynchronous truncation begins
3. The write queue is drained to ensure no data loss
4. Recent events are preserved while older ones are removed
5. A truncation marker event is inserted to indicate the truncation

### Truncation Process

The truncation algorithm:

1. Reads the entire cast file
2. Separates the header (first line) from events
3. Calculates how many events to keep based on `CAST_TRUNCATION_TARGET_PERCENTAGE`
4. Keeps events from the end of the file (most recent)
5. Adds a truncation marker event
6. Writes the truncated content back to the file
7. Reopens the stream for continued appending

## File Format Preservation

The asciinema cast format is preserved during truncation:

- The header line (containing version, dimensions, etc.) is always retained
- Event timestamps remain valid
- Truncation markers are added as special marker events (type 'm')
- The file remains playable in any asciinema-compatible player

## Truncation Markers

When truncation occurs, a marker event is added:

```json
[0, "m", "[Truncated 85 events on startup to limit file size]"]
```

Or during runtime:

```json
[123.45, "m", "[Truncated 50 events to limit file size]"]
```

## Performance Impact

- **Startup**: Synchronous truncation ensures files are within limits before use
- **Runtime**: Asynchronous truncation minimizes impact on active sessions
- **Write Queue**: All pending writes complete before truncation begins
- **File I/O**: Truncation only occurs when necessary (file exceeds limit)

## Error Handling

The system handles various error scenarios gracefully:

- **Read Errors**: If the file can't be read, truncation is skipped
- **Write Errors**: Failed truncations are logged but don't crash the session
- **Malformed Files**: Invalid JSON lines are handled during truncation
- **Concurrent Writes**: The write queue ensures data integrity

## Monitoring

You can monitor truncation activity through server logs:

```
[SRV] AsciinemaWriter] Existing cast file /path/to/file.cast is 7944 bytes (exceeds 1024), will truncate before opening
[SRV] AsciinemaWriter] Successfully truncated /path/to/file.cast on startup, removed 91 events
[SRV] AsciinemaWriter] Cast file /path/to/file.cast exceeds limit (1480 bytes), truncating to 1024 bytes
```

## Best Practices

1. **Size Limit**: The default 100KB limit balances history retention with performance
2. **Check Interval**: 60-second checks minimize overhead while ensuring timely truncation
3. **Target Percentage**: 80% ensures some headroom after truncation
4. **Testing**: Use the test suite to verify truncation behavior with different scenarios

## Implementation Details

The truncation feature is implemented in:
- `/web/src/server/pty/asciinema-writer.ts` - Core truncation logic
- `/web/src/server/config.ts` - Configuration values
- `/web/src/test/unit/asciinema-writer.test.ts` - Comprehensive test coverage

The implementation ensures:
- No data loss for recent terminal output
- Minimal performance impact on active sessions
- Compatibility with the asciinema format specification
- Graceful handling of edge cases and errors