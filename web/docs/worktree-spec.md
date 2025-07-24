# Git Worktree Implementation Specification

This document describes the technical implementation of Git worktree support in VibeTunnel.

## Architecture Overview

VibeTunnel's worktree support is built on three main components:

1. **Backend API** - Git operations and worktree management
2. **Frontend UI** - Session creation and worktree visualization  
3. **Git Hooks** - Automatic synchronization and follow mode

## Backend Implementation

### Core Services

**GitService** (`web/src/server/services/git-service.ts`)
- Not implemented as a service, Git operations are embedded in routes
- Client-side GitService exists at `web/src/client/services/git-service.ts`

**Worktree Routes** (`web/src/server/routes/worktrees.ts`)
- `GET /api/worktrees` - List all worktrees with stats and follow mode status
- `POST /api/worktrees` - Create new worktree
- `DELETE /api/worktrees/:branch` - Remove worktree
- `POST /api/worktrees/switch` - Switch branch and enable follow mode
- `POST /api/worktrees/follow` - Enable/disable follow mode for a branch

**Git Routes** (`web/src/server/routes/git.ts`)
- `GET /api/git/repo-info` - Get repository information
- `POST /api/git/event` - Process git hook events (internal use)
- `GET /api/git/follow` - Check follow mode status for a repository
- `GET /api/git/notifications` - Get pending notifications

### Key Functions

```typescript
// List worktrees with extended information
async function listWorktreesWithStats(repoPath: string): Promise<Worktree[]>

// Create worktree with automatic path generation
async function createWorktree(
  repoPath: string, 
  branch: string, 
  path: string, 
  baseBranch?: string
): Promise<void>

// Handle branch switching with safety checks
async function switchBranch(
  repoPath: string, 
  branch: string
): Promise<void>
```

### Git Operations

All Git operations use Node.js `child_process.execFile` for security:

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Execute git commands safely
async function execGit(args: string[], options?: { cwd?: string }) {
  return execFileAsync('git', args, {
    ...options,
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024, // 10MB
  });
}
```

### Follow Mode Implementation

Follow mode uses Git hooks and git config for state management:

1. **State Storage**: Git config `vibetunnel.followBranch`
   ```bash
   # Follow mode state is stored per repository
   git config vibetunnel.followBranch "feature/branch"
   
   # Check follow mode status
   git config vibetunnel.followBranch
   
   # Disable follow mode
   git config --unset vibetunnel.followBranch
   ```

2. **Git Hooks**: `post-checkout` and `post-commit` hooks detect changes
3. **Event Processing**: Hooks execute `vt git event` command
4. **Branch Synchronization**: Main repository follows worktree changes

## Frontend Implementation

### Components

**SessionCreateForm** (`web/src/client/components/session-create-form.ts`)
- Branch/worktree selection UI
- Smart branch switching logic
- Warning displays for conflicts

**WorktreeManager** (`web/src/client/components/worktree-manager.ts`)
- Dedicated worktree management UI
- Follow mode controls
- Worktree deletion and branch switching
- **Note**: Does not include UI for creating new worktrees

### State Management

```typescript
// Session creation state
@state() private currentBranch: string = '';
@state() private selectedBaseBranch: string = '';
@state() private selectedWorktree?: string;
@state() private availableWorktrees: Worktree[] = [];

// Branch switching state  
@state() private branchSwitchWarning?: string;
@state() private isLoadingBranches = false;
@state() private isLoadingWorktrees = false;
```

### Branch Selection Logic

The new session dialog implements smart branch handling:

1. **No Worktree Selected**:
   ```typescript
   if (selectedBaseBranch !== currentBranch) {
     try {
       await gitService.switchBranch(repoPath, selectedBaseBranch);
       effectiveBranch = selectedBaseBranch;
     } catch (error) {
       // Show warning, use current branch
       this.branchSwitchWarning = "Cannot switch due to uncommitted changes";
       effectiveBranch = currentBranch;
     }
   }
   ```

2. **Worktree Selected**:
   ```typescript
   // Use worktree's path and branch
   effectiveWorkingDir = worktreeInfo.path;
   effectiveBranch = selectedWorktree;
   // No branch switching occurs
   ```

### UI Updates

Dynamic labels based on context:
```typescript
${this.selectedWorktree ? 'Base Branch for Worktree:' : 'Switch to Branch:'}
```

Help text explaining behavior:
```typescript
${this.selectedWorktree
  ? 'New worktree branch will be created from this branch'
  : this.selectedBaseBranch !== this.currentBranch
    ? `Session will start on ${this.selectedBaseBranch} (currently on ${this.currentBranch})`
    : `Current branch: ${this.currentBranch}`
}
```

## Git Hook Integration

### Hook Installation

Automatic hook installation on repository access:

```typescript
// Install hooks when checking Git repository
async function installGitHooks(repoPath: string): Promise<void> {
  const hooks = ['post-commit', 'post-checkout'];
  for (const hook of hooks) {
    await installHook(repoPath, hook);
  }
}
```

### Hook Script

The hook implementation uses the `vt` command:

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

The `vt git event` command:
- Sends the repository path to the server via `POST /api/git/event`
- Server determines what changed by examining current git state
- Triggers branch synchronization if follow mode is enabled
- Sends notifications to connected sessions
- Runs in background to avoid blocking git operations

### Follow Mode Logic

When a checkout event occurs:

```typescript
// Check if follow mode is enabled
const followBranch = await getGitConfig(repoPath, 'vibetunnel.followBranch');

if (followBranch && event === 'checkout') {
  // Check for uncommitted changes
  const hasChanges = await checkUncommittedChanges(mainRepoPath);
  
  if (!hasChanges) {
    // Perform the sync (checkout to the followed branch)
    await execGit(['checkout', followBranch], { cwd: mainRepoPath });
  } else {
    // Disable follow mode due to uncommitted changes
    await unsetGitConfig(mainRepoPath, 'vibetunnel.followBranch');
  }
}
```

## Data Models

### Worktree

The Worktree interface differs between backend and frontend:

**Backend** (`web/src/server/routes/worktrees.ts`):
```typescript
interface Worktree {
  path: string;
  branch: string;
  HEAD: string;
  detached: boolean;
  prunable?: boolean;
  locked?: boolean;
  lockedReason?: string;
  // Extended stats
  commitsAhead?: number;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
  hasUncommittedChanges?: boolean;
}
```

**Frontend** (`web/src/client/services/git-service.ts`):
```typescript
interface Worktree extends BackendWorktree {
  // UI helpers - added dynamically by routes
  isMainWorktree?: boolean;
  isCurrentWorktree?: boolean;
}
```

The UI helper fields are computed dynamically in the worktree routes based on the current repository path and are not stored in the backend data model.

### Session with Git Info

```typescript
interface Session {
  id: string;
  name: string;
  command: string[];
  workingDir: string;
  // Git information (from shared/types.ts)
  gitRepoPath?: string;
  gitBranch?: string;
  gitAheadCount?: number;
  gitBehindCount?: number;
  gitHasChanges?: boolean;
  gitIsWorktree?: boolean;
  gitMainRepoPath?: string;
}
```

## Error Handling

### Common Errors

1. **Uncommitted Changes**
   ```typescript
   if (hasUncommittedChanges) {
     throw new Error('Cannot switch branches with uncommitted changes');
   }
   ```

2. **Branch Already Checked Out**
   ```typescript
   // Git automatically prevents this
   // Error: "fatal: 'branch' is already checked out at '/path/to/worktree'"
   ```

3. **Worktree Path Exists**
   ```typescript
   if (await pathExists(worktreePath)) {
     throw new Error(`Path already exists: ${worktreePath}`);
   }
   ```

### Error Recovery

- Show user-friendly warnings
- Fallback to safe defaults
- Never lose user work
- Log detailed errors for debugging

## Performance Considerations

### Caching

- Worktree list cached for 5 seconds
- Branch list cached per repository
- Git status cached with debouncing

### Optimization

```typescript
// Parallel operations where possible
const [branches, worktrees] = await Promise.all([
  loadBranches(repoPath),
  loadWorktrees(repoPath)
]);

// Debounced Git checks
this.gitCheckDebounceTimer = setTimeout(() => {
  this.checkGitRepository();
}, 500);
```

## Security

### Command Injection Prevention

All Git commands use array arguments:
```typescript
// Safe
execFile('git', ['checkout', branchName])

// Never use string concatenation
// execFile('git checkout ' + branchName) // DANGEROUS
```

### Path Validation

```typescript
// Resolve and validate paths
const absolutePath = path.resolve(repoPath);
if (!absolutePath.startsWith(allowedBasePath)) {
  throw new Error('Invalid repository path');
}
```

## Worktree Creation

Currently, worktree creation is handled through terminal commands rather than UI:

```bash
# Create a new worktree for an existing branch
git worktree add ../feature-branch feature-branch

# Create a new worktree with a new branch
git worktree add -b new-feature ../new-feature main
```

### UI Support Status

1. **WorktreeManager** - No creation UI, only management of existing worktrees
2. **SessionCreateForm** - Has partial support for creating worktrees through the git-branch-selector component, but incomplete:
   - Creates worktrees but doesn't properly update UI state afterward
   - Uses simplistic path generation (appends to repo path)
   - No path customization or validation
   - Missing proper error handling for common cases
   - The `isCreatingWorktree` state is never cleared after completion
3. **Recommended approach** - Use terminal commands for worktree creation, then manage via UI

## Testing

### Unit Tests

- `worktrees.test.ts` - Route handlers
- `git-hooks.test.ts` - Hook installation
- `session-create-form.test.ts` - UI logic

### Integration Tests

- `worktree-workflows.test.ts` - Full workflows
- `follow-mode.test.ts` - Follow mode scenarios

### E2E Tests

- Create worktree via UI
- Switch branches with warnings
- Follow mode synchronization

