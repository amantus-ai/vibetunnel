# Asciicast Pruning in VibeTunnel

## Overview

VibeTunnel implements an intelligent pruning system to prevent session recordings from growing indefinitely. This is critical for long-running terminal sessions (like Claude Code sessions) that can generate gigabytes of output over time. The pruning system detects terminal clear operations and uses them as safe points to discard old content.

## The Problem

Terminal sessions can run for hours or days, generating massive amounts of output:
- A typical Claude Code session can produce 100MB+ of output per hour
- Without pruning, session files can grow to several gigabytes
- Large files cause performance issues for streaming and playback
- Most of the old content is no longer relevant after screen clears

## How Pruning Works

### 1. Real-time Detection During Recording

When a PTY session is created (in the forwarder process), the `AsciinemaWriter` monitors all terminal output for pruning sequences:

```typescript
// In AsciinemaWriter.writeOutput()
const detection = detectLastPruningSequence(processedData);
if (detection) {
  const exactPosition = calculateSequenceBytePosition(...);
  this.pruningCallback({
    sequence: detection.sequence,
    position: exactPosition,
    timestamp: time
  });
}
```

### 2. Pruning Sequences

The system recognizes these ANSI escape sequences as safe pruning points:

- `\x1b[3J` - Clear scrollback buffer (most common in modern terminals)
- `\x1bc` - Terminal reset (RIS - Reset to Initial State)
- `\x1b[2J` - Clear screen
- `\x1b[H\x1b[J` - Home cursor + clear (older pattern)
- `\x1b[H\x1b[2J` - Home cursor + clear screen variant
- `\x1b[?1049h` - Enter alternate screen (vim, less, etc)
- `\x1b[?1049l` - Exit alternate screen
- `\x1b[?47h` - Save screen and enter alternate screen (legacy)
- `\x1b[?47l` - Restore screen and exit alternate screen (legacy)

### 3. Byte Position Tracking

The `AsciinemaWriter` maintains precise byte position tracking:

```typescript
private bytesWritten: number = 0;  // Bytes actually written to disk
private pendingBytes: number = 0;  // Bytes queued but not yet written

getPosition(): { written: number; pending: number; total: number } {
  return {
    written: this.bytesWritten,
    pending: this.pendingBytes,
    total: this.bytesWritten + this.pendingBytes
  };
}
```

This is crucial because:
- Asciinema files use JSON encoding, which changes byte counts
- UTF-8 encoding means character count ≠ byte count
- We need exact byte positions to safely resume streaming

### 4. Position Calculation

When a pruning sequence is detected, we calculate its exact byte position in the file:

```typescript
function calculateSequenceBytePosition(
  eventStartPos: number,    // Where this event starts in the file
  timestamp: number,        // Event timestamp
  fullData: string,         // Complete output data
  sequenceIndex: number,    // Character index of sequence in data
  sequenceLength: number    // Length of the sequence
): number {
  // Calculate data up to sequence end
  const dataUpToSequenceEnd = fullData.substring(0, sequenceIndex + sequenceLength);
  
  // Create event prefix: [timestamp,"o","
  const eventPrefix = JSON.stringify([timestamp, 'o', '']).slice(0, -1);
  const prefixBytes = Buffer.from(eventPrefix, 'utf8').length;
  
  // Calculate bytes for data portion
  const sequenceBytesInData = Buffer.from(dataUpToSequenceEnd, 'utf8').length;
  
  return eventStartPos + prefixBytes + sequenceBytesInData;
}
```

### 5. Storing Pruning Information

When a pruning sequence is detected, the `PtyManager` updates the session info:

```typescript
asciinemaWriter.onPruningSequence(async ({ sequence, position }) => {
  const sessionInfo = this.sessionManager.loadSessionInfo(sessionId);
  if (sessionInfo) {
    sessionInfo.lastClearOffset = position;
    await this.sessionManager.saveSessionInfo(sessionId, sessionInfo);
  }
});
```

### 6. Using Pruning During Playback

When a client connects to follow a session, the `CastOutputHub`:

1. Reads the stored `lastClearOffset` from session info
2. Starts reading the asciicast file from that position instead of the beginning
3. This skips all the old content before the last clear

```typescript
// In CastOutputHub.sendExistingContent()
const sessionInfo = this.sessionManager.loadSessionInfo(sessionId);
let startOffset = sessionInfo?.lastClearOffset ?? 0;

const analysisStream = fs.createReadStream(streamPath, {
  encoding: 'utf8',
  start: startOffset,  // Start from last clear position
});
```

### 7. Retroactive Pruning Detection

The `CastOutputHub` also scans for pruning sequences when analyzing existing content:

```typescript
if (isOutputEvent(event) && containsPruningSequence(event[2])) {
  const clearResult = this.processClearSequence(
    event as AsciinemaOutputEvent,
    events.length,
    fileOffset,
    currentResize,
    line
  );
  if (clearResult) {
    lastClearIndex = clearResult.lastClearIndex;
    lastClearOffset = clearResult.lastClearOffset;
  }
}
```

This handles cases where:
- A session was recorded without pruning detection
- Multiple clear sequences exist in the buffered content
- We need to find the most recent clear point

## Architecture

### Component Responsibilities

1. **PruningDetector** (`utils/pruning-detector.ts`)
   - Single source of truth for pruning sequences
   - Provides detection and position calculation functions
   - Ensures consistency between components

2. **AsciinemaWriter** (`pty/asciinema-writer.ts`)
   - Real-time detection during recording
   - Precise byte position tracking
   - Invokes callbacks when sequences detected

3. **PtyManager** (`pty/pty-manager.ts`)
   - Registers pruning callbacks
   - Updates session info with clear offsets
   - Coordinates between writer and session manager

4. **CastOutputHub** (`services/cast-output-hub.ts`)
   - Uses stored pruning offsets for efficient follow/initial replay
   - Performs retroactive detection on existing content
   - Handles replay from pruning points

### Data Flow

```
Terminal Output
    ↓
AsciinemaWriter (in forwarder process)
    ├─→ Writes to .cast file
    └─→ Detects pruning sequences
            ↓
        PtyManager
            ├─→ Updates session.json with lastClearOffset
            └─→ Logs detection
            
When client connects:
    ↓
CastOutputHub (in server process)
    ├─→ Reads lastClearOffset from session.json
    └─→ Starts streaming from that position
```

## Benefits

1. **Prevents Unbounded Growth**: Session files stay manageable even for long-running sessions
2. **Improves Performance**: Clients don't need to download/process gigabytes of old data
3. **Preserves User Experience**: Users see current terminal state, not irrelevant history
4. **Automatic**: Works transparently without user intervention
5. **Safe**: Only prunes at explicit clear points, never loses important data

## Testing

The pruning system includes comprehensive tests:

1. **Unit Tests** (`test/unit/pruning-detector.test.ts`)
   - Sequence detection accuracy
   - Byte position calculation
   - UTF-8 handling

2. **Integration Tests** (`test/unit/asciinema-writer.test.ts`)
   - Real-time detection during writes
   - Callback timing and accuracy
   - File position validation

## Debugging

To debug pruning:

1. Check for pruning detection in logs:
   ```bash
   grep -i "pruning" ~/.vibetunnel/log.txt
   ```

2. Verify session info:
   ```bash
   cat ~/.vibetunnel/sessions/*/session.json | jq .lastClearOffset
   ```

3. Enable debug logging to see detailed pruning calculations:
   ```bash
   export VIBETUNNEL_VERBOSITY=debug
   ```

## Limitations

1. **Requires Forwarder Restart**: Pruning runs in the forwarder process, so existing sessions won't benefit until restarted
2. **Clear Sequence Dependent**: Only prunes when terminal is explicitly cleared
3. **No Manual Pruning**: Currently no way to manually trigger pruning
4. **Single Pruning Point**: Only tracks the most recent clear, not multiple checkpoints

## Future Improvements

1. **Multiple Checkpoints**: Track several pruning points for more granular history
2. **Time-based Pruning**: Prune content older than X hours
3. **Size-based Pruning**: Trigger pruning when file exceeds certain size
4. **Compression**: Compress old segments instead of discarding
5. **Manual Pruning API**: Allow users to explicitly mark pruning points

## Performance Analysis: Old vs New Pruning Logic (2025-07-27)

### Old Implementation (Before commit 627309ebf)

**Architecture:**
- Pruning detection was **duplicated** in 3 places:
  1. `pty-manager.ts` - During data write (imprecise)
  2. `stream-watcher.ts` - During playback (retroactive)
  3. Inline sequence definitions in multiple files

**Performance Issues:**
1. **Double Processing**: Data was scanned for pruning sequences twice:
   - Once in pty-manager during write (but couldn't calculate accurate positions)
   - Again in stream-watcher during playback
2. **Inefficient String Searching**: Multiple `lastIndexOf()` calls on potentially large strings
3. **Imprecise Byte Calculations**: PTY manager couldn't track exact byte positions
4. **Memory Overhead**: Entire file had to be re-read and parsed during playback

### New Implementation (After commit 627309ebf)

**Architecture:**
- Centralized pruning detection in `pruning-detector.ts`
- Real-time detection in `asciinema-writer.ts`
- Precise byte position tracking

**Performance Improvements:**

1. **Single-Pass Detection**: 
   - Pruning sequences detected **once** during write
   - Exact byte positions calculated and potentially stored
   - No need to re-scan during playback

2. **Optimized Detection**:
   ```typescript
   // New centralized detection
   export function detectLastPruningSequence(data: string): PruningDetectionResult | null {
     let lastIndex = -1;
     let lastSequence = '';
     
     for (const sequence of PRUNE_SEQUENCES) {
       const index = data.lastIndexOf(sequence);
       if (index > lastIndex) {
         lastIndex = index;
         lastSequence = sequence;
       }
     }
     // Single pass through sequences
   }
   ```

3. **Precise Byte Tracking**:
   ```typescript
   // New precise calculation
   export function calculateSequenceBytePosition(
     eventStartPos: number,
     timestamp: number,
     fullData: string,
     sequenceIndex: number,
     sequenceLength: number
   ): number {
     // Exact byte-level calculation
   }
   ```

### Performance Comparison

| Aspect | Old Logic | New Logic | Improvement |
|--------|-----------|-----------|-------------|
| **Detection Timing** | Retroactive (on playback) | Real-time (on write) | ✅ No playback delay |
| **Processing Passes** | 2 (write + read) | 1 (write only) | ✅ 50% reduction |
| **Byte Accuracy** | Approximate | Exact | ✅ Precise pruning |
| **Memory Usage** | Re-read entire file | Stream processing | ✅ Lower memory |
| **CPU Usage** | O(n) on each client connect | O(1) lookup | ✅ Much faster |
| **Code Duplication** | 3 implementations | 1 centralized | ✅ Maintainable |

### Real-World Impact

For a session with 18MB of data (like the example log showing offset 18,223,170):

**Old System:**
- Client connects → Read 18MB file → Scan for pruning sequences → Skip 20k events
- Time: ~100-500ms depending on disk speed

**New System:**
- Client connects → Read pre-calculated offset → Start streaming from position
- Time: ~1-10ms

### Conclusion

The new pruning logic is **significantly faster** because:
1. **Eliminates redundant processing** - Detection happens once, not on every playback
2. **Reduces I/O** - No need to read/parse the entire file to find prune points
3. **Improves scalability** - O(1) vs O(n) for client connections
4. **Better accuracy** - Exact byte positions prevent edge cases

The performance improvement is especially noticeable for:
- Large session files (10MB+)
- Multiple concurrent viewers
- Sessions with many clear operations
