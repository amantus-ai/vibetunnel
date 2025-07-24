# Git Worktree Management in VibeTunnel

VibeTunnel provides comprehensive Git worktree support, allowing you to work on multiple branches simultaneously without the overhead of cloning repositories multiple times. This guide covers everything you need to know about using worktrees effectively in VibeTunnel.

## Table of Contents

- [What are Git Worktrees?](#what-are-git-worktrees)
- [VibeTunnel's Worktree Features](#vibetunnels-worktree-features)
- [Creating Sessions with Worktrees](#creating-sessions-with-worktrees)
- [Branch Management](#branch-management)
- [Worktree Operations](#worktree-operations)
- [Follow Mode](#follow-mode)
- [Best Practices](#best-practices)
- [Common Workflows](#common-workflows)
- [Troubleshooting](#troubleshooting)

## What are Git Worktrees?

Git worktrees allow you to have multiple working trees attached to the same repository, each checked out to a different branch. This means you can:

- Work on multiple features simultaneously
- Keep a clean main branch while experimenting
- Quickly switch between tasks without stashing changes
- Run tests on one branch while developing on another

## VibeTunnel's Worktree Features

VibeTunnel enhances Git worktrees with:

1. **Visual Worktree Management**: See all worktrees at a glance in the session list
2. **Smart Branch Switching**: Automatically handle branch conflicts and uncommitted changes
3. **Follow Mode**: Keep multiple worktrees in sync when switching branches
4. **Integrated Session Creation**: Create new sessions directly in worktrees
5. **Worktree-aware Terminal Titles**: See which worktree you're working in

## Creating Sessions with Worktrees

### Using the New Session Dialog

When creating a new session in a Git repository, VibeTunnel provides intelligent branch and worktree selection:

1. **Base Branch Selection**
   - When no worktree is selected: "Switch to Branch" - attempts to switch the main repository to the selected branch
   - When creating a worktree: "Base Branch for Worktree" - uses this as the source branch

2. **Worktree Selection**
   - Choose "No worktree (use main repository)" to work in the main checkout
   - Select an existing worktree to create a session there
   - Click "Create new worktree" to create a new worktree on-the-fly

### Smart Branch Switching

When you select a different branch without choosing a worktree:

```
Selected: feature/new-ui
Current: main
Action: Attempts to switch from main to feature/new-ui
```

If the switch fails (e.g., due to uncommitted changes):
- A warning is displayed
- The session is created on the current branch
- No work is lost

### Creating New Worktrees

To create a new worktree from the session dialog:

1. Select your base branch (e.g., `main` or `develop`)
2. Click "Create new worktree"
3. Enter the new branch name
4. Click "Create"

The worktree will be created at: `{repo-path}-{branch-name}`

Example: `/Users/you/project` → `/Users/you/project-feature-awesome`

## Branch Management

### Branch States in VibeTunnel

VibeTunnel shows rich Git information for each session:

- **Branch Name**: Current branch with worktree indicator
- **Ahead/Behind**: Commits ahead/behind the upstream branch
- **Changes**: Uncommitted changes indicator
- **Worktree Status**: Main worktree vs feature worktrees

### Switching Branches

There are several ways to switch branches:

1. **In Main Repository**: Use the branch selector in the new session dialog
2. **In Worktrees**: Each worktree maintains its own branch
3. **With Follow Mode**: Automatically sync the main repository when switching in a worktree

## Worktree Operations

### Listing Worktrees

View all worktrees for a repository:
- In the session list, worktrees are marked with a special indicator
- The autocomplete dropdown shows worktree paths with their branches
- Use the Git app launcher to see a dedicated worktree view

### Creating Worktrees via API

```bash
# Using VibeTunnel's API
curl -X POST http://localhost:4020/api/worktrees \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "repoPath": "/path/to/repo",
    "branch": "feature/new-feature",
    "path": "/path/to/repo-new-feature",
    "baseBranch": "main"
  }'
```

### Deleting Worktrees

Remove worktrees when no longer needed:

```bash
# Via API
curl -X DELETE "http://localhost:4020/api/worktrees/feature-branch?repoPath=/path/to/repo" \
  -H "Authorization: Bearer YOUR_TOKEN"

# With force option for worktrees with uncommitted changes
curl -X DELETE "http://localhost:4020/api/worktrees/feature-branch?repoPath=/path/to/repo&force=true" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Follow Mode

Follow mode automatically switches your VibeTunnel terminal to the Git worktree that matches the branch you're working on in your editor or IDE. When you switch branches in your editor, VibeTunnel follows along.

### How It Works

1. Enable follow mode for a specific branch or the current branch
2. When Git detects branch changes (via hooks), VibeTunnel automatically switches to the corresponding worktree
3. Sessions show [checkout: branch] tags during transitions
4. The main repository stays in sync with your active work

Follow mode state is stored in the repository's git config:
```bash
# Check current follow mode
git config vibetunnel.followBranch

# The vt command handles this automatically
```

### Using Follow Mode with vt

```bash
# Enable follow mode for current branch
vt follow

# Switch to a branch and enable follow mode
vt follow feature/new-feature

# Disable follow mode
vt unfollow
```

The `vt follow` command is smart:
- Without arguments: enables follow mode for your current branch
- With a branch name: switches to that branch AND enables follow mode
- This eliminates the need for separate switch and follow operations

### Checking Follow Mode Status

```bash
# Check current follow mode in git config
git config vibetunnel.followBranch

# If output shows a branch name, follow mode is enabled for that branch
# If no output, follow mode is disabled
```

### Use Cases

- **IDE Integration**: Your terminal automatically follows your IDE's branch switches
- **Paired Programming**: Keep multiple views in sync
- **Testing**: Run tests in main while developing in worktree
- **Code Review**: Follow along as someone switches between branches
- **Context Switching**: Instantly jump to the right worktree when changing tasks

## Best Practices

### 1. Naming Conventions

Use descriptive branch names that work well as directory names:
- ✅ `feature/user-authentication`
- ✅ `bugfix/memory-leak`
- ❌ `fix/issue#123` (special characters)

### 2. Worktree Organization

Keep worktrees organized:
```
~/projects/
  myapp/              # Main repository
  myapp-feature-auth/ # Feature worktree
  myapp-bugfix-api/   # Bugfix worktree
  myapp-release-2.0/  # Release worktree
```

### 3. Cleanup

Regularly clean up unused worktrees:
- Remove merged feature branches
- Prune worktrees for deleted remote branches
- Use `git worktree prune` to clean up references

### 4. Performance

- Limit active worktrees to what you're actively working on
- Use follow mode judiciously (it triggers branch switches)
- Close sessions in unused worktrees to free resources

## Common Workflows

### Quick Start with Follow Mode

```bash
# Start working on a feature
git worktree add ../myproject-feature feature/awesome
cd ../myproject-feature
vt follow  # Enable follow mode for this feature

# Now when you switch branches in your IDE, VibeTunnel follows
```

### Feature Development

1. Create a worktree for your feature branch
   ```bash
   git worktree add ../project-feature feature/new-ui
   cd ../project-feature
   vt follow  # Terminal will now track this feature
   ```
2. Open VibeTunnel session in the worktree
3. Develop without affecting main branch
4. Run tests in main while developing
5. Merge and remove worktree when done

### Quick Branch Switching

```bash
# Currently on main, want to work on a feature
vt follow feature/api-update
# This switches to the branch AND enables follow mode

# Done with the feature, go back to main
vt follow main

# Stop following branches
vt unfollow
```

### Bug Fixes

1. Create worktree from production branch
   ```bash
   git worktree add ../project-hotfix hotfix/critical-bug
   ```
2. Switch to it with follow mode
   ```bash
   vt follow hotfix/critical-bug
   ```
3. Fix the bug and test
4. Cherry-pick to other branches if needed
5. Clean up worktree after merge

### Code Review

1. Reviewer enables follow mode
   ```bash
   vt follow  # Follow current branch
   ```
2. Author switches between branches in their IDE
3. Reviewer's terminal automatically follows along
4. No manual switching needed

### Parallel Development

1. Keep main worktree on stable branch
2. Create feature worktrees for each task
3. Use `vt follow <branch>` to instantly switch context
4. No stashing or context switching needed

## Troubleshooting

### "Cannot switch branches due to uncommitted changes"

**Problem**: Trying to switch branches with uncommitted work
**Solution**: 
- Commit or stash your changes first
- Use a worktree to work on the other branch
- VibeTunnel will show a warning and stay on current branch

### "Worktree path already exists"

**Problem**: Directory already exists when creating worktree
**Solution**:
- Choose a different name for your branch
- Manually remove the existing directory
- Use the `-force` option if appropriate

### "Branch already checked out in another worktree"

**Problem**: Git prevents checking out the same branch in multiple worktrees
**Solution**:
- Use the existing worktree for that branch
- Create a new branch from the desired branch
- Remove the other worktree if no longer needed

### Worktree Not Showing in List

**Problem**: Created worktree doesn't appear in VibeTunnel
**Solution**:
- Ensure the worktree is within a discoverable path
- Check that Git recognizes it: `git worktree list`
- Refresh the repository discovery in VibeTunnel

### Follow Mode Not Working

**Problem**: Main repository doesn't follow worktree changes
**Solution**:
- Ensure Git hooks are installed (VibeTunnel does this automatically)
- Check hook permissions: `ls -la .git/hooks/post-checkout`
- Verify follow mode is enabled for the branch
- Check for uncommitted changes blocking the switch

## Advanced Topics

### Custom Worktree Locations

You can create worktrees in custom locations:

```bash
# Create in a specific directory
git worktree add /custom/path/feature-branch feature/branch

# VibeTunnel will still discover and manage it
```

### Bare Repositories

For maximum flexibility, use a bare repository with worktrees:

```bash
# Clone as bare
git clone --bare https://github.com/user/repo.git repo.git

# Create worktrees from bare repo
git -C repo.git worktree add ../repo-main main
git -C repo.git worktree add ../repo-feature feature/branch
```

### Integration with CI/CD

Use worktrees for CI/CD workflows:
- Keep a clean worktree for builds
- Test multiple branches simultaneously
- Isolate deployment branches

## Command Reference

### vt Commands
- `vt follow` - Enable follow mode for current branch
- `vt follow <branch>` - Switch to branch and enable follow mode
- `vt unfollow` - Disable follow mode
- `vt git event` - Used internally by Git hooks

### Git Commands
- `git worktree add <path> <branch>` - Create a new worktree
- `git worktree list` - List all worktrees
- `git worktree remove <path>` - Remove a worktree

### API Reference

For detailed API documentation, see the main [API specification](./spec.md#worktree-endpoints).

Key endpoints:
- `GET /api/worktrees` - List worktrees with current follow mode status
- `POST /api/worktrees/follow` - Enable/disable follow mode for a branch
- `GET /api/git/follow` - Check follow mode status for a repository
- `POST /api/git/event` - Internal endpoint used by git hooks

## Conclusion

Git worktrees in VibeTunnel provide a powerful way to manage multiple branches and development tasks. By understanding the branch switching behavior, follow mode, and best practices, you can significantly improve your development workflow.

For implementation details and architecture, see the [Worktree Implementation Spec](./worktree-spec.md).