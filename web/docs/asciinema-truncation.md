# Asciinema File Truncation

VibeTunnel automatically manages the size of asciinema cast files to prevent performance issues when replaying terminal sessions with large amounts of output.

## Overview

When terminal sessions generate substantial output, the asciinema cast files (stored as `.cast` files) can grow very large. Loading and replaying these files in the web UI can take minutes, making the interface unusable. To address this, VibeTunnel implements automatic file size limiting with intelligent truncation.

## Architecture (Updated 2025-01-10)

**New Architecture**: Truncation logic has been moved to the forwarder (`fwd.ts`) to eliminate race conditions:

- **Forwarder Owns Writing**: Each forwarder process creates and manages its own `AsciinemaWriter`
- **No Shared Access**: Only the forwarder writes to the stdout file, server reads only
- **Hardcoded Limits**: Configuration is hardcoded in the forwarder for simplicity
- **No Race Conditions**: Single process controls both writing and truncation

## Configuration

The truncation behavior is hardcoded in the forwarder (`/web/src/server/fwd.ts`):

```typescript
const asciinemaWriter = AsciinemaWriter.create(
  stdoutPath,
  originalCols || 80,
  originalRows || 24,
  command.join(' '),
  sessionName,
  { TERM: process.env.TERM || 'xterm-256color' },
  {
    maxCastSize: 1 * 1024 * 1024, // 1MB
    castSizeCheckInterval: 60 * 1000, // 60 seconds
    castTruncationTargetPercentage: 0.8, // 80%
  }
);
```

## How It Works

### Forwarder-Based Truncation

1. **Forwarder Creates Writer**: When a session starts, the forwarder creates its own `AsciinemaWriter`
2. **Stdout Interception**: All terminal output is intercepted and written to the file
3. **Periodic Checks**: Every 60 seconds, the writer checks file size
4. **Automatic Truncation**: If file exceeds 1MB, it's truncated to 80% of limit
5. **Server Reads Only**: The server only reads files, never writes or truncates

### Data Flow

```
PTY Process → Forwarder stdout hook → AsciinemaWriter → File
                                           ↓
                                    (Periodic truncation)
                                           
Server → Read file → Stream to browser
```

### Truncation Process

The truncation algorithm (in the forwarder):

1. Checks file size every 60 seconds
2. If file exceeds 1MB, initiates truncation
3. Uses streaming truncator for files >50MB to prevent memory issues
4. Keeps most recent events (up to 80% of max size)
5. Adds truncation marker to indicate removed content
6. Atomically replaces file to prevent corruption

## Memory-Safe Implementation

The `StreamingAsciinemaTrancator` class handles large files efficiently:

- Line-by-line streaming using readline interface
- Memory usage bounded to target size (~1MB)
- Maintains sliding window of recent events
- Atomic file replacement using temp files
- Handles UTF-8 boundaries correctly
- Progress logging for files with >100k lines

## Race Condition Prevention

The new architecture eliminates all race conditions:

1. **Single Writer**: Only the forwarder writes to each stdout file
2. **Coordinated Truncation**: Writer pauses during truncation
3. **No Server Interference**: Server never modifies files
4. **Fast Startup**: No synchronous file operations during server startup

## Server Behavior

The server's role is simplified:

1. **No Recovery**: Server no longer runs `recoverExistingSessions()`
2. **Read-Only Access**: Server only reads stdout files when requested
3. **No Truncation**: Server never truncates or modifies files
4. **Fast Startup**: No blocking file operations during initialization

## File Format Preservation

The asciinema cast format is preserved during truncation:

- The header line (containing version, dimensions, etc.) is always retained
- Event timestamps remain valid
- Truncation markers are added as special marker events (type 'm')
- The file remains playable in any asciinema-compatible player

## Truncation Markers

When truncation occurs, a marker event is added:

```json
[123.45, "m", "[... earlier output truncated (removed 50 events) ...]"]
```

## Performance Impact

### Truncated File Statistics

With 1MB truncation limit and 80% target, files contain approximately:
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

- **No Startup Delay**: Server starts immediately without file processing
- **Isolated Truncation**: Each forwarder manages its own file independently
- **Write Queue**: All pending writes complete before truncation begins
- **Minimal Overhead**: Truncation only occurs when necessary

## Error Handling

The system handles various error scenarios gracefully:

- **Read Errors**: If the file can't be read, truncation is skipped
- **Write Errors**: Failed truncations are logged but don't crash the session
- **Malformed Files**: Invalid JSON lines are handled during truncation
- **Large Files**: Files over 50MB use streaming to prevent OOM
- **Forwarder Crashes**: Files remain readable by the server

## Monitoring

You can monitor truncation activity through forwarder logs:

```
[FWD] AsciinemaWriter] Existing cast file /path/to/file.cast is 1258291 bytes (exceeds 1048576), will truncate before opening
[FWD] AsciinemaWriter] Successfully truncated /path/to/file.cast on startup, removed 215 events
[FWD] AsciinemaWriter] Cast file /path/to/file.cast exceeds limit (1153433 bytes), truncating to 1048576 bytes
[FWD] StreamingAsciinemaTrancator] Starting streaming truncation of /path/to/file (875.12MB)
[FWD] StreamingAsciinemaTrancator] Successfully truncated /path/to/file: 875.12MB → 0.80MB (removed 125455 events in 5234ms)
```

## Best Practices

1. **Size Limit**: The 1MB limit balances history retention with performance
2. **Check Interval**: 60-second checks minimize overhead while ensuring timely truncation
3. **Target Percentage**: 80% ensures some headroom after truncation
4. **Forwarder Management**: Each forwarder independently manages its file

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

3. Check forwarder logs:
   ```bash
   # Look for truncation messages
   tail -f ~/.vibetunnel/control/*/fwd.log | grep -E "truncat|AsciinemaWriter"
   ```

## Benefits of New Architecture

1. **No Race Conditions**: Single process owns each file
2. **Fast Server Startup**: No synchronous file operations
3. **Data Integrity**: Writer controls when truncation happens
4. **Simplified Server**: Server code is cleaner and more focused
5. **Independent Sessions**: Each forwarder manages its own resources

## Implementation Details

The truncation feature is implemented in:
- `/web/src/server/fwd.ts` - Forwarder with AsciinemaWriter creation
- `/web/src/server/pty/asciinema-writer.ts` - Core truncation logic with configurable limits
- `/web/src/server/pty/streaming-truncator.ts` - Memory-safe streaming truncation
- `/web/src/server/pty/pty-manager.ts` - Simplified without recovery logic
- `/web/src/test/unit/asciinema-writer.test.ts` - Comprehensive test coverage

The implementation ensures:
- No data loss for recent terminal output
- No race conditions between reader and writer
- Minimal performance impact on active sessions
- Compatibility with the asciinema format specification
- Memory-safe processing of arbitrarily large files