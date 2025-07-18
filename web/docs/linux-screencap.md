# Linux Screen Capture Implementation

## Overview

VibeTunnel's Linux screen capture implementation provides a comprehensive solution for sharing desktop screens and windows on Linux systems through a web browser. Unlike the macOS implementation which leverages native ScreenCaptureKit APIs, the Linux version uses FFmpeg and platform-specific capture methods to achieve similar functionality.

### ARM64 Architecture Notes

**Important for ARM64 users (Raspberry Pi, Apple Silicon VMs, ARM servers):**
- ✅ **Chromium** is fully supported and required (Google Chrome is x86_64 only)
- ✅ **FFmpeg** works natively on ARM64 but must be installed separately
- ⚠️ **Performance** may be limited to software encoding (no hardware acceleration)
- ⚠️ **Testing** requires using `chromium` instead of `chrome` in Playwright scripts

## Architecture

### High-Level Flow

```
┌─────────────┐                    ┌─────────────┐                    ┌─────────────┐
│   Browser   │                    │ Node Server │                    │   FFmpeg    │
│  (Client)   │                    │ (Port 4020) │                    │  (Process)  │
└─────┬───────┘                    └──────┬──────┘                    └──────┬──────┘
      │                                    │                                   │
      │  1. Connect WebSocket              │                                   │
      ├───────────────────────────────────►│                                   │
      │  /ws/screencap-signal              │                                   │
      │                                    │                                   │
      │  2. Request screen capture         │                                   │
      ├───────────────────────────────────►│  3. Spawn FFmpeg process         │
      │                                    ├──────────────────────────────────►│
      │                                    │                                   │
      │                                    │  4. Video stream (stdout)        │
      │                                    │◄──────────────────────────────────┤
      │                                    │                                   │
      │  5. WebRTC Offer                   │                                   │
      │◄───────────────────────────────────┤                                   │
      │                                    │                                   │
      │  6. WebRTC Answer                  │                                   │
      ├───────────────────────────────────►│                                   │
      │                                    │                                   │
      │  7. WebRTC P2P Connection          │                                   │
      │◄═══════════════════════════════════│                                   │
      │    (Direct video stream)           │                                   │
      │                                    │                                   │
```

### Key Components

1. **LinuxScreencapHandler** (`web/src/server/websocket/linux-screencap-handler.ts`)
   - Manages WebSocket connections from browsers
   - Handles capture session lifecycle
   - Coordinates WebRTC signaling
   - Routes API requests for display information

2. **DesktopCaptureService** (`web/src/server/capture/desktop-capture-service.ts`)
   - Singleton service managing capture sessions
   - Detects display server type (X11, Wayland, headless)
   - Spawns and manages FFmpeg processes
   - Converts captured streams to WebRTC format

3. **FFmpegCapture** (`web/src/server/capture/capture-providers/ffmpeg-capture.ts`)
   - Wraps FFmpeg process management
   - Builds appropriate capture arguments based on display server
   - Handles different codecs (VP8, VP9, H.264)
   - Provides capture statistics

4. **DisplayDetection** (`web/src/server/capture/display-detection.ts`)
   - Detects display server type (X11, Wayland, headless)
   - Enumerates available screens using platform tools
   - Supports Xvfb for headless environments

5. **LinuxWebRTCHandler** (`web/src/server/websocket/linux-webrtc-handler.ts`)
   - Manages WebRTC peer connections
   - Converts FFmpeg output to WebRTC media streams
   - Handles ICE candidate exchange
   - Implements adaptive bitrate control

## Display Server Support

### X11
- **Detection**: Checks `DISPLAY` environment variable and verifies with `xdpyinfo`
- **Capture Method**: Uses FFmpeg's `x11grab` input format
- **Screen Enumeration**: Uses `xrandr` to detect connected displays
- **Features**: Full mouse cursor capture, multi-monitor support

### Wayland
- **Detection**: Checks `WAYLAND_DISPLAY` environment variable
- **Capture Method**: 
  - PipeWire (if available and supported by FFmpeg)
  - Falls back to XWayland with `x11grab`
- **Screen Enumeration**: 
  - Attempts `wlr-randr` for wlroots-based compositors
  - Falls back to defaults if compositor-specific tools unavailable
- **Limitations**: Some Wayland compositors may require additional permissions

### Headless (Xvfb)
- **Detection**: No display server found but Xvfb is available
- **Capture Method**: Starts Xvfb virtual display on `:99`
- **Use Cases**: Server environments, CI/CD pipelines, containerized deployments
- **Configuration**: Default 1920x1080 resolution, configurable

## Capture Pipeline

### 1. Display Server Detection
```typescript
// Automatic detection order:
1. Check WAYLAND_DISPLAY → Wayland
2. Check DISPLAY → X11 (verify with xdpyinfo)
3. Check Xvfb availability → Headless
4. Fallback → Unknown (capture may fail)
```

### 2. FFmpeg Process Spawning
```bash
# Example X11 capture command:
ffmpeg -f x11grab -r 30 -s 1920x1080 -i :0.0+0,0 \
       -c:v libvpx -b:v 2500k -crf 28 -preset fast \
       -f webm -

# Example Wayland/PipeWire capture:
ffmpeg -f lavfi -i pipewiregrab=d=0 \
       -c:v libvpx -b:v 2500k -crf 28 -preset fast \
       -f webm -
```

### 3. Stream Processing
- FFmpeg outputs to stdout
- Stream wrapped in Node.js Readable stream
- Converted to WebRTC MediaStream via `stream-converter.ts`
- Video tracks added to RTCPeerConnection

### 4. WebRTC Negotiation
- Server creates offer with video track
- Browser receives offer and creates answer
- ICE candidates exchanged for NAT traversal
- Direct P2P connection established when possible

## Quality Settings

### Codec Support
- **VP8** (Default): Best browser compatibility, moderate compression
- **VP9**: Better compression, requires modern browsers
- **H.264**: Hardware acceleration support, patent considerations

### Quality Presets
```typescript
{
  low:    { bitrate: 1000,  crf: 35, preset: 'ultrafast' },
  medium: { bitrate: 2500,  crf: 28, preset: 'fast' },
  high:   { bitrate: 5000,  crf: 23, preset: 'medium' },
  ultra:  { bitrate: 10000, crf: 18, preset: 'slow' }
}
```

### Adaptive Bitrate
- Monitors packet loss and round-trip time
- Adjusts bitrate between 1-50 Mbps
- Reduces quality when network conditions degrade
- Maintains target 30-60 FPS

## API Endpoints

All endpoints are accessed via WebSocket messages with `api-request` type:

### GET /displays
Returns available displays:
```json
{
  "displays": [{
    "id": 0,
    "width": 1920,
    "height": 1080,
    "x": 0,
    "y": 0,
    "isPrimary": true
  }]
}
```

### POST /capture/start
Starts screen capture:
```json
// Request
{
  "displayIndex": 0,
  "quality": "high",
  "sessionId": "unique-session-id"
}

// Response
{
  "sessionId": "capture-123456",
  "displayServer": {
    "type": "x11",
    "display": ":0",
    "captureMethod": "x11grab"
  }
}
```

## Security Considerations

### Authentication
- WebSocket connections require JWT authentication
- Each capture session has unique ID
- No direct FFmpeg process access from client

### Process Isolation
- FFmpeg runs as child process with limited permissions
- Output piped through Node.js, no file system access
- Automatic cleanup on disconnection

### Input Validation
- Display indices validated against detected screens
- Quality settings constrained to presets
- Bitrate limits enforced (1-50 Mbps)

## Platform-Specific Notes

### Prerequisites Check

**CRITICAL**: FFmpeg must be installed for screen capture to work. Without FFmpeg, the WebSocket connection will crash immediately.

```bash
# Check if FFmpeg is installed
which ffmpeg || echo "ERROR: FFmpeg not installed!"

# Check display server
echo "DISPLAY=$DISPLAY"
echo "WAYLAND_DISPLAY=$WAYLAND_DISPLAY"
```

### Ubuntu/Debian
```bash
# Install dependencies (REQUIRED)
sudo apt-get update
sudo apt-get install -y ffmpeg x11-utils xvfb

# For Wayland screen info (optional)
sudo apt-get install -y wlr-randr

# Verify installation
ffmpeg -version
xdpyinfo -version
```

### Fedora/RHEL
```bash
# Install dependencies
sudo dnf install ffmpeg xorg-x11-utils xorg-x11-server-Xvfb

# For Wayland (optional)
sudo dnf install wlr-randr
```

### Arch Linux
```bash
# Install dependencies
sudo pacman -S ffmpeg xorg-xdpyinfo xorg-server-xvfb

# For Wayland (optional)
sudo pacman -S wlr-randr
```

## Limitations

1. **No Window Capture**: Unlike macOS, individual window capture not implemented
   - Technical challenge: Window enumeration varies by window manager
   - Workaround: Use screen area selection in FFmpeg

2. **No Mouse/Keyboard Control**: Remote input not implemented
   - Would require X11/Wayland-specific input injection
   - Security implications on Linux are significant

3. **Audio Capture**: Not currently supported
   - Could be added via PulseAudio/PipeWire integration

4. **Wayland Compatibility**: Varies by compositor
   - GNOME: Requires portal permissions
   - KDE: Works with appropriate permissions  
   - Sway/wlroots: Best compatibility with wlr-randr

## Development and Testing

### Running Locally
```bash
# Start development server
cd web
pnpm run dev

# Access screen capture UI
open http://localhost:4020/screencap
```

### Testing Different Display Servers

#### Test X11 Capture
```bash
# Ensure running under X11
export DISPLAY=:0
pnpm run dev
```

#### Test Wayland Capture  
```bash
# Run under Wayland session
export WAYLAND_DISPLAY=wayland-0
pnpm run dev
```

#### Test Headless Capture
```bash
# Unset display variables
unset DISPLAY WAYLAND_DISPLAY
# Ensure Xvfb is installed
pnpm run dev
```

### Debug Logging
```javascript
// Browser console
localStorage.setItem('DEBUG', 'screencap*,desktop-capture*,ffmpeg*');

// Server logs
DEBUG=screencap*,desktop-capture*,ffmpeg* pnpm run dev
```

## Testing with Playwright

### ARM64 Limitations

**Important**: On Linux ARM64 systems (like Raspberry Pi, ARM servers, or Parallels VMs on Apple Silicon), Google Chrome is not available. You must use Chromium instead:

```bash
# This will fail on ARM64:
npx playwright install chrome  # ERROR: not supported on Linux Arm64

# Use this instead:
npx playwright install chromium
```

For testing VibeTunnel's screen capture features with Playwright:
1. Install Chromium: `npx playwright install chromium`
2. Configure Playwright MCP to use Chromium (not Chrome)
3. Use `chromium.launch()` in scripts instead of `chrome.launch()`

### Automated Testing Setup

```javascript
// test-screencap.js - Example Playwright test
const { chromium } = require('playwright');

async function testScreenCapture() {
  // Use chromium, not chrome on ARM64
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    permissions: ['camera', 'microphone'] // Required for WebRTC
  });
  
  const page = await context.newPage();
  
  // Enable console logging for debugging
  page.on('console', msg => console.log('Browser:', msg.text()));
  page.on('pageerror', err => console.error('Page error:', err));
  
  await page.goto('http://localhost:4020/screencap');
  
  // Wait for the screencap view to load
  await page.waitForSelector('screencap-view', { timeout: 10000 });
  
  // Take screenshots for documentation
  await page.screenshot({ path: 'screencap-ui.png' });
  
  await browser.close();
}

testScreenCapture();
```

### Current Implementation Status

#### WebSocket Connection Issues
During testing on Linux ARM64 (January 2025), the screen capture UI loads but experiences WebSocket connection errors:
- Initial connection succeeds and receives server ready message
- Connection closes with code 1006 (abnormal closure) after initial handshake
- Display enumeration fails due to lost connection

**Root Cause**: FFmpeg is not installed on the system. The server crashes when trying to spawn FFmpeg processes.

**Screenshot of Current UI State:**
![Screen Capture UI - Connection Error](./screencap-initial.png)

The UI shows:
- "Failed to load capture sources" error message
- WebSocket closed with code 1006 in console logs
- Server successfully connects initially but drops connection

**Solution**: Install FFmpeg before testing:
```bash
# Ubuntu/Debian
sudo apt-get update && sudo apt-get install -y ffmpeg

# Verify installation
ffmpeg -version
```

#### Debugging WebSocket Issues

To debug WebSocket connection problems:

1. **Check server logs**: 
   ```bash
   DEBUG=screencap*,desktop-capture*,linux* pnpm run dev
   ```

2. **Verify FFmpeg installation**:
   ```bash
   ffmpeg -version
   which ffmpeg
   ```

3. **Test display detection**:
   ```bash
   # For X11
   xdpyinfo | head -5
   xrandr --query
   
   # For Wayland
   echo $WAYLAND_DISPLAY
   wlr-randr  # if available
   ```

## Troubleshooting

### Common Issues

**"No display server detected"**
- Ensure DISPLAY or WAYLAND_DISPLAY is set
- Verify X11/Wayland session is running
- Install Xvfb for headless operation

**"FFmpeg not found"**
- Install FFmpeg: `sudo apt-get install ffmpeg`
- Ensure ffmpeg is in PATH: `which ffmpeg`

**Black screen or corrupted video**
- Check FFmpeg stderr output in logs
- Verify display server permissions
- Try different codec (VP8 vs H.264)
- Reduce quality settings

**High CPU usage**
- Use hardware acceleration if available
- Reduce framerate (e.g., 15 FPS for presentations)
- Lower quality preset
- Consider VP8 over VP9 for better performance

**WebRTC connection fails**
- Check firewall rules for UDP ports
- Verify STUN/TURN server configuration
- Monitor browser console for ICE errors

### ARM64 Specific Issues

**Playwright Chrome Installation Fails**
```bash
# Error: "ERROR: not supported on Linux Arm64"
# Solution: Use Chromium instead
npx playwright install chromium  # NOT chrome
```

**FFmpeg Performance on ARM64**
- Software encoding only (no NVENC/VAAPI on most ARM boards)
- Consider lower resolution/framerate for better performance
- VP8 generally performs better than VP9 on ARM
- Example optimized settings for ARM64:
  ```bash
  ffmpeg -f x11grab -r 15 -s 1280x720 -i :0.0 \
         -c:v libvpx -b:v 1500k -crf 30 -preset ultrafast \
         -cpu-used 8 -threads 4 -f webm -
  ```

**Testing on ARM64 Devices**
- Raspberry Pi 4/5: Works well with reduced settings
- Apple Silicon (Parallels/UTM): Full performance with native FFmpeg
- ARM servers: Check for X11/Wayland availability

## Complete ARM64 Testing Example

### Step-by-Step Setup on Linux ARM64

1. **Install Dependencies**:
   ```bash
   # Update package list
   sudo apt-get update
   
   # Install FFmpeg and X11 utilities
   sudo apt-get install -y ffmpeg x11-utils xvfb
   
   # Install Node.js dependencies
   cd /path/to/vibetunnel/web
   pnpm install
   
   # Install Playwright with Chromium (not Chrome!)
   npx playwright install chromium
   ```

2. **Verify Environment**:
   ```bash
   # Check FFmpeg
   ffmpeg -version | grep "ffmpeg version"
   
   # Check display server
   echo "Display: $DISPLAY, Wayland: $WAYLAND_DISPLAY"
   
   # Test X11 capture capability
   ffmpeg -f x11grab -t 1 -s 640x480 -i :0.0 -f null -
   ```

3. **Run Development Server**:
   ```bash
   # Start with debug logging
   DEBUG=screencap*,desktop-capture*,ffmpeg* pnpm run dev
   ```

4. **Test with Playwright**:
   ```javascript
   // Save as test-arm64-screencap.js
   const { chromium } = require('playwright');
   
   (async () => {
     const browser = await chromium.launch({ 
       headless: false,
       args: ['--no-sandbox']
     });
     
     const page = await browser.newPage();
     await page.goto('http://localhost:4020/screencap');
     
     // Wait for UI and check for errors
     await page.waitForSelector('screencap-view');
     
     // Check if FFmpeg is working
     const hasError = await page.locator('.error:has-text("Failed to load")').isVisible();
     
     if (hasError) {
       console.error('Screen capture failed - check FFmpeg installation');
     } else {
       console.log('Screen capture UI loaded successfully!');
     }
     
     await page.screenshot({ path: 'arm64-screencap-test.png' });
     await browser.close();
   })();
   ```

5. **Expected Results**:
   - With FFmpeg installed: UI loads, displays available
   - Without FFmpeg: WebSocket error 1006, "Failed to load capture sources"

## Future Enhancements

1. **Window Capture**: Implement window enumeration and capture
   - Use X11 window properties
   - Parse compositor-specific window lists

2. **Remote Input**: Add mouse/keyboard control
   - X11: Use XTest extension
   - Wayland: Requires compositor support

3. **Audio Support**: Capture system/application audio
   - PulseAudio integration
   - PipeWire for modern systems

4. **GPU Acceleration**: Utilize VAAPI/NVENC
   - Detect available hardware encoders
   - Automatic fallback to software

5. **Screen Annotation**: Drawing tools overlay
   - Canvas-based annotation layer
   - Synchronized with video stream

6. **Better Wayland Support**: 
   - Portal API integration
   - Native PipeWire without FFmpeg
   - Per-compositor optimizations