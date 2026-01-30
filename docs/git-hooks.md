# Git Hooks in VibeTunnel

## Overview

VibeTunnel uses Git hooks exclusively for its **follow mode** feature. These hooks monitor repository changes and enable automatic branch synchronization across team members.

## Purpose

Git hooks in VibeTunnel serve a single, specific purpose:
- **Follow Mode**: Automatically sync worktrees when team members switch branches
- **Session Title Updates**: Display current git operations in terminal session titles

**Important**: If you're not using follow mode, git hooks are not needed and serve no other purpose in VibeTunnel.

## How It Works

### Hook Installation

When follow mode is enabled, VibeTunnel installs two Git hooks:
- `post-commit`: Triggered after commits
- `post-checkout`: Triggered after branch checkouts

These hooks execute a simple command:
```bash
vt git event
```

### Event Flow

1. **Git Operation**: User performs a commit or checkout
2. **Hook Trigger**: Git executes the VibeTunnel hook
3. **Event Notification**: `vt git event` sends repository path to VibeTunnel server
4. **Server Processing**: The `/api/git/event` endpoint:
   - Updates session titles (e.g., `Terminal [checkout: feature-branch]`)
   - Checks follow mode configuration
   - Syncs branches if follow mode is active

### Follow Mode Synchronization

When follow mode is enabled for a branch:
1. VibeTunnel monitors checkouts to the followed branch
2. If detected, it automatically switches your worktree to that branch
3. If branches have diverged, follow mode is automatically disabled

## Technical Implementation

### Hook Script Content

```bash
#!/bin/sh
# VibeTunnel Git hook - post-checkout
# This hook notifies VibeTunnel when Git events occur

# Check if vt command is available
if command -v vt >/dev/null 2>&1; then
  # Run in background to avoid blocking Git operations
  vt git event &
fi

# Always exit successfully
exit 0
```

### Hook Management

- **Installation**: `installGitHooks()` in `web/src/server/utils/git-hooks.ts`
- **Safe Chaining**: Existing hooks are backed up and chained
- **Cleanup**: Original hooks are restored when uninstalling

### API Endpoints

- `POST /api/git/event`: Receives git event notifications
- `POST /api/worktrees/follow`: Enables follow mode and installs hooks
- `GET /api/git/follow`: Checks follow mode status

## File Locations

- **Hook Management**: `web/src/server/utils/git-hooks.ts`
- **Event Handler**: `web/src/server/routes/git.ts` (lines 189-481)
- **Follow Mode**: `web/src/server/routes/worktrees.ts` (lines 580-630)
- **CLI Integration**: `web/bin/vt` (git event command)

## Configuration

Follow mode stores configuration in git config:
```bash
git config vibetunnel.followBranch <branch-name>
```

## Security Considerations

- Hooks run with minimal permissions
- Commands execute in background to avoid blocking Git
- Existing hooks are preserved and chained safely
- Hooks are repository-specific, not global

## Troubleshooting

### Hooks Not Working
- Verify `vt` command is in PATH
- Check hook permissions: `ls -la .git/hooks/post-*`
- Ensure hooks are executable: `chmod +x .git/hooks/post-*`

### Follow Mode Issues
- Check configuration: `git config vibetunnel.followBranch`
- Verify hooks installed: `cat .git/hooks/post-checkout`
- Review server logs for git event processing

## Summary

Git hooks in VibeTunnel are:
- **Single-purpose**: Only used for follow mode functionality
- **Optional**: Not required unless using follow mode
- **Safe**: Preserve existing hooks and run non-blocking
- **Automatic**: Managed by VibeTunnel when enabling/disabling follow mode

If you're not using follow mode for team branch synchronization, you don't need git hooks installed.