# VT Command Installation Guide

The `vt` command is VibeTunnel's convenient wrapper that allows you to run any command with terminal sharing enabled. This guide explains how the installation works and how to manage it.

## Installation Behavior

When you install VibeTunnel via npm, the `vt` command installation follows these rules:

### Global Installation (`npm install -g vibetunnel`)
- **Checks for existing `vt` command** to avoid conflicts with other tools
- If no `vt` command exists, creates it globally
- If `vt` already exists, skips installation and shows a warning
- You can still use `npx vt` or `vibetunnel fwd` as alternatives

### Local Installation (`npm install vibetunnel`)
- Configures `vt` for local use only
- Access via `npx vt` within your project

## Platform Support

### macOS and Linux
- Creates a symlink to the `vt` script
- Falls back to copying if symlink creation fails
- Script is made executable automatically

### Windows
- Creates a `.cmd` wrapper for proper command execution
- Copies the actual script alongside the wrapper
- Works with Command Prompt, PowerShell, and Git Bash

## Common Scenarios

### Existing VT Command
If you already have a `vt` command from another tool:
```bash
# You'll see this warning during installation:
⚠️  A "vt" command already exists in your system
   VibeTunnel's vt wrapper was not installed to avoid conflicts
   You can still use "npx vt" or the full path to run VibeTunnel's vt
```

**Alternatives:**
- Use `npx vt` (works globally if installed with -g)
- Use `vibetunnel fwd` directly
- Manually install to a different name (see below)

### Manual Installation
If automatic installation fails or you want to customize:

```bash
# Find where npm installs global packages
npm config get prefix

# On macOS/Linux, create symlink manually
ln -s $(npm root -g)/vibetunnel/bin/vt /usr/local/bin/vt

# Or copy and rename to avoid conflicts
cp $(npm root -g)/vibetunnel/bin/vt /usr/local/bin/vibetunnel-vt
chmod +x /usr/local/bin/vibetunnel-vt
```

### Force Reinstallation
To force VibeTunnel to overwrite an existing `vt` command:

```bash
# Remove existing vt first
rm -f $(which vt)

# Then reinstall VibeTunnel
npm install -g vibetunnel
```

## Troubleshooting

### Permission Denied
If you get permission errors during global installation:
```bash
# Option 1: Use a Node version manager (recommended)
# With nvm: https://github.com/nvm-sh/nvm
# With fnm: https://github.com/Schniz/fnm

# Option 2: Change npm's default directory
# See: https://docs.npmjs.com/resolving-eacces-permissions-errors
```

### Command Not Found
If `vt` is installed but not found:
```bash
# Check if npm bin directory is in PATH
echo $PATH
npm config get prefix

# Add to your shell profile (.bashrc, .zshrc, etc.)
export PATH="$(npm config get prefix)/bin:$PATH"
```

### Windows Specific Issues
- Ensure Node.js is in your system PATH
- Restart your terminal after installation
- Try using `vt.cmd` explicitly if `vt` doesn't work

## Uninstallation

The `vt` command is removed automatically when you uninstall VibeTunnel:
```bash
npm uninstall -g vibetunnel
```

If it persists, remove manually:
```bash
rm -f $(which vt)
# On Windows: del "%APPDATA%\npm\vt.cmd"
```