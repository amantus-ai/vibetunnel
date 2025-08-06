# Quickstart Guide

## Installation

### Download & Install
1. Download VibeTunnel.dmg from [Releases](https://github.com/steipete/vibetunnel/releases)
2. Open DMG and drag VibeTunnel to Applications
3. Launch VibeTunnel from Applications
4. Grant accessibility permissions when prompted

### First Terminal

```bash
# Open a terminal session in your browser
vt

# Named session
vt --name "Project Build"

# Custom command
vt --command "htop"
```

The browser opens automatically at `http://localhost:4020`

## Essential Commands

| Command | Purpose |
|---------|---------|
| `vt` | Start new terminal session |
| `vt list` | Show active sessions |
| `vt kill <id>` | Terminate session |
| `vt logs` | View server logs |
| `vt --help` | Show all options |

## Configuration

### Settings Location
```
~/Library/Preferences/com.steipete.VibeTunnel.plist
```

### Key Settings

| Setting | Default | Options |
|---------|---------|---------|
| Port | 4020 | Any available port |
| Authentication | None | Password, Token |
| Network | Localhost | LAN, Tailscale |
| Auto-start | Disabled | Enable at login |

### Enable LAN Access
1. Click VibeTunnel menu bar icon
2. Select Preferences
3. Toggle "Allow LAN Connections"
4. Set password for security

## Development Mode

### Using Development Server
```bash
# Enable in VibeTunnel settings
Settings → Debug → Use Development Server

# Or run manually
cd web
pnpm install
pnpm dev
```

Benefits:
- Hot reload for web changes
- No Mac app rebuild needed
- Faster iteration

## Common Workflows

### Monitor AI Agents
```bash
# Start Claude Code in VibeTunnel
vt --name "Claude Code"
claude

# Access from another device
http://your-mac-ip:4020
```

### Remote Development
```bash
# With Tailscale
vt --tailscale

# With ngrok
vt --ngrok
```

### Multiple Sessions
```bash
# Start multiple named sessions
vt --name "Frontend" --command "cd ~/frontend && npm run dev"
vt --name "Backend" --command "cd ~/backend && npm start"
vt --name "Database" --command "docker-compose up"
```

## Keyboard Shortcuts

### Terminal

| Shortcut | Action |
|----------|--------|
| `Cmd+C` | Copy selection |
| `Cmd+V` | Paste |
| `Cmd+K` | Clear terminal |
| `Cmd+T` | New session |
| `Cmd+W` | Close session |

### Web Interface

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+C` | Copy |
| `Ctrl+Shift+V` | Paste |
| `Alt+1-9` | Switch tabs |
| `Ctrl+Alt+T` | New terminal |

## Troubleshooting Quick Fixes

### Server Won't Start
```bash
# Check if port is in use
lsof -i :4020

# Kill existing process
killall node

# Restart VibeTunnel
osascript -e 'quit app "VibeTunnel"'
open -a VibeTunnel
```

### Can't Connect
```bash
# Check server status
curl http://localhost:4020/api/health

# View logs
./scripts/vtlog.sh -e
```

### Permission Issues
1. System Preferences → Security & Privacy
2. Privacy → Accessibility
3. Add VibeTunnel.app
4. Restart VibeTunnel

## Next Steps

- [Development Setup](development.md) - Build from source
- [API Reference](../core/api-reference.md) - Integrate with VibeTunnel
- [iOS App Setup](../platform/ios.md) - Mobile access
- [Security Guide](../features/authentication.md) - Secure your sessions

## Quick Tips

1. **Auto-start**: Enable "Launch at Login" in preferences
2. **Custom port**: Set `VT_PORT=8080` environment variable
3. **Debug mode**: Hold Option while clicking menu bar icon
4. **Force quit session**: `vt kill --force <id>`
5. **Export recordings**: Sessions saved in `~/.vibetunnel/recordings/`