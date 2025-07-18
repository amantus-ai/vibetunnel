# Linux Input Control Guide (Mouse & Keyboard)

## Overview

VibeTunnel supports remote mouse and keyboard control on Linux systems through the screen capture feature. This allows users to interact with the Linux desktop directly from their web browser.

## Requirements

### X11 Systems

For X11-based desktop environments, the following tools are required:

1. **xdotool** - Mouse and keyboard automation tool
2. **xdpyinfo** - Display information utility

#### Installation

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install xdotool x11-utils
```

**Fedora/RHEL:**
```bash
sudo dnf install xdotool xorg-x11-utils
```

**Arch Linux:**
```bash
sudo pacman -S xdotool xorg-xdpyinfo
```

**openSUSE:**
```bash
sudo zypper install xdotool xdpyinfo
```

### Wayland Systems

Wayland has stricter security policies that limit input control capabilities. Current options:

1. **Use XWayland compatibility** - Run applications through XWayland
2. **Switch to X11 session** - Log out and select "X11" or "Xorg" session at login
3. **Limited native support** - Some compositors may support input injection through specific APIs

## Permission Requirements

### 1. User Groups

Add your user to the necessary groups:

```bash
# Add to input group for device access
sudo usermod -a -G input $USER

# Add to video group for screen capture
sudo usermod -a -G video $USER

# Log out and back in for changes to take effect
```

### 2. X11 Access Control

Allow local connections to X server:

```bash
# Allow access for current session
xhost +local:

# Or allow specific user
xhost +SI:localuser:$(whoami)
```

### 3. Display Environment

Ensure DISPLAY variable is set:

```bash
# Check current display
echo $DISPLAY

# Set if not already set
export DISPLAY=:0
```

## Testing Input Control

### Test Mouse Control

```bash
# Move mouse to specific coordinates
xdotool mousemove 500 500

# Click at current position
xdotool click 1

# Right-click
xdotool click 3

# Drag operation
xdotool mousedown 1
xdotool mousemove 600 600
xdotool mouseup 1
```

### Test Keyboard Control

```bash
# Type text
xdotool type "Hello, World!"

# Send key combinations
xdotool key ctrl+c
xdotool key alt+Tab
xdotool key super+d  # Windows/Super key + d

# Special keys
xdotool key Return
xdotool key Escape
xdotool key BackSpace
```

## Troubleshooting

### "Command not found: xdotool"

Install xdotool using the appropriate package manager for your distribution (see Installation section).

### "Can't open display"

1. Check DISPLAY variable: `echo $DISPLAY`
2. Set it if empty: `export DISPLAY=:0`
3. Allow X11 access: `xhost +local:`

### "Permission denied"

1. Check group membership: `groups`
2. Add to input group: `sudo usermod -a -G input $USER`
3. Log out and back in

### Mouse/keyboard not working in VibeTunnel

1. Verify xdotool works manually (see Testing section)
2. Check VibeTunnel server logs for errors
3. Ensure screen capture is active and showing video
4. Verify WebSocket connection is established

### Wayland-specific issues

If running on Wayland:

1. Check if XWayland is available: `ps aux | grep Xwayland`
2. Try running with XWayland: `GDK_BACKEND=x11 vibetunnel`
3. Consider switching to X11 session for full functionality

## Security Considerations

### X11 Security

- `xhost +` disables all access control (NOT RECOMMENDED)
- Use `xhost +local:` for local-only access
- Use `xhost +SI:localuser:username` for specific user access
- Remove access when done: `xhost -`

### Input Injection Risks

- Mouse and keyboard control allows full system interaction
- Only use on trusted networks
- Consider using VPN for remote access
- Monitor access logs regularly

### Sandboxing

If running in containers or sandboxed environments:

```bash
# Docker example with X11 forwarding
docker run -it \
  -v /tmp/.X11-unix:/tmp/.X11-unix:rw \
  -e DISPLAY=$DISPLAY \
  --device /dev/input \
  --group-add input \
  vibetunnel
```

## Implementation Details

### How It Works

1. **Client Side**: Browser captures mouse/keyboard events on the video element
2. **WebSocket Transport**: Events are sent as normalized coordinates (0-1000 range)
3. **Server Processing**: Server converts coordinates to screen pixels
4. **Input Injection**: xdotool executes the actual mouse/keyboard actions

### Coordinate System

- Client normalizes all coordinates to 0-1000 range
- Server converts based on actual display dimensions
- Supports multiple displays (with proper display index)

### Supported Events

**Mouse Events:**
- Click (left, middle, right buttons)
- Mouse down/up (for dragging)
- Mouse move
- Scroll (if implemented)

**Keyboard Events:**
- Regular keys (a-z, 0-9, symbols)
- Modifier keys (Ctrl, Alt, Shift, Super/Windows)
- Special keys (Enter, Tab, Escape, F1-F12, etc.)
- Key combinations (Ctrl+C, Alt+Tab, etc.)

## Performance Tips

1. **Reduce latency**: Use wired connection when possible
2. **Optimize X11**: Disable compositor effects during remote control
3. **CPU usage**: Monitor xdotool CPU usage, add delays if needed
4. **Network**: Ensure stable connection for smooth control

## Alternative Tools

If xdotool doesn't work for your setup:

1. **ydotool** - Works on both X11 and Wayland (requires root)
2. **wtype** - Wayland-native keyboard input
3. **dotool** - Modern alternative supporting both X11 and Wayland
4. **xte** (from xautomation) - Older but reliable X11 tool

### Installing alternatives

```bash
# ydotool (requires daemon)
sudo apt-get install ydotool
sudo systemctl enable ydotoold
sudo systemctl start ydotoold

# wtype (Wayland only)
sudo apt-get install wtype

# dotool
# Check your distribution's package manager or build from source
```

## Integration with VibeTunnel

VibeTunnel automatically detects and uses available input tools. The priority order is:

1. xdotool (default for X11)
2. Alternative tools (if configured)
3. Graceful degradation (video-only if no tools available)

To verify input control is working:

1. Start VibeTunnel screen capture
2. Click on the video feed in your browser
3. Check server logs for input commands
4. Verify mouse/keyboard actions on Linux desktop