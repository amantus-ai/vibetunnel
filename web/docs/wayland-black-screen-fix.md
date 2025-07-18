# Fixing Black Screen Issue on Wayland/Xwayland

## Problem
When running VibeTunnel screen capture on Wayland with Xwayland, you may see a black screen with only the mouse cursor visible. This is because Wayland handles rendering differently than traditional X11.

## Quick Fix

### Option 1: Force X11 Session (Recommended for Testing)
Log out and select "Ubuntu on Xorg" or similar X11 session from the login screen.

### Option 2: Install PipeWire Support
```bash
# Install PipeWire and related packages
sudo apt-get install -y pipewire pipewire-media-session- wireplumber pipewire-pulse
sudo apt-get install -y xdg-desktop-portal xdg-desktop-portal-gtk xdg-desktop-portal-gnome

# Enable PipeWire
systemctl --user enable pipewire pipewire-pulse wireplumber
systemctl --user start pipewire pipewire-pulse wireplumber
```

### Option 3: Use OBS Virtual Camera (Workaround)
1. Install OBS Studio: `sudo apt-get install obs-studio`
2. Add display capture source in OBS
3. Start virtual camera
4. Capture `/dev/video0` instead of screen

### Option 4: Environment Variable Workarounds
```bash
# Try these before starting VibeTunnel:

# Force software rendering
export LIBGL_ALWAYS_SOFTWARE=1

# Use different Xwayland display
export DISPLAY=:1

# Disable Wayland for specific apps
export GDK_BACKEND=x11
export QT_QPA_PLATFORM=xcb
```

## Technical Explanation

The issue occurs because:
1. Wayland compositors render directly to GPU buffers
2. Xwayland provides compatibility but doesn't expose the actual screen content
3. Only the cursor overlay is accessible, hence you see just the cursor

## Long-term Solution

VibeTunnel needs to implement native Wayland screen capture using:
- PipeWire for screen casting (recommended)
- wlr-screencopy protocol (wlroots compositors)
- GNOME Shell D-Bus API (GNOME only)

## Verification

To check if the fix worked:
```bash
# Test capture
ffmpeg -f x11grab -video_size 640x480 -i :0 -frames:v 1 -f image2 test.png
# Check if test.png shows actual screen content
```