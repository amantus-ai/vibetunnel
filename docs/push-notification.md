# Push Notifications in VibeTunnel

VibeTunnel provides real-time alerts for terminal events via native macOS notifications and web push notifications. The system is primarily driven by the **Session Monitor**, which tracks terminal activity and triggers alerts.

## How It Works

The **Session Monitor** is the core of the notification system. It observes terminal sessions for key events and dispatches them to the appropriate notification service (macOS or web).

### Notification Settings Explained

When you enable notifications in VibeTunnel, you can choose which events to be notified about:

#### 1. Session starts ✓
- **Notification**: "Session Started" with the session name
- **Triggers when**: A new terminal session is created
- **Use case**: Know when someone starts using your shared terminal

#### 2. Session ends ✓
- **Notification**: "Session Ended" with the session name
- **Shows exit code**: If the session crashed or exited abnormally
- **Triggers when**: A terminal session closes
- **Use case**: Monitor when sessions terminate, especially if unexpected

#### 3. Commands complete (> 3 seconds) ✓
- **Notification**: "Your Turn" with the command that finished
- **Shows duration**: How long the command took to complete
- **Triggers when**: Any command that runs for more than 3 seconds finishes
- **Use case**: Get notified when long builds, tests, or scripts complete

#### 4. Commands fail ✓
- **Notification**: "Command Failed" with the failed command
- **Shows exit code**: The specific error code returned
- **Triggers when**: Any command returns a non-zero exit code
- **Use case**: Immediately know when something goes wrong

#### 5. Terminal bell (\u{0007}) ✓
- **Notification**: "Terminal Bell" with the session name
- **Triggers when**: A program outputs the bell character (ASCII 7/^G)
- **Common sources**: vim alerts, IRC mentions, completion sounds
- **Use case**: Get alerts from terminal programs that use the bell

## Architecture

### System Overview

The notification system in VibeTunnel follows a layered architecture:

```
Terminal Events → Session Monitor → Event Processing → Notification Service → OS/Browser
```

### Key Components

#### 1. Session Monitor (`SessionMonitor.swift`)
- **Role**: Tracks all terminal sessions and their state changes
- **Key responsibilities**:
  - Monitors session lifecycle (start/exit)
  - Tracks command execution and duration
  - Filters events based on thresholds (e.g., 3-second rule)

#### 2. Server Event System (`ServerEvent.swift`)
- **Event types**: 
  - `sessionStart`, `sessionExit`: Session lifecycle
  - `commandFinished`, `commandError`: Command execution
  - `bell`: Terminal bell character detection
- **Event data**: Each event carries session ID, display name, duration, exit codes, etc.

#### 3. Notification Service (`NotificationService.swift`)
- **macOS integration**: Uses `UserNotifications` framework
- **Event source**: Connects to server via WebSocket v3 at `/ws` (global subscription for `EVENT` frames)
- **Preference management**: Checks user settings before sending
- **Permission handling**: Manages notification authorization

#### 4. Configuration Manager (`ConfigManager.swift`)
- **Settings storage**: Persists user notification preferences
- **Default values**: All notification types enabled by default
- **Real-time updates**: Changes take effect immediately

### Event Flow

1. **Terminal Activity**: User runs commands, sessions start/stop
2. **Event Detection**: Session Monitor detects changes
3. **Event Creation**: Creates typed `ServerEvent` objects
4. **Filtering**: Checks user preferences and thresholds
5. **Notification Dispatch**: Sends to OS notification center
6. **User Interaction**: Shows native macOS notifications

### Special Features

#### Command Duration Tracking
- Only notifies for commands > 3 seconds
- Tracks start time when command begins
- Calculates duration on completion
- Formats duration for display (e.g., "5 seconds", "2 minutes")

#### Bell Character Detection
- Terminal emulator detects ASCII 7 (`\u{0007}`)
- Forwards bell events through WebSocket
- Server converts to notification event

## Native macOS Notifications

The VibeTunnel macOS app provides the most reliable and feature-rich notification experience.

- **Enable**: Go to `VibeTunnel Settings > General` and toggle **Show Session Notifications**.
- **Features**: Uses the native `UserNotifications` framework, respects Focus Modes, and works in the background.

## Web Push Notifications

For non-macOS clients or remote access, VibeTunnel supports web push notifications.

- **Enable**: Click the notification icon in the web UI and grant browser permission.
- **Technology**: Uses Service Workers and the Web Push API.

### HTTPS Requirement

⚠️ **Important**: Web push notifications require HTTPS to function. This is a security requirement enforced by all modern browsers.

- **Local development**: Works on `http://localhost:4020` without HTTPS
- **Remote access**: Requires HTTPS with a valid SSL certificate
- **Why**: Service Workers (which power push notifications) only work on secure origins to prevent man-in-the-middle attacks

### Enabling HTTPS for Remote Access

If you need web push notifications when accessing VibeTunnel remotely, you'll need to serve it over HTTPS. Here are some solutions:

#### Tailscale Serve (Recommended)
[Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve) is an excellent solution for automatically creating HTTPS connections within your network:

```bash
# Install Tailscale and connect to your network
# Then expose VibeTunnel with HTTPS:
tailscale serve https / http://localhost:4020
```

Benefits:
- Automatic HTTPS with valid certificates
- Works within your Tailscale network
- No port forwarding or firewall configuration needed
- Push notifications will work for all devices on your Tailnet

#### Other Options
- **Ngrok**: Provides HTTPS tunnels but requires external exposure
- **Cloudflare Tunnel**: Free HTTPS tunneling service
- **Let's Encrypt**: For permanent HTTPS setup with your own domain

## Troubleshooting

- **No Notifications**: Ensure they are enabled in both VibeTunnel settings and your OS/browser settings.
- **Duplicate Notifications**: You can clear old or duplicate subscriptions by deleting `~/.vibetunnel/notifications/subscriptions.json`.
- **Claude Notifications**: If Claude's "Your Turn" notifications aren't working, you can try forcing it to use the terminal bell:
  ```bash
  claude config set --global preferredNotifChannel terminal_bell
  ```
