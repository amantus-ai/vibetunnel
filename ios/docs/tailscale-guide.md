# Tailscale Integration Guide for VibeTunnel iOS

## Overview

Tailscale integration allows you to securely connect to your VibeTunnel servers from anywhere without complex network configuration. This guide explains how to set up and use Tailscale with the VibeTunnel iOS app.

## What is Tailscale?

Tailscale creates a secure, private network (called a tailnet) between your devices using WireGuard encryption. With VibeTunnel's Tailscale integration, you can:

- Access your Mac's terminal sessions from anywhere
- No port forwarding or firewall configuration needed
- Automatic secure connections between devices
- Seamless switching between local and remote access

## Prerequisites

Before setting up Tailscale in VibeTunnel iOS:

1. **Tailscale Account**: Create a free account at [tailscale.com](https://tailscale.com)
2. **Tailscale on Mac**: Install Tailscale on your Mac running VibeTunnel server
3. **OAuth Credentials**: You'll need to create OAuth client credentials (instructions below)

## Setting Up OAuth Client Credentials

VibeTunnel iOS uses OAuth to securely access your Tailscale network. Here's how to create the required credentials:

### Step 1: Access Tailscale Admin Console

1. Sign in to [Tailscale Admin Console](https://login.tailscale.com/admin)
2. Navigate to **Settings** → **OAuth clients**

### Step 2: Generate OAuth Client

1. Click **"Generate OAuth client"**
2. Configure the client:
   - **Description**: Enter "VibeTunnel iOS" (or any name you prefer)
   - **Scopes**: Add `devices` scope with **Read** access
   - This allows the app to discover VibeTunnel servers on your network

### Step 3: Save Your Credentials

After creating the client, you'll receive:
- **Client ID**: Starts with `k` (e.g., `k4cdcxxxxxxxx`)
- **Client Secret**: Starts with `tskey-client-` (e.g., `tskey-client-xxxxxx`)

⚠️ **Important**: Save the Client Secret immediately - it's only shown once!

## Configuring Tailscale in VibeTunnel iOS

### Initial Setup

1. Open VibeTunnel iOS app
2. Go to **Settings** → **Tailscale**
3. Tap **"Configure Tailscale"**
4. Enter your credentials:
   - Paste your **Client ID**
   - Paste your **Client Secret**
5. Tap **Save**

The app will verify your credentials and begin discovering VibeTunnel servers on your tailnet.

### Connection Status Indicators

The Tailscale settings page shows:
- 🟢 **Connected**: Successfully connected to Tailscale
- 🟠 **Not Connected**: Credentials configured but connection failed
- 🔴 **Not Configured**: No credentials set up yet

## Understanding Server Connection Modes

VibeTunnel servers can operate in two modes when accessed via Tailscale:

### Public Mode (HTTPS with Tailscale Funnel)

When your Mac has Tailscale Funnel enabled:
- Server is accessible from the internet
- Uses HTTPS with valid SSL certificates
- Shows 🔒 **lock icon** next to server URL
- Ideal for accessing from anywhere

### Private Mode (HTTP with Tailscale Serve)

When using standard Tailscale networking:
- Server only accessible within your tailnet
- Uses HTTP (HTTPS certificates don't work on mobile)
- Shows 🔓 **unlock icon** next to server URL
- Perfect for private, secure access

### Automatic Mode Switching

The iOS app intelligently handles mode transitions:

1. **On App Launch**: Checks all saved Tailscale servers for current status
2. **Connection Attempts**: Automatically falls back from HTTPS to HTTP if needed
3. **Visual Updates**: Lock/unlock icons update to reflect current connection type
4. **Seamless Experience**: You don't need to manually reconfigure when server modes change

## Using Tailscale Servers

### Discovering Servers

With Tailscale configured:

1. The app automatically discovers VibeTunnel servers on your tailnet
2. Found servers appear in the **Discovered Servers** section
3. Tap **Add** to save a server for quick access

### Connecting to Servers

1. Saved Tailscale servers appear in your server list
2. Tap any server card to connect
3. The app will:
   - Check server availability
   - Determine best connection method (HTTPS/HTTP)
   - Establish secure connection
   - Show authentication prompt if needed

### Connection Features

- **Entire Card Tappable**: Tap anywhere on the server card to connect
- **Status Indicators**: Visual feedback for connection state
- **Error Alerts**: Clear messages if connection fails
- **Automatic Retry**: Falls back to HTTP if HTTPS fails

## Settings and Preferences

### Understanding the Three Key Switches

#### 1. Auto-Discover Servers (Default: ON)
- **What it does**: Enables automatic discovery of VibeTunnel servers on your Tailscale network
- **When ON**: The app uses Tailscale API to find servers running VibeTunnel
- **When OFF**: Tailscale discovery is disabled, but you can still manually add Tailscale servers
- **Important**: This does NOT affect Bonjour discovery - local network discovery continues working

#### 2. Prefer Tailscale Connections (Default: OFF)
- **What it does**: Chooses Tailscale connection when both local and Tailscale are available
- **When ON**: Always uses Tailscale connection if available (useful for consistent remote access)
- **When OFF**: Uses the best available connection (typically local when on same network)
- **Example**: If you're at home with your Mac, OFF uses local network (faster), ON uses Tailscale (consistent)
- **Note**: Does NOT disable Bonjour or local connections - just changes preference

#### 3. Auto-Refresh Discovery (Default: ON)
- **What it does**: Automatically checks for new/changed servers every 30 seconds
- **When ON**: Continuously monitors for new VibeTunnel servers joining your tailnet
- **When OFF**: Only discovers servers when you manually refresh or open the app
- **Requirement**: Auto-Discover Servers must be ON for this to work
- **Battery Impact**: Minimal - uses efficient API polling

### Recommended Settings

**For Most Users:**
- ✅ Auto-Discover Servers: ON
- ❌ Prefer Tailscale Connections: OFF (use local when available, Tailscale when remote)
- ✅ Auto-Refresh Discovery: ON

**For Always-Remote Access:**
- ✅ Auto-Discover Servers: ON
- ✅ Prefer Tailscale Connections: ON (consistent experience everywhere)
- ✅ Auto-Refresh Discovery: ON

**For Battery Saving:**
- ✅ Auto-Discover Servers: ON
- ❌ Prefer Tailscale Connections: OFF
- ❌ Auto-Refresh Discovery: OFF (manually refresh when needed)

### How Discovery Works

The app uses **two independent discovery methods**:

1. **Bonjour/mDNS** (Always Active)
   - Discovers servers on your local network
   - Works without any configuration
   - Cannot be disabled (and shouldn't be!)
   - Shows servers with network icon

2. **Tailscale Discovery** (Configurable)
   - Discovers servers through Tailscale API
   - Requires OAuth credentials
   - Controlled by the three switches above
   - Shows servers with Tailscale badge

Both methods work simultaneously, giving you the best of both worlds!

### Managing Discovered Servers

- Discovered servers can be added to your saved servers list
- The app remembers which servers you've already added
- Servers show their Tailscale hostname and IP address

## Troubleshooting

### Connection Issues

**Problem**: Can't connect to server
- Verify server is running on your Mac
- Check Tailscale is connected on both devices
- Ensure OAuth token hasn't expired (auto-refreshes after 1 hour)
- Try **Retry Connection** button

**Problem**: Authentication errors
- The app will prompt for credentials when needed
- Credentials are securely stored in iOS Keychain
- Re-enter credentials if authentication fails persistently

### Mode Switching Issues

**Problem**: Server shows wrong lock icon
- The app updates on launch and connection
- Pull down to refresh the server list
- Icons reflect actual connection capability, not preference

**Problem**: HTTPS connection fails
- This is normal for private mode
- App automatically falls back to HTTP
- No action needed - this is handled automatically

### Discovery Problems

**Problem**: No servers found
- Ensure VibeTunnel server is running on your Mac
- Verify Mac has Tailscale installed and connected
- Check OAuth client has `devices:read` permission
- Tap **Refresh Servers** to manually scan

### Credential Issues

**Problem**: "Invalid credentials" error
- Client ID must start with `k`
- Client Secret must start with `tskey-client-`
- Regenerate OAuth client if credentials are lost
- Use **Reset Configuration** to start fresh

## Security Considerations

### OAuth Token Management

- Access tokens expire after 1 hour
- App automatically refreshes tokens using stored credentials
- Credentials stored securely in iOS Keychain
- Tokens never leave your device

### Connection Security

- **Tailscale Funnel (Public)**: End-to-end HTTPS encryption
- **Tailscale Network (Private)**: WireGuard VPN encryption
- All connections authenticated before establishing
- No passwords transmitted over network

### Best Practices

1. **Protect OAuth Credentials**: Never share Client Secret
2. **Regular Updates**: Keep VibeTunnel and Tailscale updated
3. **Monitor Access**: Review connected devices in Tailscale admin
4. **Use Strong Authentication**: Enable 2FA on Tailscale account

## Advanced Features

### Health Checks

The app performs automatic health checks:
- On app startup for all Tailscale servers
- Before each connection attempt
- Updates server profiles with current capabilities
- Only applies to Tailscale-discovered servers

### Fallback Logic

Smart connection fallback:
1. Try HTTPS if server reports it's available
2. Fall back to HTTP if HTTPS fails
3. Show appropriate visual indicators
4. Remember successful connection method

### Server Profile Management

- Tailscale servers marked with special flag
- Health checks only run for Tailscale servers
- Bonjour and manually added servers unaffected
- Profiles automatically update when server capabilities change

## Resetting Tailscale Configuration

If you need to start over:

1. Go to **Settings** → **Tailscale**
2. Scroll to **Danger Zone**
3. Tap **Reset Tailscale Configuration**
4. Confirm the reset

This will:
- Remove stored OAuth credentials
- Clear all discovered servers
- Reset preferences to defaults
- Require re-entering credentials

## Frequently Asked Questions

**Q: Why does my server sometimes show a lock and sometimes not?**
A: The lock icon indicates HTTPS availability. It changes based on whether Tailscale Funnel is enabled on your Mac.

**Q: Do I need the Tailscale app on my iPhone?**
A: No, VibeTunnel iOS handles everything through the OAuth API. The Tailscale iOS app is not required.

**Q: Can I use Tailscale and local network discovery together?**
A: Yes! The app supports both Tailscale and Bonjour discovery simultaneously.

**Q: Is my terminal data encrypted?**
A: Yes, all connections use either HTTPS (Funnel) or WireGuard VPN encryption (Tailscale network).

**Q: What happens if my OAuth token expires?**
A: The app automatically refreshes tokens using your stored credentials. You'll only need to re-enter credentials if they become invalid.

## Getting Help

If you encounter issues not covered in this guide:

1. Check the VibeTunnel Mac app is running
2. Verify Tailscale status on both devices
3. Review error messages in the app
4. Check server logs using `vtlog.sh` on your Mac

For additional support:
- VibeTunnel Issues: [GitHub Issues](https://github.com/anthropics/vibetunnel/issues)
- Tailscale Documentation: [tailscale.com/kb](https://tailscale.com/kb)

## Summary

Tailscale integration makes VibeTunnel incredibly powerful for remote access:

- **Simple Setup**: Just OAuth credentials, no network configuration
- **Automatic Discovery**: Finds your servers instantly
- **Smart Connections**: Handles HTTPS/HTTP automatically
- **Secure Access**: Enterprise-grade encryption
- **Seamless Experience**: Works like magic

With this setup, your terminal sessions are securely accessible from anywhere, whether you're on your local network, at a coffee shop, or traveling abroad. The app handles all the complexity, so you can focus on your work.