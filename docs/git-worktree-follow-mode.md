# Git Worktree Follow Mode Specification

## Overview

Follow mode is a feature that enables automatic synchronization between Git worktrees and the main repository. It ensures team members stay on the same branch by automatically switching branches when changes are detected.

## Core Concept

Follow mode creates a **unidirectional sync** from a worktree to the main repository:
- When someone switches branches in a worktree
- The main repository automatically follows that branch change
- This keeps the main repository synchronized with active development

## When Follow Mode Should Be Available

### ✅ Follow Mode SHOULD appear when:

1. **Creating a session in a worktree**
   - You've selected a worktree from the dropdown
   - The session will run in that worktree's directory
   - Follow mode will sync the main repository to match this worktree's branch

2. **Viewing worktrees in the Worktree Manager**
   - Each worktree (except main) shows a "Follow" button
   - Enables following that specific worktree's branch

3. **Session list with worktree sessions**
   - Repository headers show follow mode status
   - Dropdown allows changing which worktree to follow

### ❌ Follow Mode should NOT appear when:

1. **No worktree is selected** (using main repository)
   - There's nothing to follow - you're already in the main repo
   - Follow mode has no purpose without a worktree

2. **Repository has no worktrees**
   - No worktrees exist to follow
   - Only the main repository is available

3. **Not in a Git repository**
   - Obviously, no Git features available

## UI Behavior Rules

### Session Creation Form

```typescript
// Show follow mode toggle only when:
const showFollowModeToggle = 
  gitRepoInfo?.isGitRepo && 
  selectedWorktree !== undefined &&
  selectedWorktree !== 'none';
```

#### Toggle States:

1. **Worktree Selected**:
   - Show: "Follow Mode" toggle
   - Description: "Keep main repository in sync with this worktree"
   - Default: OFF (user must explicitly enable)

2. **No Worktree Selected**:
   - Hide the entire follow mode section
   - No toggle should be visible

3. **Follow Mode Already Active**:
   - Show: "Follow Mode" toggle (disabled)
   - Description: "Currently following: [branch-name]"
   - Info: User must disable from worktree manager

### Worktree Manager

Each worktree row shows:
- **"Follow" button**: When not currently following
- **"Following" button** (green): When actively following this worktree
- **No button**: For the main worktree (can't follow itself)

### Session List

Repository headers show:
- **Purple badge**: When follow mode is active, shows branch name
- **Dropdown**: To change follow mode settings per repository

## Technical Implementation

### State Logic

```typescript
// Follow mode is only meaningful when:
// 1. We have a worktree to follow
// 2. We're not already in that worktree
// 3. The main repo can switch to that branch

const canEnableFollowMode = (
  worktree: Worktree,
  currentLocation: string,
  mainRepoPath: string
) => {
  // Can't follow if we're in the main repo with no worktree selected
  if (currentLocation === mainRepoPath && !worktree) {
    return false;
  }
  
  // Can't follow the main worktree
  if (worktree.isMainWorktree) {
    return false;
  }
  
  // Can follow if we're creating a session in a worktree
  if (worktree && currentLocation === worktree.path) {
    return true;
  }
  
  return false;
};
```

### Configuration Storage

Follow mode state is stored in Git config:
```bash
# Enable follow mode for a branch
git config vibetunnel.followBranch "feature/new-ui"

# Check current follow mode
git config vibetunnel.followBranch

# Disable follow mode
git config --unset vibetunnel.followBranch
```

### Synchronization Rules

1. **Automatic Sync**:
   - Triggered by `post-checkout` git hook in worktrees
   - Only syncs if main repo has no uncommitted changes
   - Disables follow mode if branches have diverged

2. **Manual Override**:
   - Users can always manually switch branches
   - Follow mode doesn't prevent manual git operations
   - Re-enables when returning to the followed branch

## User Experience Guidelines

### Clear Messaging

1. **When Enabling**:
   - "Follow mode will keep your main repository on the same branch as this worktree"
   - "Enable to automatically sync branch changes"

2. **When Active**:
   - "Following worktree: feature/new-ui"
   - "Main repository syncs with this worktree's branch"

3. **When Disabled**:
   - "Follow mode disabled due to uncommitted changes"
   - "Branches have diverged - follow mode disabled"

### Visual Indicators

- **Toggle Switch**: Only visible when applicable
- **Status Badge**: Purple badge with branch name when active
- **Button States**: Clear "Follow"/"Following" states in worktree manager

## Error Handling

### Common Scenarios

1. **Uncommitted Changes**:
   - Disable follow mode automatically
   - Show notification to user
   - Don't lose any work

2. **Branch Divergence**:
   - Detect when branches have different commits
   - Disable follow mode to prevent conflicts
   - Notify user of the situation

3. **Worktree Deletion**:
   - Automatically disable follow mode
   - Clean up git config
   - Update UI immediately

## Summary

Follow mode should be:
- **Contextual**: Only shown when it makes sense
- **Safe**: Never causes data loss or conflicts
- **Clear**: Users understand what it does
- **Automatic**: Works in the background when enabled

The key principle: **Follow mode only exists when there's a worktree to follow**. Without a worktree selection, the feature should not be visible or accessible.