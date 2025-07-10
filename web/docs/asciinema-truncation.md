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

Note: In production, these values are typically:
- `MAX_CAST_SIZE`: 100MB (104857600 bytes)
- `MAX_TRUNCATED_SIZE`: 1MB (1048576 bytes)
- `TRUNCATION_CHECK_INTERVAL`: 30 seconds (30000 ms)

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

## Memory Issue Resolution (2025-01-10)

**Problem**: The original implementation caused server crashes (OOM) when truncating very large files:
- 875MB file caused immediate memory exhaustion
- `fs.readFile()` loaded entire file into memory
- Server terminated with: `JavaScript heap out of memory`

**Solution**: Implemented `StreamingAsciinemaTrancator` class:
- Line-by-line streaming processing using readline interface
- Memory usage bounded to target size (~1MB) plus small buffers
- Maintains sliding window of recent events
- Atomic file replacement using temp files
- Handles UTF-8 boundaries correctly

**Implementation Details**:
- Located in `src/server/pty/streaming-truncator.ts`
- Synchronous truncation limited to files <50MB
- Larger files automatically use async streaming
- Progress logging every 100k lines for monitoring

## Server Restart Behavior

### Tested Behavior (2025-01-10)

During server restart, the truncation logic processes existing sessions:

1. **Session Recovery**: On startup, `recoverExistingSessions()` is called
2. **Selective Processing**: Only sessions with status `'running'` are recovered
3. **Automatic Truncation**: Creating an `AsciinemaWriter` for recovered sessions triggers size checks

### Test Results

From our production test with 31 asciicast files:

**Before Restart:**
- 4 files > 100MB (153MB, 426MB, 614MB, 875MB)
- 11 files between 10-100MB
- 16 files < 10MB

**After Restart:**
- 8 files successfully truncated to ~819KB
- 2 files NOT truncated (426MB, 614MB)
- Reason: These had status `'exited'` and were skipped by recovery logic

**Key Finding**: Only `'running'` sessions are truncated on restart. This is intentional as exited sessions will be cleaned up in future updates rather than truncated.

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

### Truncated File Statistics

With 1MB truncation limit, files contain approximately:
- **950-1,060 events** (lines of terminal output)
- Actual file size: ~819KB after truncation
- Sufficient history for debugging and context

### Compression Benefits

The server uses Express compression middleware:
- Automatically compresses responses with `gzip/deflate/brotli`
- Asciicast files (JSON) compress very well (70-90% reduction)
- 819KB file → ~100-200KB over the wire
- Transparent to clients (browsers handle decompression)

### Runtime Performance

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
- **Large Files**: Files over 50MB use streaming to prevent OOM

## Monitoring

You can monitor truncation activity through server logs:

```
[SRV] AsciinemaWriter] Existing cast file /path/to/file.cast is 7944 bytes (exceeds 1024), will truncate before opening
[SRV] AsciinemaWriter] Successfully truncated /path/to/file.cast on startup, removed 91 events
[SRV] AsciinemaWriter] Cast file /path/to/file.cast exceeds limit (1480 bytes), truncating to 1024 bytes
[SRV] StreamingAsciinemaTrancator] Starting streaming truncation of /path/to/file (875.12MB)
[SRV] StreamingAsciinemaTrancator] Successfully truncated /path/to/file: 875.12MB → 0.80MB (removed 125455 events in 5234ms)
```

## Best Practices

1. **Size Limit**: The default 100MB limit balances history retention with performance
2. **Check Interval**: 30-second checks minimize overhead while ensuring timely truncation
3. **Target Percentage**: 80% ensures some headroom after truncation
4. **Testing**: Use the test suite to verify truncation behavior with different scenarios

## Testing

To test truncation:

1. Create a large asciicast file:
   ```bash
   # Generate large output in a VibeTunnel session
   while true; do echo "Test line $RANDOM"; done
   ```

2. Monitor file growth:
   ```bash
   watch -n 5 'ls -lh ~/.vibetunnel/control/*/stdout | sort -k5 -h'
   ```

3. Restart server and check logs:
   ```bash
   # Check truncation in logs
   grep -E "truncat|AsciinemaWriter" ~/.vibetunnel/log.txt
   ```

## Known Issues

1. **Background Sessions**: Some sessions may fail truncation if actively writing
2. **Race Conditions**: Rapid writes during truncation may cause temporary errors

## Future Improvements

1. **Configurable History**: Allow users to set how much history to preserve
2. **Exited Session Cleanup**: Implement automatic removal of old exited sessions
3. **Metrics**: Add monitoring for truncation frequency and performance
4. **Compression**: Consider storing older events in compressed format

## Implementation Details

The truncation feature is implemented in:
- `/web/src/server/pty/asciinema-writer.ts` - Core truncation logic
- `/web/src/server/pty/streaming-truncator.ts` - Memory-safe streaming truncation
- `/web/src/server/config.ts` - Configuration values
- `/web/src/server/pty/pty-manager.ts` - Session recovery logic
- `/web/src/test/unit/asciinema-writer.test.ts` - Comprehensive test coverage
- `/web/src/test/unit/stream-pruning.test.ts` - Stream pruning tests

The implementation ensures:
- No data loss for recent terminal output
- Minimal performance impact on active sessions
- Compatibility with the asciinema format specification
- Graceful handling of edge cases and errors
- Memory-safe processing of arbitrarily large files