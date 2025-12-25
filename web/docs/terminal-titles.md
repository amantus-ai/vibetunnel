# Terminal Title Management in VibeTunnel

VibeTunnel provides terminal title management with four modes; Dynamic is a legacy alias of Static (no activity tracking).

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

### 4. Dynamic Mode (Legacy)
- **Behavior**: Alias of Static mode (no activity tracking)
- **Use case**: Backward compatibility with existing scripts/configs
- **CLI**: `--title-mode dynamic`

## Using Title Modes

### Web Interface

When creating a new session through the web interface, the default is Static mode. You can select a different mode from the dropdown:

```
Terminal Title Mode: [Static ▼]
  - None - No title management
  - Filter - Block title changes
  - Static - Show path & command
  - Dynamic (legacy) - Same as Static
```

### Command Line (fwd.ts)

```bash
# Explicitly set title mode
pnpm exec tsx src/server/fwd.ts --title-mode static bash
pnpm exec tsx src/server/fwd.ts --title-mode filter vim
pnpm exec tsx src/server/fwd.ts --title-mode dynamic python

# Using environment variable
VIBETUNNEL_TITLE_MODE=static pnpm exec tsx src/server/fwd.ts zsh
```

## Implementation Details

### Title Sequence Management

All modes use OSC (Operating System Command) sequences:
```
ESC ] 2 ; <title> BEL
```

- **Filter mode**: Removes all OSC 0, 1, and 2 sequences
- **Static/Dynamic modes**: Filter app sequences and inject VibeTunnel titles
- **Title injection**: Smart detection of shell prompts for natural updates

## Use Cases

### Managing Multiple Sessions

Static mode provides quick context across projects:

```
Terminal 1: ~/frontend — npm — Web UI
Terminal 2: ~/backend — npm — API Server
Terminal 3: ~/docs — zsh — Documentation
Terminal 4: ~/tests — pytest — Test Suite
```

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

**Title Injection**:
- Relies on shell prompt detection
- May not work with heavily customized prompts
- Multi-line prompts may cause issues

## Future Enhancements

- Title templates and formatting options
- Integration with session recording features
