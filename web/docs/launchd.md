# VibeTunnel LaunchAgent Service Guide (macOS)

This guide covers installing and managing VibeTunnel as a LaunchAgent service on macOS.

## Overview

VibeTunnel includes built-in launchd integration that allows you to run it as a persistent service on macOS. The service runs as a **user-level LaunchAgent** under your account (not system-wide), providing automatic startup at login, restart on crash, and proper resource management.

## Quick Start

```bash
# Install the LaunchAgent (run as regular user, NOT root)
vibetunnel launchd

# The service starts automatically after installation!

# Check status
vibetunnel launchd status

# Stop the service
launchctl stop sh.vibetunnel.server

# Start the service
launchctl start sh.vibetunnel.server
```

## Installation

### Prerequisites

- macOS 10.10 or later
- VibeTunnel installed globally via npm (`npm install -g vibetunnel`)
- Regular user account (do not run as root)

### Install Command

```bash
vibetunnel launchd
```

This command will:
1. Verify VibeTunnel is installed and accessible
2. Create a wrapper script at `~/.local/bin/vibetunnel-launchd`
3. Install the plist file at `~/Library/LaunchAgents/sh.vibetunnel.server.plist`
4. Create a log directory at `~/Library/Logs/VibeTunnel/`
5. Load the LaunchAgent and start the service

## Service Management

### Basic Commands

```bash
# Start the service
launchctl start sh.vibetunnel.server

# Stop the service
launchctl stop sh.vibetunnel.server

# Restart the service (get your user ID first)
launchctl kickstart -k gui/$(id -u)/sh.vibetunnel.server

# Check VibeTunnel's launchd status
vibetunnel launchd status

# Unload (disable auto-start)
launchctl unload ~/Library/LaunchAgents/sh.vibetunnel.server.plist

# Load (enable auto-start)
launchctl load ~/Library/LaunchAgents/sh.vibetunnel.server.plist

# List all loaded services (check if VibeTunnel is running)
launchctl list | grep vibetunnel
```

### Understanding launchctl list Output

```
PID     Status  Label
12345   0       sh.vibetunnel.server
```

- **PID**: Process ID if running, `-` if not running
- **Status**: Last exit code (0 = success, non-zero = error)
- **Label**: Service identifier

### Viewing Logs

```bash
# Follow output logs in real-time
tail -f ~/Library/Logs/VibeTunnel/vibetunnel.log

# Follow error logs in real-time
tail -f ~/Library/Logs/VibeTunnel/vibetunnel.error.log

# View last 100 lines of output
tail -n 100 ~/Library/Logs/VibeTunnel/vibetunnel.log

# View all logs with less
less ~/Library/Logs/VibeTunnel/vibetunnel.log
```

## Configuration

### Default Settings

The service runs with these defaults:
- **Port**: 4020
- **Bind Address**: 0.0.0.0 (all interfaces)
- **Working Directory**: Your home directory
- **Restart Policy**: KeepAlive (always restart on crash)
- **Restart Delay**: 10 seconds (ThrottleInterval)
- **Environment**: `NODE_ENV=production`, `VIBETUNNEL_LOG_LEVEL=info`

### Plist File Location

The service configuration is stored at:
```
~/Library/LaunchAgents/sh.vibetunnel.server.plist
```

### Customizing the Service

To modify service settings:

1. Stop and unload the service:
   ```bash
   launchctl unload ~/Library/LaunchAgents/sh.vibetunnel.server.plist
   ```

2. Edit the plist file:
   ```bash
   nano ~/Library/LaunchAgents/sh.vibetunnel.server.plist
   ```

3. Common customizations:
   ```xml
   <!-- Change port (find the ProgramArguments array) -->
   <key>ProgramArguments</key>
   <array>
       <string>/Users/yourname/.local/bin/vibetunnel-launchd</string>
       <string>--port</string>
       <string>8080</string>  <!-- Changed from 4020 -->
       <string>--bind</string>
       <string>0.0.0.0</string>
   </array>

   <!-- Add authentication -->
   <array>
       <string>/Users/yourname/.local/bin/vibetunnel-launchd</string>
       <string>--port</string>
       <string>4020</string>
       <string>--bind</string>
       <string>0.0.0.0</string>
       <string>--auth</string>
       <string>system</string>
   </array>

   <!-- Change log level -->
   <key>EnvironmentVariables</key>
   <dict>
       <key>VIBETUNNEL_LOG_LEVEL</key>
       <string>debug</string>
       <!-- ... other env vars ... -->
   </dict>

   <!-- Bind to localhost only (more secure) -->
   <string>--bind</string>
   <string>127.0.0.1</string>
   ```

4. Reload the service:
   ```bash
   launchctl load ~/Library/LaunchAgents/sh.vibetunnel.server.plist
   ```

### Plist Reference

Key plist options you might want to modify:

| Key | Description | Default |
|-----|-------------|---------|
| `RunAtLoad` | Start when user logs in | `true` |
| `KeepAlive` | Restart if process exits | `true` |
| `ThrottleInterval` | Seconds between restart attempts | `10` |
| `StandardOutPath` | Log file for stdout | `~/Library/Logs/VibeTunnel/vibetunnel.log` |
| `StandardErrorPath` | Log file for stderr | `~/Library/Logs/VibeTunnel/vibetunnel.error.log` |
| `WorkingDirectory` | Working directory for the process | `~` |

## Architecture

### Why User-Level LaunchAgent?

VibeTunnel uses user-level LaunchAgents for several reasons:

1. **Security**: Runs with user privileges, not root
2. **Node.js Compatibility**: Works with user-installed Node.js version managers (nvm, fnm)
3. **User Data Access**: Natural access to your projects and Git repositories
4. **Simplicity**: No sudo required for management
5. **Isolation**: Each user can run their own instance

### The Wrapper Script

The installer creates a wrapper script at `~/.local/bin/vibetunnel-launchd` that:
- Searches for VibeTunnel in multiple locations
- Handles nvm and fnm installations
- Checks Homebrew paths (both Apple Silicon and Intel)
- Falls back to system-wide Node.js if needed
- Provides detailed logging for troubleshooting

### LaunchAgent vs LaunchDaemon

- **LaunchAgent** (what we use): Runs in user context, starts at login
- **LaunchDaemon**: Runs as root/system, starts at boot

We use LaunchAgent because:
- VibeTunnel doesn't need root privileges
- User-level services are more secure
- Works with user's Node.js installation
- Natural access to user's home directory

### Automatic Startup Behavior

Unlike Linux systemd with lingering, macOS LaunchAgents:
- Start automatically when the user logs in
- Do NOT run before login or after logout
- Are tied to the user session

If you need VibeTunnel to run before login (headless server), consider:
- Using a system-level LaunchDaemon (requires more setup)
- Enabling automatic login for your user
- Using SSH to access the machine (which creates a session)

## Troubleshooting

### Service Won't Start

1. Check if VibeTunnel is installed:
   ```bash
   which vibetunnel
   ```

2. Check service logs:
   ```bash
   tail -50 ~/Library/Logs/VibeTunnel/vibetunnel.error.log
   ```

3. Verify the wrapper script exists and is executable:
   ```bash
   ls -la ~/.local/bin/vibetunnel-launchd
   ```

4. Test the wrapper script directly:
   ```bash
   ~/.local/bin/vibetunnel-launchd --version
   ```

5. Check launchctl for errors:
   ```bash
   launchctl list | grep vibetunnel
   # If status is non-zero, check the error log
   ```

### Port Already in Use

If port 4020 is already in use:

1. Find what's using the port:
   ```bash
   lsof -i :4020
   ```

2. Either stop the conflicting service or change VibeTunnel's port in the plist file

### Node.js Version Manager Issues

If using nvm or fnm, ensure they're properly installed:

1. Check your installation:
   ```bash
   # For nvm
   echo $NVM_DIR
   ls ~/.nvm
   
   # For fnm
   echo $FNM_DIR
   ls ~/.local/share/fnm
   ```

2. The wrapper script searches these locations:
   - nvm: `~/.nvm`
   - fnm: `~/.local/share/fnm`
   - Homebrew: `/opt/homebrew/bin`, `/usr/local/bin`

### Permission Denied

If you get permission errors:

1. Ensure you're NOT running as root
2. Check file permissions:
   ```bash
   ls -la ~/Library/LaunchAgents/sh.vibetunnel.server.plist
   ls -la ~/.local/bin/vibetunnel-launchd
   ```

3. Fix permissions if needed:
   ```bash
   chmod 755 ~/.local/bin/vibetunnel-launchd
   chmod 644 ~/Library/LaunchAgents/sh.vibetunnel.server.plist
   ```

### Service Keeps Restarting

If the service keeps crashing and restarting:

1. Check the error log for crash reasons:
   ```bash
   tail -100 ~/Library/Logs/VibeTunnel/vibetunnel.error.log
   ```

2. The `ThrottleInterval` (10 seconds by default) prevents restart storms

3. If it's a configuration issue, temporarily disable KeepAlive:
   ```xml
   <key>KeepAlive</key>
   <false/>
   ```

### Logs Not Being Created

1. Check if the log directory exists:
   ```bash
   ls -la ~/Library/Logs/VibeTunnel/
   ```

2. Create it manually if needed:
   ```bash
   mkdir -p ~/Library/Logs/VibeTunnel
   ```

3. Check directory permissions:
   ```bash
   chmod 755 ~/Library/Logs/VibeTunnel
   ```

## Uninstallation

To completely remove the LaunchAgent:

```bash
# Method 1: Use the built-in uninstaller
vibetunnel launchd uninstall

# Method 2: Manual removal
launchctl unload ~/Library/LaunchAgents/sh.vibetunnel.server.plist
rm ~/Library/LaunchAgents/sh.vibetunnel.server.plist
rm ~/.local/bin/vibetunnel-launchd

# Optional: Remove logs
rm -rf ~/Library/Logs/VibeTunnel
```

The uninstaller will:
- Unload the running service
- Remove the plist file
- Remove the wrapper script
- Keep log files (remove manually if desired)

## Advanced Usage

### Multiple Instances

To run multiple VibeTunnel instances on different ports:

1. Copy the plist file with a new name:
   ```bash
   cp ~/Library/LaunchAgents/sh.vibetunnel.server.plist \
      ~/Library/LaunchAgents/sh.vibetunnel.server-dev.plist
   ```

2. Edit the new file:
   - Change the `Label` to `sh.vibetunnel.server-dev`
   - Change the port to a different value (e.g., 4021)

3. Load the new instance:
   ```bash
   launchctl load ~/Library/LaunchAgents/sh.vibetunnel.server-dev.plist
   ```

### Running on a Different Port

Edit the plist and change the port argument:

```xml
<key>ProgramArguments</key>
<array>
    <string>/Users/yourname/.local/bin/vibetunnel-launchd</string>
    <string>--port</string>
    <string>8080</string>
    <string>--bind</string>
    <string>0.0.0.0</string>
</array>
```

### Restricting Access to Localhost

For security, bind only to localhost:

```xml
<string>--bind</string>
<string>127.0.0.1</string>
```

### Custom Environment Variables

Add environment variables in the plist:

```xml
<key>EnvironmentVariables</key>
<dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>VIBETUNNEL_LOG_LEVEL</key>
    <string>debug</string>
    <key>MY_CUSTOM_VAR</key>
    <string>my_value</string>
</dict>
```

## Security Considerations

### Firewall Configuration

If binding to 0.0.0.0, ensure your macOS firewall is configured:

1. **System Settings** → **Network** → **Firewall**
2. Enable the firewall
3. Add VibeTunnel to allowed applications (or allow all incoming connections)

Alternatively, bind only to localhost for maximum security:
```xml
<string>--bind</string>
<string>127.0.0.1</string>
```

### Network Access

By default, VibeTunnel binds to all interfaces (0.0.0.0). This means:
- Accessible from localhost
- Accessible from other devices on your network
- Potentially accessible from the internet (if not behind NAT/firewall)

For local-only access, change the bind address to `127.0.0.1`.

## Comparison with Linux systemd

| Feature | macOS launchd | Linux systemd |
|---------|---------------|---------------|
| Config format | XML plist | INI |
| Config location | `~/Library/LaunchAgents/` | `~/.config/systemd/user/` |
| Start command | `launchctl start <label>` | `systemctl --user start <service>` |
| Stop command | `launchctl stop <label>` | `systemctl --user stop <service>` |
| Enable auto-start | `launchctl load <plist>` | `systemctl --user enable <service>` |
| View logs | `tail ~/Library/Logs/...` | `journalctl --user -u <service>` |
| Boot startup | Requires login or LaunchDaemon | Requires lingering |

## FAQ

**Q: Why does the service only start after I log in?**
A: LaunchAgents are user-level services that run in your login session. This is by design for security and compatibility. For headless operation, enable automatic login or use SSH.

**Q: Can I run this on a Mac mini server?**
A: Yes! Enable automatic login in System Settings → Users & Groups → Login Options, and the LaunchAgent will start automatically after boot.

**Q: What if I use nvm and switch Node versions?**
A: The wrapper script detects nvm and uses your default Node version. If you switch versions, the change will take effect after restarting the service.

**Q: How do I run VibeTunnel on a different port?**
A: Edit the plist file and change the `--port` argument, then reload the service.

**Q: Can multiple users run VibeTunnel on the same Mac?**
A: Yes, each user can install their own LaunchAgent. Just ensure they use different ports.

**Q: How do I check if the service is running?**
A: Run `launchctl list | grep vibetunnel` or `vibetunnel launchd status`.

## Support

For issues specific to the LaunchAgent service:
1. Check the logs with `tail ~/Library/Logs/VibeTunnel/vibetunnel.error.log`
2. Verify the installation with `vibetunnel launchd status`
3. Report issues at https://github.com/arunsanna/vibetunnel/issues
