# Terminal Title Management in VibeTunnel

VibeTunnel provides comprehensive terminal title management with four distinct modes to suit different workflows and preferences.

## Title Modes

VibeTunnel offers four terminal title management modes:

### 1. None Mode (Default)
- **Behavior**: No title management - applications control their own titles
- **Use case**: When you want standard terminal behavior
- **Example**: Standard shell prompts, vim, etc.

### 2. Filter Mode
- **Behavior**: Blocks all title changes from applications
- **Use case**: When you want to maintain your own terminal organization system
- **Example**: Using custom terminal title management scripts
- **CLI**: `--title-mode filter`

### 3. Static Mode
- **Behavior**: Shows working directory and command in title
- **Format**: `~/path/to/project — command — session name`
- **Use case**: Basic session identification
- **Examples**:
  - `~/Projects/vibetunnel5 — zsh`
  - `~/Projects/app — npm — Dev Server`
- **CLI**: `--title-mode static`

### 4. Dynamic Mode
- **Behavior**: Shows directory, command, and real-time activity status
- **Format**: `~/path — command [— activity] — session name`
- **Activity indicators**:
  - `•` - Generic activity within last 5 seconds
  - App-specific status (e.g., Claude: `✻ Crafting (205s, ↑6.0k)`)
- **Use case**: Monitoring active processes and their status
- **Auto-selected**: For Claude commands
- **CLI**: `--title-mode dynamic`

## Using Title Modes

### Web Interface

When creating a new session through the web interface, the default is Dynamic mode, which provides real-time activity tracking. You can select a different mode from the dropdown:

```
Terminal Title Mode: [Dynamic ▼]
  - None - No title management
  - Filter - Block title changes  
  - Static - Show path & command
  - Dynamic - Show path, command & activity
```

Dynamic mode is also automatically selected when running Claude from the command line.

### Command Line (fwd.ts)

```bash
# Explicitly set title mode
pnpm exec tsx src/server/fwd.ts --title-mode static bash
pnpm exec tsx src/server/fwd.ts --title-mode filter vim
pnpm exec tsx src/server/fwd.ts --title-mode dynamic python

# Auto-selects dynamic mode for Claude
pnpm exec tsx src/server/fwd.ts claude

# Using environment variable
VIBETUNNEL_TITLE_MODE=static pnpm exec tsx src/server/fwd.ts zsh
```

## Implementation Details

### Dynamic Mode Activity Detection

The dynamic mode includes real-time activity monitoring:

1. **Generic Activity**: Any terminal output within 5 seconds shows `•`
2. **Claude Status Detection**: Parses status lines like:
   - `✻ Crafting… (205s · ↑ 6.0k tokens · esc to interrupt)`
   - `✢ Transitioning… (381s · ↑ 4.0k tokens · esc to interrupt)`
   - Filters these lines from output and displays compact version in title

3. **Extensible System**: New app detectors can be added for:
   - npm install progress
   - git clone status
   - docker build steps
   - Any CLI tool with parseable output

### Title Sequence Management

All modes use OSC (Operating System Command) sequences:
```
ESC ] 2 ; <title> BEL
```

- **Filter mode**: Removes all OSC 0, 1, and 2 sequences
- **Static/Dynamic modes**: Filter app sequences and inject VibeTunnel titles
- **Title injection**: Smart detection of shell prompts for natural updates

## Use Cases

### Managing Multiple Claude Code Sessions

When running multiple Claude Code instances across different projects, dynamic mode provides instant visibility:

```
Terminal 1: ~/frontend — claude — ✻ Crafting (45s, ↑2.1k) — Web UI
Terminal 2: ~/backend — claude — ✢ Transitioning (12s, ↓0.5k) — API Server  
Terminal 3: ~/docs — claude • — Documentation
Terminal 4: ~/tests — claude — Test Suite
```

The titles show:
- Which project each Claude is working on
- Current activity status (Crafting, Transitioning, idle)
- Progress indicators (time and token usage)
- Custom session names for context

### Using with Custom Terminal Management

If you have your own terminal title system (as described in [Commanding Your Claude Code Army](https://steipete.me/posts/2025/commanding-your-claude-code-army)), use filter mode:

```bash
# Your custom wrapper
cly() {
    echo -ne "\033]0;${PWD/#$HOME/~} — Claude\007"
    VIBETUNNEL_TITLE_MODE=filter command claude "$@"
}
```

### Development Workflow Visibility

Static mode for basic session tracking:
```
Tab 1: ~/myapp/frontend — pnpm run dev — Dev Server
Tab 2: ~/myapp/backend — npm start — API
Tab 3: ~/myapp — zsh — Terminal
Tab 4: ~/myapp — vim — Editor
```


## Technical Considerations

### Performance
- Pre-compiled regex patterns for efficient filtering
- Minimal overhead: <1ms per output chunk
- Activity detection uses 500ms intervals for title updates
- Claude status parsing adds negligible latency

### Compatibility
- Works with any terminal supporting OSC sequences
- Browser tabs update their titles automatically
- Compatible with tmux, screen, and terminal multiplexers
- Works across SSH connections

### Limitations

**Directory Tracking** (Static/Dynamic modes):
- Only tracks direct `cd` commands
- Doesn't track: `pushd`/`popd`, aliases, subshells
- `cd -` (previous directory) not supported
- Symbolic links show resolved paths

**Activity Detection** (Dynamic mode):
- 5-second timeout for generic activity
- Claude detection requires exact status format
- Some app outputs may interfere with detection

**Title Injection**:
- Relies on shell prompt detection
- May not work with heavily customized prompts
- Multi-line prompts may cause issues

## Future Enhancements

- Additional app detectors (npm, git, docker)
- Customizable activity timeout
- User-defined status patterns
- Title templates and formatting options
- Integration with session recording features