# Push Notifications in VibeTunnel

Push notifications in VibeTunnel allow you to receive real-time alerts about your terminal sessions, even when the web interface isn't active or visible. This keeps you informed about important events like completed commands, session exits, or system alerts.

## User Guide

1. **Enable Notifications**: Click the notification status indicator in the web interface (typically shows as red when disabled)
2. **Grant Permission**: Your browser will prompt you to allow notifications - click "Allow"
3. **Configure Settings**: Choose which types of notifications you want to receive

VibeTunnel supports several types of notifications:

- **Bell Events**: Triggered when terminal programs send a bell character (e.g., when a command completes)
- **Session Start**: Notified when a new terminal session begins
- **Session Exit**: Alerted when a terminal session ends
- **Session Errors**: Informed about session failures or errors
- **System Alerts**: Receive server status and system-wide notifications

## Local (macOS) Notifications

The macOS menu bar app can deliver native local notifications when terminal sessions complete or encounter errors. To enable this feature:

1. Open the General Settings tab in the macOS app.
2. Toggle **Show Session Notifications** on.

The app uses the UserNotifications framework to dispatch system notifications even when the interface is not in focus.

Access notification settings by clicking the notification status indicator:

- **Enable/Disable**: Toggle notifications on or off entirely
- **Notification Types**: Choose which events trigger notifications (Session Exit and System Alerts are enabled by default)
- **Behavior**: Control sound and vibration settings
- **Test**: Send a test notification to verify everything works

Note that just because you can configure something, does not mean your browser will support it.

## Push and Claude

Claude code by default tries auto detection for terminal bells which can cause issues.  You can force it
to emit a bell with this command:

```
claude config set --global preferredNotifChannel terminal_bell
```

## Troubleshooting

- **Not receiving notifications**: Check that notifications are enabled both in VibeTunnel settings and your browser permissions
- **Too many notifications**: Adjust which notification types are enabled in the settings
- **Missing notifications**: Ensure your browser supports Service Workers and the Push API (most modern browsers do)

## Technical Implementation

VibeTunnel's push notification system uses rather modern web standards:

- **Web Push API**: For delivering notifications to browsers
- **Service Workers**: Handle notifications when the app isn't active
- **VAPID Protocol**: Secure authentication between server and browser
- **UserNotifications (macOS)**: System framework for local notifications when sessions complete
- **Terminal Integration**: Smart detection of bell characters and session events

### Bell Detection

The system intelligently detects when terminal programs send bell characters (ASCII 7):

- **Smart Filtering**: Ignores escape sequences that end with bell characters (not actual alerts)
- **Process Context**: Identifies which program triggered the bell for meaningful notifications (best effort)

## Subscription State

VibeTunnel stores push notification data in the `~/.vibetunnel/` directory:

```
~/.vibetunnel/
├── vapid/
│   └── keys.json                     # VAPID public/private key pair
└── notifications/
    └── subscriptions.json            # Push notification subscriptions
```

**VAPID Keys** (`~/.vibetunnel/vapid/keys.json`):
- Contains the public/private key pair used for VAPID authentication
- File permissions are restricted to owner-only (0o600) for security
- Keys are automatically generated on first run if not present
- Used to authenticate push notifications with browser push services
- Don't delete this or bad stuff happens to existing subscriptions.

**Subscriptions** (`~/.vibetunnel/notifications/subscriptions.json`):
- Stores active push notification subscriptions from browsers
- Each subscription includes endpoint URL, encryption keys, and metadata
- Automatically cleaned up when subscriptions become invalid or expired
- Synchronized across all active sessions for the same user
- If you get duplicated push notifications, you can try to delete old sessions here.

The subscription data is persistent across application restarts and allows VibeTunnel to continue sending notifications even after the server restarts.
