# Fixing macOS Log Redaction for VibeTunnel

## Quick Fix: Configuration Profile (Recommended)

We provide a ready-to-use configuration profile that enables full debug logging for VibeTunnel:

**Location**: `apple/logging/VibeTunnel-Logging.mobileconfig`

### Installing the Profile

#### macOS
1. Double-click `apple/logging/VibeTunnel-Logging.mobileconfig`
2. System Settings will open to the Profiles section
3. Click "Install..." and enter your password
4. Restart VibeTunnel

#### iOS
1. AirDrop or email the profile to your device
2. Open Settings → General → VPN & Device Management
3. Install the "VibeTunnel Debug Logging" profile
4. Restart the VibeTunnel app

### Verifying It Works
```bash
# You should now see full details instead of <private>
./scripts/vtlog.sh
```

### Removing the Profile
- **macOS**: System Settings → Privacy & Security → Profiles → Remove
- **iOS**: Settings → General → VPN & Device Management → Remove Profile

## The Problem

When viewing VibeTunnel logs using Apple's unified logging system, you'll see `<private>` instead of actual values:

```
2025-07-05 08:40:08.062262+0100 VibeTunnel: Failed to connect to <private> after <private> seconds
```

This makes debugging extremely difficult as you can't see session IDs, URLs, or other important debugging information.

## Why Apple Does This

Apple redacts dynamic values in logs by default to protect user privacy:
- Prevents accidental logging of passwords, tokens, or personal information
- Logs can be accessed by other apps with proper entitlements
- Helps apps comply with privacy regulations (GDPR, etc.)

## The Solution: Passwordless sudo for log command

### Step 1: Edit sudoers file

```bash
sudo visudo
```

### Step 2: Add the NOPASSWD rule

Add this line at the end of the file (replace `yourusername` with your actual username):

```
yourusername ALL=(ALL) NOPASSWD: /usr/bin/log
```

For example, if your username is `steipete`:
```
steipete ALL=(ALL) NOPASSWD: /usr/bin/log
```

### Step 3: Save and exit

- Press `Esc` to enter command mode
- Type `:wq` and press Enter to save and quit
- The changes take effect immediately

### Step 4: Test it

```bash
# This should work without asking for password:
sudo -n log show --last 1s

# Now vtlog.sh with private flag works without password:
./scripts/vtlog.sh -p
```

## How It Works

1. **Normal log viewing** (redacted):
   ```bash
   log show --predicate 'subsystem == "sh.vibetunnel.vibetunnel"'
   # Shows: Connected to <private>
   ```

2. **With sudo and --info flag** (reveals private data):
   ```bash
   sudo log show --predicate 'subsystem == "sh.vibetunnel.vibetunnel"' --info
   # Shows: Connected to session-123abc
   ```

3. **vtlog.sh -p flag** automatically:
   - Adds `sudo` to the command
   - Adds `--info` flag to reveal private data
   - With our sudoers rule, no password needed\!

## Security Considerations

### What this allows:
- ✅ Passwordless access to `log` command only
- ✅ Can view all system logs without password
- ✅ Can stream logs in real-time

### What this does NOT allow:
- ❌ Cannot run other commands with sudo
- ❌ Cannot modify system files
- ❌ Cannot install software
- ❌ Cannot change system settings

### Best Practices:
1. Only grant this permission to trusted developer accounts
2. Use the most restrictive rule possible
3. Consider removing when not actively debugging
4. Never use `NOPASSWD: ALL` - always specify exact commands

## Alternative Solutions

### 1. Touch ID for sudo (if you have a Mac with Touch ID)

Edit `/etc/pam.d/sudo`:
```bash
sudo vi /etc/pam.d/sudo
```

Add this line at the top (after the comment):
```
auth       sufficient     pam_tid.so
```

Now you can use your fingerprint instead of typing password.

### 2. Extend sudo timeout

Make sudo remember your password longer:
```bash
sudo visudo
```

Add:
```
Defaults timestamp_timeout=60
```

This keeps sudo active for 60 minutes after each use.

### 3. Fix in Swift code

Mark non-sensitive values as public in your Swift logging:
```swift
// Before (will show as <private>):
logger.info("Connected to \(sessionId)")

// After (always visible):
logger.info("Connected to \(sessionId, privacy: .public)")
```

### 4. Configure logging system (Modern Methods)

#### Method A: Plist File (Recommended)

Create a plist file to enable private data logging for VibeTunnel:

```bash
# Create the directory if it doesn't exist
sudo mkdir -p /Library/Preferences/Logging/Subsystems

# Create the plist file
sudo tee /Library/Preferences/Logging/Subsystems/sh.vibetunnel.vibetunnel.plist > /dev/null << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Enable-Private-Data</key>
    <true/>
</dict>
</plist>
EOF

# Verify it was created
ls -la /Library/Preferences/Logging/Subsystems/sh.vibetunnel.vibetunnel.plist
```

To remove:
```bash
sudo rm /Library/Preferences/Logging/Subsystems/sh.vibetunnel.vibetunnel.plist
```

#### Method B: Configuration Profile

For managed environments or multiple subsystems, create a configuration profile:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadType</key>
            <string>com.apple.system.logging</string>
            <key>PayloadIdentifier</key>
            <string>com.example.logging.vibetunnel</string>
            <key>PayloadUUID</key>
            <string>$(uuidgen)</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>Subsystems</key>
            <dict>
                <key>sh.vibetunnel.vibetunnel</key>
                <dict>
                    <key>Enable-Private-Data</key>
                    <true/>
                </dict>
            </dict>
        </dict>
    </array>
    <key>PayloadIdentifier</key>
    <string>com.example.vibetunnel.logging</string>
    <key>PayloadUUID</key>
    <string>$(uuidgen)</string>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>
```

Install via System Settings → Profiles.

**Note:** The old `private_data:on` flag was removed in macOS Catalina and no longer works.

## Using vtlog.sh

With passwordless sudo configured, you can now use:

```bash
# View all logs with private data visible
./scripts/vtlog.sh -p

# Filter by category with private data
./scripts/vtlog.sh -p -c WebRTCManager

# Follow logs in real-time with private data
./scripts/vtlog.sh -p -f

# Search for errors with private data visible
./scripts/vtlog.sh -p -s "error" -n 1h

# Combine filters
./scripts/vtlog.sh -p -c ServerManager -s "connection" -f
```

## Troubleshooting

### "sudo: a password is required"
- Make sure you saved the sudoers file (`:wq` in vi)
- Try in a new terminal window
- Run `sudo -k` to clear sudo cache, then try again
- Verify the line exists: `sudo grep NOPASSWD /etc/sudoers`

### "syntax error" when saving sudoers
- Never edit `/etc/sudoers` directly\!
- Always use `sudo visudo` - it checks syntax before saving
- Make sure the line format is exactly:
  ```
  username ALL=(ALL) NOPASSWD: /usr/bin/log
  ```

### Changes not taking effect
- Close and reopen your terminal
- Make sure you're using the exact username from `whoami`
- Check that `/usr/bin/log` exists: `ls -la /usr/bin/log`

### Still seeing <private> with -p flag
- Verify sudo works: `sudo -n log show --last 1s`
- Check vtlog.sh has execute permissions: `chmod +x scripts/vtlog.sh`
- Make sure you're using `-p` flag: `./scripts/vtlog.sh -p`

## Summary

The passwordless sudo configuration for `/usr/bin/log` is the cleanest solution:
- Works immediately after setup
- No password prompts when debugging
- Limited security risk (only affects log viewing)
- Easy to revert if needed

Combined with `vtlog.sh -p`, you get a smooth debugging experience without the frustration of `<private>` tags hiding important information.
ENDOFFILE < /dev/null