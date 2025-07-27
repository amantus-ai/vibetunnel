# Push Notifications in VibeTunnel

VibeTunnel provides real-time alerts for terminal events via native macOS notifications and web push notifications. The system is primarily driven by the **Session Monitor**, which tracks terminal activity and triggers alerts.

## How It Works

The **Session Monitor** is the core of the notification system. It observes terminal sessions for key events and dispatches them to the appropriate notification service (macOS or web).

### Key Monitored Events
- **Session Start/Exit**: Get notified when a terminal session begins or ends.
- **Command Completion**: Alerts for long-running commands.
- **Errors**: Notifications for commands that fail.
- **Terminal Bell**: Triggered by programs sending a bell character (`^G`).
- **Claude "Your Turn"**: A special notification when Claude AI finishes a response and is awaiting your input.

## Native macOS Notifications

The VibeTunnel macOS app provides the most reliable and feature-rich notification experience.

- **Enable**: Go to `VibeTunnel Settings > General` and toggle **Show Session Notifications**.
- **Features**: Uses the native `UserNotifications` framework, respects Focus Modes, and works in the background.

## Web Push Notifications

For non-macOS clients or remote access, VibeTunnel supports web push notifications.

- **Enable**: Click the notification icon in the web UI and grant browser permission.
- **Technology**: Uses Service Workers and the Web Push API.

## Troubleshooting

- **No Notifications**: Ensure they are enabled in both VibeTunnel settings and your OS/browser settings.
- **Duplicate Notifications**: You can clear old or duplicate subscriptions by deleting `~/.vibetunnel/notifications/subscriptions.json`.
- **Claude Notifications**: If Claude's "Your Turn" notifications aren't working, you can try forcing it to use the terminal bell:
  ```bash
  claude config set --global preferredNotifChannel terminal_bell
  ```

