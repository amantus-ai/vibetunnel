# Mouse Click Debug Guide for VibeTunnel Screen Capture

## Problem
Mouse clicks are not working correctly in the screen capture feature. The coordinate system conversion might be incorrect.

## Changes Made

1. **Added Environment Variable Controls**:
   - `VIBETUNNEL_FLIP_Y` - Set to "false" to disable Y-coordinate flipping
   - `VIBETUNNEL_USE_WARP` - Set to "true" to use CGWarpMouseCursorPosition instead of CGEvent

2. **Enhanced Debug Logging**:
   - Extensive coordinate transformation logging
   - Screen information for all displays
   - Mouse position before and after moves
   - Capture mode and filter information

3. **Improved Mouse Movement**:
   - Added mouse move before click (already implemented)
   - Option to use CGWarpMouseCursorPosition for more direct cursor control
   - Proper multi-monitor support with screen-relative Y-flipping

## Testing Instructions

### 1. Test Default Behavior (Y-flipping enabled)
```bash
./build/Build/Products/Debug/VibeTunnel.app/Contents/MacOS/VibeTunnel
```

### 2. Test Without Y-Coordinate Flipping
```bash
VIBETUNNEL_FLIP_Y=false ./build/Build/Products/Debug/VibeTunnel.app/Contents/MacOS/VibeTunnel
```

### 3. Test With CGWarpMouseCursorPosition
```bash
VIBETUNNEL_USE_WARP=true ./build/Build/Products/Debug/VibeTunnel.app/Contents/MacOS/VibeTunnel
```

### 4. Test Both Options
```bash
VIBETUNNEL_FLIP_Y=false VIBETUNNEL_USE_WARP=true ./build/Build/Products/Debug/VibeTunnel.app/Contents/MacOS/VibeTunnel
```

## What to Look For in Logs

Use `./scripts/vtlog.sh -f -c ScreencapService` to monitor logs and look for:

1. **Coordinate Transformation**:
   - `🔍 [DEBUG] calculateClickLocation - Input: x=XXX, y=YYY`
   - `🔍 [DEBUG] Configuration: shouldFlipY=true/false, useWarpCursor=true/false`
   - `🔍 [DEBUG] Y-coordinate flipping DISABLED` (when VIBETUNNEL_FLIP_Y=false)

2. **Mouse Position**:
   - `🖱️ Current mouse position: (XXX, YYY)`
   - `🖱️ [DEBUG] Mouse position after move: (XXX, YYY)`

3. **Final Coordinates**:
   - `🎯 [DEBUG] Final coordinates: x=XXX, y=YYY`
   - `🔍 [DEBUG] Direct pixel coordinates (no Y-flip): x=XXX, y=YYY`

4. **Errors**:
   - `❌ [DEBUG] CGWarpMouseCursorPosition failed`
   - `🔐 [DEBUG] Accessibility permission status: false`

## Possible Issues

1. **Accessibility Permission**: Ensure VibeTunnel has accessibility permission in System Settings > Privacy & Security > Accessibility

2. **Coordinate Systems**: 
   - SCDisplay uses top-left origin (0,0 at top-left)
   - NSScreen uses bottom-left origin (0,0 at bottom-left)
   - The Y-flipping might not be needed if SCDisplay coordinates are already converted

3. **Multi-Monitor**: The code now properly handles multi-monitor setups by finding which screen contains the click point

## Next Steps

1. Test each configuration and observe where the mouse actually clicks
2. Check if clicks work better with `VIBETUNNEL_FLIP_Y=false`
3. Compare logged coordinates with expected click positions
4. If still not working, the debug logs will show exactly what coordinates are being used