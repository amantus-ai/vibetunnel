# Linux Screen Capture Permissions Guide

## Overview

Linux has multiple permission systems that can affect screen capture. Unlike Windows or macOS which have single permission prompts, Linux permissions depend on your display server, distribution, and security policies.

## Permission Systems

### 1. X11 Permissions

X11 uses an access control list system. By default, only the user who started X can access it.

**Check current permissions:**
```bash
xhost
```

**Common fixes:**
```bash
# Allow local connections (less secure but fixes most issues)
xhost +local:

# Allow specific user
xhost +SI:localuser:$(whoami)

# Disable access control entirely (NOT RECOMMENDED)
xhost +
```

**For remote/SSH sessions:**
```bash
# Export display
export DISPLAY=:0

# Copy .Xauthority
cp ~/.Xauthority /tmp/
export XAUTHORITY=/tmp/.Xauthority
```

### 2. Wayland Permissions

Wayland is more secure and requires explicit permission through portals.

**Portal-based permissions:**
- Screen capture requires XDG Desktop Portal
- Applications must request permission through D-Bus
- User sees a dialog to select screens/windows

**Check portal status:**
```bash
systemctl --user status xdg-desktop-portal
systemctl --user status xdg-desktop-portal-gnome  # For GNOME
systemctl --user status xdg-desktop-portal-kde    # For KDE
```

**Enable screen capture on Wayland:**
```bash
# Install required portals
sudo apt-get install xdg-desktop-portal xdg-desktop-portal-gtk

# For GNOME
sudo apt-get install xdg-desktop-portal-gnome

# For KDE
sudo apt-get install xdg-desktop-portal-kde
```

### 3. User Group Permissions

Certain groups provide hardware access:

```bash
# Check your groups
groups

# Common groups needed:
# - video: Access to video devices and GPU
# - audio: Access to audio devices
# - input: Access to input devices (for remote control)

# Add user to video group
sudo usermod -a -G video $USER

# Add user to input group (for mouse/keyboard capture)
sudo usermod -a -G input $USER

# Log out and back in for changes to take effect
```

### 4. File System Permissions

**Check key permissions:**
```bash
# X11 socket
ls -la /tmp/.X11-unix/

# Video devices
ls -la /dev/video*

# DRI devices (GPU access)
ls -la /dev/dri/
```

### 5. SELinux (Fedora/RHEL)

SELinux can block screen capture in enforcing mode.

```bash
# Check SELinux status
getenforce

# Temporarily allow (for testing)
sudo setenforce 0

# Create permanent policy (better solution)
sudo ausearch -c 'ffmpeg' --raw | audit2allow -M ffmpeg-screencap
sudo semodule -i ffmpeg-screencap.pp
```

### 6. AppArmor (Ubuntu/Debian)

AppArmor profiles can restrict applications.

```bash
# Check if AppArmor is active
sudo aa-status

# Disable for FFmpeg (temporary)
sudo aa-complain /usr/bin/ffmpeg

# Or disable specific profile
sudo ln -s /etc/apparmor.d/usr.bin.ffmpeg /etc/apparmor.d/disable/
sudo apparmor_parser -R /etc/apparmor.d/usr.bin.ffmpeg
```

### 7. Snap/Flatpak Confinement

If running VibeTunnel as Snap or Flatpak:

**Snap permissions:**
```bash
# List connections
snap connections vibetunnel

# Connect screen-record interface
sudo snap connect vibetunnel:screen-record
```

**Flatpak permissions:**
```bash
# Grant screen capture
flatpak override --user --device=all com.vibetunnel.app
flatpak override --user --filesystem=host com.vibetunnel.app
```

## Quick Permission Fixes

### For X11 Black Screen:
```bash
# 1. Allow local X11 access
xhost +local:

# 2. Set display if needed
export DISPLAY=:0

# 3. Add to video group
sudo usermod -a -G video $USER
# Log out and back in
```

### For Wayland Black Screen:
```bash
# 1. Install PipeWire and portals
sudo apt-get install pipewire pipewire-media-session- wireplumber
sudo apt-get install xdg-desktop-portal xdg-desktop-portal-gtk

# 2. Enable services
systemctl --user enable pipewire wireplumber
systemctl --user start pipewire wireplumber

# 3. Or switch to X11 session
# Log out and select "Ubuntu on Xorg" at login
```

### For Container/VM Environments:
```bash
# 1. Pass through display socket
docker run -v /tmp/.X11-unix:/tmp/.X11-unix:rw \
           -e DISPLAY=$DISPLAY \
           vibetunnel

# 2. For Parallels/VMware
# Enable 3D acceleration in VM settings
# Install guest additions/tools
```

## Testing Permissions

**Basic permission test:**
```bash
# Should capture a screenshot without errors
ffmpeg -f x11grab -video_size 640x480 -i :0 -frames:v 1 test.png

# Check if image is black or shows content
display test.png  # or open in image viewer
```

**Verbose permission check:**
```bash
# Run with strace to see permission denials
strace -e trace=access,open ffmpeg -f x11grab -i :0 -frames:v 1 -f null - 2>&1 | grep EACCES
```

## VibeTunnel-Specific Setup

For VibeTunnel screen capture to work properly:

1. **Development Mode:**
   ```bash
   # Ensure proper permissions before starting
   xhost +local:
   export DISPLAY=:0
   pnpm run dev
   ```

2. **Production Mode:**
   ```bash
   # Add systemd service permissions
   # In /etc/systemd/system/vibetunnel.service
   [Service]
   Environment="DISPLAY=:0"
   Environment="XAUTHORITY=/home/user/.Xauthority"
   SupplementaryGroups=video input
   ```

3. **Auto-start Script:**
   ```bash
   #!/bin/bash
   # ~/.config/autostart/vibetunnel-permissions.sh
   xhost +local:
   export DISPLAY=:0
   ```

## Troubleshooting

### "Cannot open display"
- Check `echo $DISPLAY`
- Run `xhost +local:`
- Verify X server is running: `ps aux | grep Xorg`

### "Permission denied"
- Check groups: `groups`
- Add to video group: `sudo usermod -a -G video $USER`
- Check SELinux: `getenforce`

### "Black screen with cursor"
- Running on Wayland - switch to X11 or install PipeWire
- GPU driver issue - try `export LIBGL_ALWAYS_SOFTWARE=1`
- Compositor issue - disable compositor temporarily

### "No protocol specified"
- X11 access control issue - run `xhost +local:`
- Wrong DISPLAY - try `:0` or `:1`
- Missing .Xauthority - check `echo $XAUTHORITY`

## Security Considerations

- `xhost +` disables all X11 security - avoid in production
- Use `xhost +SI:localuser:username` for specific user access
- On Wayland, use portal system for proper security
- Consider running screen capture in separate process with minimal permissions
- Use systemd service with proper Group= and SupplementaryGroups=