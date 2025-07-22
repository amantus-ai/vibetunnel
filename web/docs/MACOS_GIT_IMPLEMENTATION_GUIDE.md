# macOS Git Features Implementation Guide

This guide provides implementation instructions for macOS client developers to integrate the Git worktree and branch management features.

## Overview

The server-side Git integration is complete and provides APIs for:
- Git repository detection and metadata
- Worktree management (list, delete, prune, switch)
- Follow mode synchronization
- Dynamic Git-aware terminal titles
- Real-time Git event notifications

## API Endpoints

### Git Repository Detection

**GET** `/api/git/repo-info?path={path}`
- Detects if a path is within a Git repository
- Returns: `{ isGitRepo: boolean, repoPath?: string }`
- Use before showing Git-specific UI elements

### Worktree Management

**GET** `/api/worktrees?repoPath={path}`
- Lists all worktrees for a repository
- Returns enriched worktree data:
```typescript
interface WorktreeInfo {
  path: string;
  branch: string;
  isMainWorktree: boolean;
  isCurrentWorktree: boolean;
  isPrunable: boolean;
  stats?: {
    ahead: number;
    behind: number;
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  hasUncommittedChanges: boolean;
}
```

**DELETE** `/api/worktrees/{branch}?repoPath={path}&force={boolean}`
- Deletes a worktree by branch name
- Use `force=true` for worktrees with uncommitted changes

**POST** `/api/worktrees/prune`
- Body: `{ repoPath: string }`
- Removes stale worktrees
- Returns: `{ pruned: string[] }`

**POST** `/api/worktrees/switch`
- Body: `{ repoPath: string, branch: string }`
- Changes the current branch in the main worktree

**POST** `/api/worktrees/follow`
- Body: `{ repoPath: string, branch?: string, enable?: boolean }`
- Manages follow mode and Git hooks
- Returns: `{ enabled: boolean, branch?: string, hooksInstalled: boolean }`

### Git Events

**POST** `/api/git/event`
- Body: `{ repoPath: string, branch?: string, event?: string }`
- Processes Git events and updates session titles
- Used by Git hooks for automatic updates

## Session Creation with Git Context

When creating new sessions, the server automatically detects Git information:

```typescript
interface SessionCreateOptions {
  command: string[];
  workingDir?: string;
  name?: string;
  titleMode?: 'fixed' | 'dynamic';
  // Git metadata is added automatically by the server
}

interface SessionInfo {
  id: string;
  name: string;
  // Git metadata included when in a repository
  gitRepoPath?: string;
  gitBranch?: string;
  // ... other fields
}
```

## Real-time Notifications

The server sends notifications via Unix socket when Git events occur:

```typescript
interface GitNotificationEvent {
  type: 'event';
  category: 'git';
  action: 'repository-changed';
  payload: {
    type: 'git-event';
    repoPath: string;
    branch?: string;
    event?: string;
    followMode: boolean;
    currentBranch?: string;
    sessionsUpdated: string[];
  };
}
```

## Implementation Requirements

### 1. Context-Aware Session Creation UI

When the user initiates session creation:
1. Call `/api/git/repo-info?path={currentPath}` to check if in a Git repo
2. If `isGitRepo: true`, show Git-aware UI elements:
   - Current branch indicator
   - Option to create session in different worktrees
   - Follow mode status indicator

### 2. Session List Enhancement

Enhance the session list to show Git context:
- Group sessions by `gitRepoPath`
- Show branch name next to sessions (`gitBranch`)
- Visual indicator for sessions in the same repository
- Different styling for main worktree vs other worktrees

### 3. Worktree Management Panel

Create a dedicated UI panel for worktree management:

**Worktree List View:**
- Show all worktrees from `/api/worktrees`
- Display branch name, path, and stats
- Highlight current worktree
- Show uncommitted changes indicator
- Mark prunable worktrees

**Actions:**
- Delete button (with confirmation for uncommitted changes)
- Switch branch button (for main worktree)
- Prune stale worktrees button
- Toggle follow mode

**Follow Mode Indicator:**
- Show current follow mode status
- Display which branch is being followed
- Allow toggling follow mode on/off

### 4. Git Event Handling

Listen for Unix socket notifications:
```swift
// Handle git.repository-changed events
switch event.action {
case "repository-changed":
    // Update UI based on payload
    // Refresh session titles if needed
    // Update worktree list if open
    // Show notification for branch changes
}
```

### 5. Dynamic Title Updates

Session titles now follow the format:
- With Git: `[activity] repoName-branch · command`
- Without Git: `[activity] path · command`
- With custom name: Just the custom name

The server handles title generation, but the client should:
- Display the full title in session lists
- Update titles when Git events occur
- Show branch changes in real-time

## UI/UX Recommendations

### Visual Hierarchy
1. Repository name as primary grouping
2. Branch name as secondary identifier
3. Session name/command as tertiary info

### Follow Mode UI
- Toggle switch in worktree panel
- Status indicator in main window
- Notification when branches diverge
- Quick action to disable follow mode

### Worktree Actions
- Inline delete buttons with confirmation
- Drag-and-drop to switch between worktrees
- Right-click context menu for advanced options
- Keyboard shortcuts for common operations

### Git Status Integration
- Show dirty indicator (●) for uncommitted changes
- Different colors for ahead/behind status
- Branch protection warnings
- Quick diff preview on hover

## Testing Scenarios

1. **Repository Detection:**
   - Test with Git and non-Git directories
   - Nested Git repositories
   - Symbolic links to Git repos

2. **Worktree Operations:**
   - Create/delete worktrees
   - Switch branches with uncommitted changes
   - Prune stale worktrees
   - Force delete with changes

3. **Follow Mode:**
   - Enable/disable follow mode
   - Branch synchronization
   - Divergence detection
   - Hook installation/removal

4. **Event Notifications:**
   - Real-time title updates
   - Multiple sessions in same repo
   - Branch switching events
   - External Git operations

## Error Handling

Handle these error cases gracefully:
- Git command not found
- Repository access permissions
- Locked worktrees
- Network issues (for remote repos)
- Race conditions during rapid operations

## Performance Considerations

- Cache `/api/git/repo-info` results
- Debounce worktree list refreshes
- Batch session updates
- Use lazy loading for large repositories
- Implement virtual scrolling for many worktrees

## Migration Path

For existing sessions without Git metadata:
1. Detect repository on session focus
2. Update session metadata lazily
3. Preserve user's custom names
4. Show migration indicator in UI

## Security Notes

- All paths are sanitized server-side
- Git commands use parameterized execution
- No shell interpretation of user input
- Repository access follows system permissions