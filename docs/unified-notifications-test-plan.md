# Unified Notification System Test Plan

## Overview
Test the new unified notification system that sends all notifications from the server to Mac via Unix socket.

## Architecture Changes
- Server SessionMonitor detects all notification events
- Events sent to Mac via Unix socket (session-monitor category)
- Mac NotificationControlHandler processes and displays notifications
- No more polling or duplicate detection logic

## Test Scenarios

### 1. Bell Notification Test
```bash
# In any VibeTunnel session
echo -e '\a'
# or
printf '\007'
```
**Expected**: Bell notification appears on both Mac and Web

### 2. Claude Turn Notification Test
```bash
# Start a Claude session
claude "Tell me a joke"
# Wait for Claude to finish responding
```
**Expected**: "Claude has finished responding" notification on both platforms

### 3. Command Completion Test (>3 seconds)
```bash
# Run a command that takes more than 3 seconds
sleep 4
# or
find / -name "*.txt" 2>/dev/null | head -100
```
**Expected**: Command completion notification after command finishes

### 4. Command Error Test
```bash
# Run a command that fails
ls /nonexistent/directory
# or
false
```
**Expected**: Command error notification with exit code

### 5. Session Start/Exit Test
```bash
# From another terminal or web UI
# Create new session
# Exit session with 'exit' command
```
**Expected**: Session start and exit notifications

## Verification Steps

1. **Enable all notifications in Mac Settings**:
   - Open VibeTunnel → Settings → Notifications
   - Enable "Show Session Notifications" 
   - Enable all notification types
   - Enable sound if desired

2. **Monitor Unix socket traffic** (optional):
   ```bash
   # In a separate terminal, monitor the control socket
   sudo dtrace -n 'syscall::write:entry /execname == "VibeTunnel" || execname == "node"/ { printf("%d: %s", pid, copyinstr(arg1, 200)); }'
   ```

3. **Check logs**:
   ```bash
   # Monitor VibeTunnel logs
   ./scripts/vtlog.sh -f -c NotificationControl
   
   # Check for session-monitor events
   ./scripts/vtlog.sh -f | grep "session-monitor"
   ```

## Success Criteria

1. ✅ All notification types work on Mac via Unix socket
2. ✅ No duplicate notifications
3. ✅ Notifications respect user preferences (on/off toggles)
4. ✅ No more 3-second polling from Mac SessionMonitor
5. ✅ Single source of truth (server) for all notification events

## Troubleshooting

- If no notifications appear, check:
  - Mac app is connected to server (check Unix socket connection)
  - Notifications are enabled in settings
  - Check vtlog for any errors
  
- If notifications are delayed:
  - Check if bell detection is working (should be instant)
  - Claude turn has 2-second debounce by design
  
- If getting duplicate notifications:
  - Ensure only one VibeTunnel instance is running
  - Check that old SessionMonitor code is not running