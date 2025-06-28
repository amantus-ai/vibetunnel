# Terminal Title Management in VibeTunnel

## Overview

VibeTunnel provides comprehensive terminal title management features to help you organize multiple terminal sessions. This is particularly useful when running multiple instances of tools like Claude Code across different projects.

## Features

### 1. Automatic Terminal Title Setting (Frontend → Server)

When creating a new session through the web interface, you can enable automatic terminal title updates that show:
- Current working directory
- Running command
- Session name (if provided)

**Format**: `~/path/to/project — command — session name`

**Examples**: 
- `~/Projects/vibetunnel5 — claude` (no session name)
- `~/Projects/app-frontend — npm — Frontend Dev` (with session name)
- `~/docs — vim — Documentation`

This feature:
- Is controlled by a "Set terminal title" toggle in the session creation form (on by default)
- Injects OSC title sequences into the terminal output
- Updates dynamically when you change directories
- Works in both terminal emulators and browser tabs

### 2. Terminal Title Change Prevention (CLI)

When using VibeTunnel's forwarding tool (`fwd.ts`), you can prevent applications from changing your terminal title:

```bash
# Using command-line flag
pnpm exec tsx src/server/fwd.ts --prevent-title-change claude

# Using environment variable
VIBETUNNEL_PREVENT_TITLE_CHANGE=1 pnpm exec tsx src/server/fwd.ts claude
```

This is useful when you want to maintain your own terminal organization system, as described in [Commanding Your Claude Code Army](https://steipete.me/posts/2025/commanding-your-claude-code-army).

## Implementation Details

### Title Injection (Server → Terminal)

When "Set terminal title" is enabled, the server:
1. Tracks the current working directory by monitoring:
   - Initial working directory from session creation
   - `cd` commands in the PTY input
   - Shell prompt updates (when detectable)
   
2. Injects title sequences using OSC codes:
   ```
   ESC ] 2 ; <title> BEL
   ```

3. Updates the title whenever:
   - Session starts (shows initial directory and command)
   - Directory changes (detected via cd commands)
   - Command changes (for long-running processes)

### Title Filtering (Server → Client)

When `--prevent-title-change` is used, the server:
1. Intercepts all PTY output
2. Filters out OSC 0, 1, and 2 sequences (terminal title codes)
3. Preserves all other terminal output unchanged

The filtering uses a regex pattern that matches:
- `ESC ] 0 ; <text> BEL` - Set icon and window title
- `ESC ] 1 ; <text> BEL` - Set icon title  
- `ESC ] 2 ; <text> BEL` - Set window title

These sequences can end with either BEL (`\x07`) or `ESC \` (`\x1B\x5C`).

## Use Cases

### Managing Multiple Claude Code Sessions

When running multiple Claude Code instances across different projects:

1. **With automatic titles** (web interface):
   ```
   Terminal 1: ~/Projects/app-frontend — claude
   Terminal 2: ~/Projects/app-backend — claude  
   Terminal 3: ~/Projects/docs — claude
   ```

2. **With custom wrapper script** (CLI with prevention):
   ```bash
   # In your ~/.config/zsh/claude-wrapper.zsh
   cly() {
       local folder_name="${PWD##*/}"
       echo -ne "\033]0;${PWD/#$HOME/~} — Claude\007"
       
       # Prevent Claude from changing the title
       VIBETUNNEL_PREVENT_TITLE_CHANGE=1 command claude "$@"
   }
   ```

### Web Development Sessions

Automatic titles help identify what's running where:
```
Tab 1: ~/myapp/frontend — pnpm run dev
Tab 2: ~/myapp/backend — npm start
Tab 3: ~/myapp — bash
```

## Configuration

### Web Interface

The "Set terminal title" toggle in the session creation form:
- **On** (default): Automatically updates terminal titles with working directory and command
- **Off**: No title injection, applications control their own titles

### CLI Options

For `fwd.ts`:
- `--prevent-title-change`: Prevents applications from changing terminal titles
- `VIBETUNNEL_PREVENT_TITLE_CHANGE=1`: Environment variable alternative

### Interaction Between Features

When both features are in play:
1. If a session was created with "Set terminal title" enabled, VibeTunnel will inject titles
2. If `--prevent-title-change` is used in the forwarder, it strips title sequences from applications
3. The prevention flag takes precedence over injection for forwarded sessions

## Technical Notes

- Title updates are performed using ANSI escape sequences
- The feature works with any terminal emulator that supports OSC sequences
- Browser tabs also update their titles when viewing sessions
- Title filtering is performed efficiently using pre-compiled regex patterns
- All regex patterns are pre-compiled for optimal performance

## Limitations

### Directory Tracking
The automatic title feature tracks directory changes by monitoring `cd` commands. This has some limitations:

- **Only tracks direct `cd` commands** - More complex operations are not tracked:
  - `pushd` / `popd` commands
  - Directory changes via aliases or functions
  - Changes within subshells or scripts
  - Directory changes from other tools (e.g., `z`, `autojump`)
- **`cd -` (previous directory)** - Cannot be tracked accurately as we don't maintain directory history
- **Symbolic links** - Tracked paths are resolved, which may differ from displayed paths

### Title Injection
The title injection relies on detecting shell prompts, which may not work correctly with:
- Heavily customized prompts
- Non-standard shell configurations
- Prompts that don't end with common patterns (`$`, `>`, `#`, etc.)
- Multi-line prompts

### Performance Considerations
- Regex patterns are pre-compiled to minimize overhead
- String/Buffer conversions are optimized to reduce allocations
- For very high-throughput sessions, there may be minimal latency from filtering

Despite these limitations, the features work well for typical development workflows and provide significant value for session organization.