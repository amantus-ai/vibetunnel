# Terminal Multiplexer Integration

VibeTunnel supports seamless integration with terminal multiplexers like tmux and Zellij, allowing you to attach to existing sessions and manage them through the web interface.

## Overview

The multiplexer integration allows you to:
- List and attach to existing tmux/Zellij sessions
- Navigate between windows and panes (tmux)
- Create new sessions
- Kill sessions
- Maintain persistent terminal sessions across connections

## Supported Multiplexers

### tmux
- Full support for sessions, windows, and panes
- Shows session details including creation time, attached status, and window count
- Navigate to specific windows and panes
- Create sessions with optional initial commands

### Zellij
- Session management with creation time tracking
- Automatic session creation on first attach
- Layout support for new sessions
- ANSI color code handling in session names

## Usage

### Accessing Multiplexer Sessions

1. Click the terminal icon in the session list
2. The multiplexer modal will open showing available sessions
3. For tmux sessions, expand to see windows and panes
4. Click "Attach" to connect to any session, window, or pane

### Creating New Sessions

#### tmux
```bash
# Create a new session
POST /api/multiplexer/sessions
{
  "type": "tmux",
  "name": "dev-session",
  "command": "vim"  // optional initial command
}
```

#### Zellij
```bash
# Create a new session (created on first attach)
POST /api/multiplexer/sessions
{
  "type": "zellij",
  "name": "dev-session",
  "layout": "compact"  // optional layout
}
```

### API Endpoints

#### Get Multiplexer Status
```bash
GET /api/multiplexer/status
```
Returns the availability and session list for all multiplexers.

#### Get tmux Windows
```bash
GET /api/multiplexer/tmux/sessions/:session/windows
```
Returns all windows in a tmux session.

#### Get tmux Panes
```bash
GET /api/multiplexer/tmux/sessions/:session/panes?window=:windowIndex
```
Returns panes in a session or specific window.

#### Attach to Session
```bash
POST /api/multiplexer/attach
{
  "type": "tmux|zellij",
  "sessionName": "main",
  "windowIndex": 0,      // tmux only, optional
  "paneIndex": 1,        // tmux only, optional
  "cols": 120,           // optional terminal dimensions
  "rows": 40
}
```

#### Kill Session
```bash
DELETE /api/multiplexer/sessions/:type/:sessionName
```

### Legacy tmux API Compatibility

The following legacy endpoints are maintained for backward compatibility:
- `GET /api/tmux/sessions` - List tmux sessions
- `POST /api/tmux/attach` - Attach to tmux session

## Implementation Details

### Architecture

The multiplexer integration consists of:
- `MultiplexerManager` - Unified interface for all multiplexers
- `TmuxManager` - tmux-specific implementation
- `ZellijManager` - Zellij-specific implementation
- `multiplexer-modal` - LitElement component for the UI

### Session Attachment

When attaching to a multiplexer session:
1. A new VibeTunnel PTY session is created
2. The session runs the appropriate attach command (e.g., `tmux attach-session -t main`)
3. The multiplexer takes over the terminal, providing its own UI
4. Users can navigate within the multiplexer using native keybindings

### Key Features

#### Automatic Detection
The system automatically detects installed multiplexers and only shows available options.

#### Session Persistence
Multiplexer sessions persist even when VibeTunnel is restarted, allowing you to maintain long-running processes.

#### Native Experience
Once attached, you interact with the multiplexer using its native keybindings (e.g., Ctrl-B for tmux).

#### Clean Session Names
Zellij session names are automatically cleaned of ANSI escape codes for better display.

## Best Practices

1. **Use descriptive session names** - Makes it easier to identify sessions later
2. **Organize with windows** (tmux) - Group related tasks in different windows
3. **Leverage layouts** (Zellij) - Use predefined layouts for common workflows
4. **Clean up old sessions** - Kill sessions you're no longer using to free resources

## Troubleshooting

### Sessions Not Showing
- Ensure tmux/Zellij is installed on the system
- Check that sessions exist by running `tmux ls` or `zellij list-sessions`

### Cannot Attach to Session
- Verify the session name is correct
- Check if the session is already attached elsewhere (some configurations prevent multiple attachments)

### Display Issues
- Ensure terminal dimensions match between client and server
- Try resizing the browser window to trigger a resize event