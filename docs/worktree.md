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

Follow mode keeps your main repository synchronized with a specific worktree. This allows agents to work in worktrees while your IDE, Xcode, and servers stay open on the main repository - they'll automatically update when the worktree changes.

### How It Works

1. Enable follow mode from either the main repo or a worktree
2. Git hooks in both locations detect changes (commits, branch switches, checkouts)
3. Changes in the worktree sync to the main repository
4. Commits in the main repository sync to the worktree
5. Branch switches in the main repository auto-disable follow mode

Follow mode state is stored in the main repository's git config:
```bash
# Check which worktree is being followed
git config vibetunnel.followWorktree

# Returns the path to the followed worktree when active
```

### Using Follow Mode with vt

From a worktree:
```bash
# Enable follow mode for this worktree
vt follow
# Output: Enabling follow mode for worktree: ~/project-feature
#         Main repository (~/project) will track this worktree
```

From main repository:
```bash
# Follow current branch's worktree (if it exists)
vt follow

# Follow a specific branch's worktree
vt follow feature/new-feature

# Follow a worktree by path
vt follow ~/project-feature

# Disable follow mode
vt unfollow
```

The `vt follow` command is smart:
- From worktree: Always follows the current worktree
- From main repo without args: Follows current branch's worktree if it exists
- From main repo with args: Can specify branch name or worktree path

### Checking Follow Mode Status

```bash
# Check current follow mode in git config
git config vibetunnel.followBranch

# If output shows a branch name, follow mode is enabled for that branch
# If no output, follow mode is disabled
```

### Use Cases

- **Agent Development**: Agents work in worktrees while your IDE/Xcode stays on main repo
- **Continuous Development**: Keep servers running without restarts when switching features
- **Testing**: Make changes in worktree, test immediately in main repo environment
- **Parallel Work**: Multiple agents in different worktrees, switch follow mode as needed
- **Zero Disruption**: Never close your IDE or restart servers when context switching

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
# Create a worktree for agent development
git worktree add ../myproject-feature feature/awesome

# From the worktree, enable follow mode
cd ../myproject-feature
vt follow  # Main repo will now track this worktree

# Or from the main repo
cd ../myproject
vt follow ../myproject-feature  # Same effect
```

### Feature Development

1. Create a worktree for your feature branch
   ```bash
   git worktree add ../project-feature feature/new-ui
   ```
2. Enable follow mode
   ```bash
   # From the worktree
   cd ../project-feature
   vt follow
   
   # Or from main repo
   cd ../project
   vt follow feature/new-ui
   ```
3. Agent develops in worktree while you stay in main repo
4. Your IDE and servers automatically see updates
5. Merge and remove worktree when done

### Agent-Assisted Development

```bash
# Create worktree for agent
git worktree add ../project-agent feature/ai-feature

# Enable follow mode from main repo
vt follow ../project-agent

# Agent works in worktree, your main repo stays in sync
# Switch branches in worktree? Main repo follows
# Commit in worktree? Main repo updates

# When done
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

### Parallel Development

1. Keep main repo on stable branch with IDE/servers running
2. Create worktrees for different features
3. Use `vt follow ~/project-feature1` to track first feature
4. Switch to `vt follow ~/project-feature2` for second feature
5. Main repo instantly syncs without restarting anything

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
- Ensure you enabled follow mode: `git config vibetunnel.followWorktree`
- Check hooks are installed in both repos: `ls -la .git/hooks/post-*`
- Verify worktree path is correct: `vt status`
- Check for uncommitted changes in main repo blocking sync
- If you switched branches in main repo, follow mode auto-disabled

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