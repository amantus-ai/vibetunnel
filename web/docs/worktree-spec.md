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

**Worktree Routes** (`web/src/server/routes/worktrees.ts`)
- `GET /api/worktrees` - List all worktrees with stats
- `POST /api/worktrees` - Create new worktree
- `DELETE /api/worktrees/:branch` - Remove worktree
- `POST /api/worktrees/switch` - Switch branch with follow mode
- `POST /api/worktrees/follow` - Enable/disable follow mode

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

Follow mode uses Git hooks and a state file:

1. **State File**: `~/.vibetunnel/follow-mode.json`
   ```json
   {
     "/path/to/repo": {
       "branch": "feature/branch",
       "enabled": true
     }
   }
   ```

2. **Git Hooks**: `post-checkout` hook detects branch changes
3. **API Notification**: Hook calls VibeTunnel API to sync

## Frontend Implementation

### Components

**SessionCreateForm** (`web/src/client/components/session-create-form.ts`)
- Branch/worktree selection UI
- Smart branch switching logic
- Warning displays for conflicts

**WorktreeManager** (`web/src/client/components/worktree-manager.ts`)
- Dedicated worktree management UI
- Follow mode controls
- Worktree creation/deletion

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

```bash
#!/bin/sh
# VibeTunnel Git hook - post-checkout

# Get the branch name
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

# Notify VibeTunnel API
curl -X POST http://localhost:4020/api/git/hook \
  -H "Content-Type: application/json" \
  -d "{
    \"event\": \"checkout\",
    \"repoPath\": \"$PWD\",
    \"branch\": \"$branch\",
    \"previousHEAD\": \"$1\",
    \"newHEAD\": \"$2\",
    \"branchCheckout\": \"$3\"
  }" \
  >/dev/null 2>&1 || true

exit 0
```

## Data Models

### Worktree

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
  // UI helpers
  isMainWorktree?: boolean;
  isCurrentWorktree?: boolean;
}
```

### Session with Git Info

```typescript
interface Session {
  id: string;
  name: string;
  command: string[];
  workingDir: string;
  // Git information
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

## Future Enhancements

1. **Worktree Templates** - Predefined worktree configurations
2. **Bulk Operations** - Manage multiple worktrees at once
3. **Remote Worktrees** - Support for worktrees on remote servers
4. **Worktree Sync** - Keep worktrees updated with upstream
5. **Visual Worktree Graph** - Show relationships between worktrees