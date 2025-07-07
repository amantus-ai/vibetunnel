# Screen Capture Auto-Fix Plan

## Problem Statement
- Screen capture is showing a black screen instead of actual content
- Recent changes to ScreenCaptureKit API usage likely caused the issue
- Need to ensure both desktop and window capture work properly
- Menu bar must be visible in desktop capture (currently excluded)

## Fix Strategy

### 1. Initial Diagnosis
- [x] Launch VibeTunnel Mac app
- [x] Use Playwright to navigate to screen capture
- [ ] Capture vtlog output to identify the issue
- [ ] Look for errors in:
  - SCStreamConfiguration setup
  - Content filter creation
  - Frame processing
  - WebRTC video pipeline

### 2. Primary Focus Areas

#### A. Content Filter Issues
- Check `excludingDesktopWindows` parameter
- Verify window filtering logic
- Ensure menu bar is included (not excluded)

#### B. Stream Configuration
- Verify source/destination rectangles
- Check frame dimensions and scaling
- Ensure proper pixel format (kCVPixelFormatType_32BGRA)

#### C. Frame Processing
- Check if frames are being received
- Verify CGImage creation from pixel buffers
- Ensure WebRTC is receiving frames

### 3. Iteration Process

For each change:
1. Make code changes (primarily in `ScreencapService.swift`)
2. Clean build: `./scripts/clean.sh`
3. Build Mac app: `./scripts/build.sh`
4. Launch app: Use XcodeBuildMCP
5. Test with Playwright:
   - Navigate to screen capture
   - Select Built-in Retina Display
   - Click Start
   - Take screenshot to verify
6. Check logs: `./scripts/vtlog.sh -n 100 -e`
7. Repeat until working

### 4. Test Scenarios

#### Desktop Capture
- [ ] Built-in Retina Display shows content
- [ ] Menu bar is visible
- [ ] Full desktop area captured
- [ ] No black screen

#### Window Capture
- [ ] Individual windows can be selected
- [ ] Window content displays properly
- [ ] No truncation or scaling issues

### 5. Key Files to Modify
- `mac/VibeTunnel/Core/Services/ScreencapService.swift`
- `mac/VibeTunnel/Core/Services/WebRTCManager.swift`

### 6. Success Criteria
- Screen capture shows actual screen content (not black)
- Both desktop and window capture work
- Menu bar is visible in desktop capture
- No truncation or scaling issues
- Logs show frames being processed successfully

## Implementation Log

### Attempt 1: Check Current State
```bash
# Get current logs
./scripts/vtlog.sh -n 200 -c ScreencapService

# Look for:
# - "excludingDesktopWindows" settings
# - Frame processing messages
# - Any errors in stream setup
```

### Attempt 2: Fix Desktop Windows Exclusion
The issue is likely in the content filter creation where we're excluding desktop windows.

### Attempt 3: Fix Frame Rectangle Configuration
Check sourceRect and destinationRect settings for proper frame capture.

### Attempt 4: Enable Menu Bar Capture
Ensure the menu bar area is included in the capture rectangle.

## Notes
- The black screen suggests frames aren't being captured or processed correctly
- Recent changes to scaling/frame handling may have introduced the issue
- Focus on SCShareableContent.excludingDesktopWindows parameter first