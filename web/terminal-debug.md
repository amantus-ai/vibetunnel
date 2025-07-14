# Terminal Performance & Layout Debug Report

## Issue Overview
The user reported two main problems:
1. **Slow replay performance**: Terminal replaying entire streams taking several seconds with visible scrolling
2. **Header layout shifts**: Terminal content changes causing the session header to become wider/narrower during rendering

## Server-Side Performance Issues

### Root Cause: Pending Lines Limit
**Warning**: `Pending lines limit reached for session fwd_1752355446753. Dropping new data to prevent memory overflow.`

**Location**: `/Users/steipete/Projects/vibetunnel/web/src/server/services/terminal-manager.ts:393`

**Problem**: 
- Server pauses data processing when terminal buffer reaches 80% capacity (highWatermark)
- During replay scenarios, client can't consume data fast enough
- Pending lines queue fills up to 10,000 lines and starts dropping data
- This creates a cycle of pausing, filling queue, dropping data, repeat

### Original Configuration (BEFORE fixes):
```typescript
const FLOW_CONTROL_CONFIG = {
  highWatermark: 0.8,        // Pause at 80% buffer full
  lowWatermark: 0.5,         // Resume at 50% buffer full  
  maxPendingLines: 10000,    // Drop data after 10K pending lines
  checkInterval: 100,        // Check every 100ms
  bufferCheckInterval: 100,  // Check every 100 lines
};
```

## Optimizations Implemented

### 1. Server Flow Control Improvements
**File**: `src/server/services/terminal-manager.ts`

**Changes Made**:
```typescript
const FLOW_CONTROL_CONFIG = {
  highWatermark: 0.9,        // 80% → 90% (more buffer usage before pausing)
  lowWatermark: 0.7,         // 50% → 70% (reduce pause/resume cycling)
  maxPendingLines: 50000,    // 10K → 50K (handle high-volume scenarios)
  checkInterval: 50,         // 100ms → 50ms (faster resumption)
  bufferCheckInterval: 200,  // 100 → 200 lines (reduce overhead)
};
```

### 2. Smart Line Dropping Implementation ⚠️ UPDATED
**Function**: `shouldDropLineIntelligently()` (lines 310-348)

**CONSERVATIVE LOGIC** (Fixed after empty terminal issue):
- **Never drop**: Headers, resize events, exit events, clear screen commands
- **Drop 30%**: Only very short output (<10 chars, no escape sequences) when queue >95% full (>47.5K pending lines)
- **Keep**: ALL other content including escape sequences and longer output

**Critical Commands Preserved**:
```typescript
// Never drop these ANSI sequences:
- '\x1b[2J'     // clear screen
- '\x1b[H'      // cursor home  
- '\x1b[?1049h' // alternate screen
- '\x1b[?1049l' // exit alternate screen
```

### 3. Batched Processing
**Function**: `processPendingLinesBatched()` (lines 271-304)

**Improvements**:
- Process pending lines in batches (50-100 at a time)
- Use `setImmediate()` between batches to avoid blocking event loop
- Larger batch sizes for high-volume scenarios (>1000 pending lines)

### 4. Client-Side Adaptive Processing
**File**: `src/client/components/terminal.ts`

**Changes**:
```typescript
// Adaptive frame time based on queue size
const queueSize = this.operationQueue.length;
const MAX_FRAME_TIME = queueSize > 100 ? 8 : queueSize > 50 ? 12 : 16;
```

**Performance Targets**:
- Large queues (>100 ops): 8ms = ~120fps processing
- Medium queues (50-100): 12ms = ~80fps processing  
- Small queues (<50): 16ms = ~60fps processing

## Layout Issues Investigation

### Problem: Header Width Changes
**Symptom**: "I saw the header becoming a little bit wider. Like the session name had one letter more in the truncation"

**Root Cause**: Terminal content changes affecting overall layout flow despite CSS constraints

### Previous Attempts (PARTIAL SUCCESS):
1. **CSS Width Constraints**: Added `width: 100%; max-width: 100%; overflow-x: auto;`
2. **CSS Containment**: Tried `contain: layout style;` but caused sizing issues
3. **Layout Isolation**: Forced layout recalculation with `void container.offsetHeight`

### Current Solution: Grid Layout Isolation
**File**: `src/client/components/session-view.ts:1275`

**Implementation**:
```css
/* Main container: Grid layout instead of flexbox */
display: grid; 
grid-template-rows: auto 1fr;

/* Terminal container: Complete isolation */
contain: layout style size;
will-change: auto;
isolation: isolate;
```

**Theory**: Grid layout with `auto 1fr` ensures header gets exactly the space it needs, and terminal gets remaining space. CSS containment prevents terminal changes from affecting parent layout.

## Replay Stream Optimization (ALREADY IMPLEMENTED!)

### Existing Smart Replay Feature
**File**: `src/server/services/stream-watcher.ts:154-291`

**Current Implementation**:
- Scans entire asciinema file for last clear signal (`\x1b[3J`)
- Starts replay from after last clear: `startIndex = lastClearIndex + 1`
- Preserves terminal dimensions from last resize before clear
- Logs optimization: "pruning stream: skipping X events before last clear"

**Test Coverage**: Comprehensive tests in `src/test/unit/stream-pruning.test.ts`

### Potential Enhancement Needed
**Current Detection**: Only `\x1b[3J` clear sequences
**Missing**: Other common clear patterns like `\x1b[2J`, `\x1b[H\x1b[2J`

**Proposed Enhancement**:
```typescript
const clearSequences = [
  '\x1b[3J',        // Current: clear entire screen and scrollback
  '\x1b[2J',        // Clear entire screen
  '\x1b[2J\x1b[H',  // Clear screen + cursor home
  '\x1b[H\x1b[2J',  // Cursor home + clear screen
];
const hasClear = clearSequences.some(seq => event[2].includes(seq));
```

## Race Condition Fix (RESOLVED)

### Mobile Terminal Rendering Issue
**Problem**: Terminal not fully rendering on mobile load, missing bottom rows
**Symptom**: "Kinda like I scrolled up but I didn't scroll up"

**Root Cause**: Container height was 0 during initial layout, causing actualRows to calculate as 6 (minimum) instead of proper value

**Solution**: Added layout forcing operations that inadvertently fixed the race condition
```typescript
// Force layout recalculation for mobile container sizing
if (this.container) {
  void this.container.offsetHeight;
  void this.container.clientHeight;
  void this.container.getBoundingClientRect();
}
```

**User Observation**: "now it seems to work reliable, because we added logging???"
**Explanation**: Console.log operations force DOM layout recalculation/reflow, ensuring container has proper dimensions before terminal sizing calculations.

## Performance Monitoring

### Key Metrics to Watch
1. **Server Warnings**: "Pending lines limit reached" should be eliminated/rare
2. **Client Processing**: Operation queue size and processing time logs
3. **Replay Speed**: Time from replay start to completion
4. **Layout Stability**: Header width should remain constant during terminal updates

### Debug Commands
```typescript
// Server-side: Check flow control status
logger.log(`Buffer utilization: ${bufferUtilization}%, pending: ${pendingLines.length}`);

// Client-side: Monitor operation queue
console.log(`Processed ${operationsProcessed} operations in ${processingTime}ms`);
```

## Critical Issue: Infinite Terminal Spinning (RESOLVED)

### Problem  
**User Report**: "the terminal seems to be in a mode where it keeps spinning the whole time... the render counter goes up"

**Root Cause**: Operation queue infinite loop in `src/client/components/terminal.ts:95-143`

**Sequence**:
1. `requestRenderBuffer()` adds empty operations to the queue (just logs debug message)
2. `processOperationQueue()` processes operations but yields due to time limits
3. Yielding schedules another `processOperationQueue()` call via `requestAnimationFrame()`
4. `renderPending` flag never clears because queue keeps getting new empty operations
5. Creates infinite recursive loop with continuous render counter increments

### Solution Applied
**File**: `src/client/components/terminal.ts:110-113`

**Before (BROKEN)**:
```typescript
private requestRenderBuffer() {
  logger.debug('Requesting render buffer update');
  this.queueRenderOperation(() => {
    logger.debug('Executing render operation'); // Empty operation causing infinite queue
  });
}
```

**After (FIXED)**:
```typescript
private requestRenderBuffer() {
  // Directly render buffer instead of queuing empty operations
  this.renderBuffer();
}
```

**Why This Works**:
- Eliminates empty operations that served no purpose except to trigger infinite loops
- Momentum animation already uses direct `renderBuffer()` calls (line 1214: "avoid RAF conflicts")
- Direct rendering is safer and more efficient than queuing no-op operations

## Critical Issue: Empty Terminal (RESOLVED)

### Problem
**User Report**: "we even got to the state where there is no content. The template didn't finish rendering"

**Root Cause**: Original smart line dropping was too aggressive:
- Dropped 80% of output events when queue >80% full (>40K pending lines)  
- Dropped 50% of output events when queue >60% full (>30K pending lines)
- Was dropping important terminal content needed for proper rendering

### Solution Applied
**File**: `src/server/services/terminal-manager.ts:336-342`

**Conservative Dropping Logic**:
```typescript
// Only drop output events in extreme queue pressure and only if they're truly redundant
if (type === 'o' && queueSize > FLOW_CONTROL_CONFIG.maxPendingLines * 0.95) {
  // Only drop if this looks like redundant rapid-fire output (very short, no escape sequences)
  if (eventData && eventData.length < 10 && !eventData.includes('\x1b')) {
    // Drop only very short non-escape sequences when extremely full (95%+)
    return Math.random() < 0.3; // Much more conservative - only 30% drop rate
  }
}
```

**Key Changes**:
- Threshold raised from 60%/80% to 95% capacity
- Drop rate reduced from 50%/80% to 30%
- Only drops very short output (<10 chars) without escape sequences
- Preserves ALL escape sequences that control terminal state

## Outstanding Questions

1. **Clear Signal Detection**: Are the asciinema files using `\x1b[3J` or other clear sequences?
2. **Reconnection Behavior**: Is the client repeatedly disconnecting/reconnecting during replay?
3. **File Size Impact**: How large are the files even after pruning?
4. **Layout Isolation**: Will grid layout + CSS containment fully prevent header width changes?

## Next Steps

1. **Monitor replay performance** with new server optimizations
2. **Test header stability** with grid layout changes  
3. **Enhance clear signal detection** if replay still includes too much content
4. **Add performance metrics** to track improvement effectiveness

## Expected Results

With all optimizations and fixes:
- **Eliminate** "Pending lines limit reached" warnings
- **Faster replay** due to increased buffer capacity and smarter processing
- **Stable header layout** regardless of terminal content changes (CSS Grid + containment)
- **Preserve terminal functionality** while preventing memory overflow during high-volume scenarios
- **Reliable terminal content rendering** - no more empty terminals due to conservative line dropping
- **Maintained performance benefits** - still provides flow control relief under extreme load without breaking functionality