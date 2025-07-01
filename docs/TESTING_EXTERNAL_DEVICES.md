# Testing VibeTunnel on External Devices

This guide explains how to test VibeTunnel development changes on external devices like iPads, iPhones, and other computers.

## Overview

When developing VibeTunnel's web interface, you may encounter browser-specific issues that only appear on certain devices (e.g., Safari on iPad). This guide shows you how to test your local development changes on these devices without deploying.

## Quick Start: Development Server Method

This is the recommended approach for rapid iteration during development.

### 1. Start the Development Server

```bash
cd web
pnpm run dev --port 4021 --bind 0.0.0.0
```

**Key parameters:**
- `--port 4021`: Use a different port than the production server (4020)
- `--bind 0.0.0.0`: Bind to all network interfaces (not just localhost)

### 2. Find Your Mac's IP Address

**Option A: System Preferences**
1. Open System Preferences → Network
2. Select Wi-Fi → Advanced → TCP/IP
3. Look for "IPv4 Address"

**Option B: Terminal**
```bash
# For Wi-Fi connection
ipconfig getifaddr en0

# For Ethernet connection
ipconfig getifaddr en1
```

### 3. Access from External Device

Open a browser on your external device and navigate to:
```
http://[your-mac-ip]:4021
```

Example: `http://192.168.1.42:4021`

## Production Build Method

Use this method when you need to test with the full Mac app integration.

### 1. Build the Web Project

```bash
cd web
pnpm run build
```

### 2. Configure VibeTunnel for Network Access

1. Open VibeTunnel from the menu bar
2. Go to Settings → Dashboard Access
3. Select "Network" mode
4. Set a dashboard password (required for network access)

### 3. Access from External Device

```
http://[your-mac-ip]:4020
```

## Common Issues and Solutions

### Cannot Connect from External Device

**Check network connectivity:**
- Ensure both devices are on the same Wi-Fi network
- Verify the IP address is correct
- Try pinging your Mac from the external device

**Check firewall settings:**
- macOS may block incoming connections
- When prompted, click "Allow" for Node.js/Bun
- Check System Preferences → Security & Privacy → Firewall

**Verify server is running:**
```bash
# Check if the port is listening
lsof -i :4021
```

### Changes Not Appearing

**For development server:**
- Hot reload should work automatically
- Try hard refresh on the external device (Cmd+Shift+R on Safari)
- Check the terminal for build errors

**For production build:**
- You must rebuild after each change: `pnpm run build`
- Restart the VibeTunnel server after building
- Clear browser cache on the external device

### Safari-Specific Issues

**Enable Developer Mode on iOS/iPadOS:**
1. Settings → Safari → Advanced → Web Inspector (ON)
2. Connect device to Mac via USB
3. Open Safari on Mac → Develop menu → [Your Device]
4. Select the page to inspect

**Common Safari quirks:**
- Different touch event handling
- Stricter security policies
- Different viewport behavior
- WebSocket connection issues

## Advanced Testing Scenarios

### Testing with HTTPS

Some features may require HTTPS. Use ngrok for secure tunneling:

```bash
# Install ngrok
brew install ngrok

# Create tunnel to dev server
ngrok http 4021
```

### Testing Different Network Conditions

Use Chrome DevTools or Safari Web Inspector to simulate:
- Slow network connections
- Offline mode
- Different device viewports

### Multi-Device Testing

Test on multiple devices simultaneously:
```bash
# Terminal 1: Development server
pnpm run dev --port 4021 --bind 0.0.0.0

# Terminal 2: Production server (if needed)
# VibeTunnel app handles this automatically
```

## Security Considerations

**Development only:**
- Only use `--bind 0.0.0.0` on trusted networks
- The dev server has no authentication
- Consider using a firewall to restrict access

**Production testing:**
- Always set a dashboard password
- Use Tailscale or ngrok for remote access
- Never expose unprotected servers to the internet

## Debugging Tips

### Console Access on Mobile

**Safari on iOS/iPadOS:**
1. Enable Web Inspector (see above)
2. Connect device to Mac
3. Use Safari Developer Tools

**Chrome on Android:**
1. Enable Developer Options
2. Connect via USB
3. Open chrome://inspect on desktop Chrome

### Network Debugging

Monitor network requests:
```bash
# Watch incoming connections
sudo lsof -i -P | grep LISTEN | grep 4021

# Monitor HTTP traffic
sudo tcpdump -i en0 port 4021
```

### Performance Profiling

Use browser developer tools to:
- Profile JavaScript performance
- Analyze rendering bottlenecks
- Check memory usage
- Monitor WebSocket traffic

## Best Practices

1. **Always test on real devices** - Emulators don't catch all issues
2. **Test on multiple browsers** - Safari, Chrome, Firefox behave differently
3. **Check different orientations** - Portrait and landscape modes
4. **Test with poor network** - Not everyone has fast Wi-Fi
5. **Verify touch interactions** - Mouse events ≠ touch events
6. **Check responsive design** - Different screen sizes and resolutions

## Related Documentation

- [README.md](../README.md) - General setup and usage
- [CONTRIBUTING.md](CONTRIBUTING.md) - Development workflow
- [spec.md](spec.md) - Technical specification
- [architecture.md](architecture.md) - System architecture