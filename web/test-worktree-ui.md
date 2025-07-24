# Testing Worktree UI

## Prerequisites
1. Make sure you have a Git repository available
2. VibeTunnel server should be running (`pnpm run dev`)

## Test Steps

### 1. Create a Session in a Git Repository
```bash
# Navigate to a Git repository (e.g., the VibeTunnel project itself)
cd ~/Projects/your-repo

# Create a new VibeTunnel session
vt --shell
```

### 2. Verify Git Detection
- Open http://localhost:4020 in your browser
- Find the session you just created
- Look for the Git icon button on the session card (should appear if Git was detected)

### 3. Test Worktree Navigation
- Click the Git icon button on the session card
- You should be navigated to the worktree management view
- The URL should change to include `?view=worktrees`
- **Alternative**: Press Cmd+W (Mac) or Ctrl+W (Windows/Linux) from the session list to open worktree view for the first Git session

### 4. Test Worktree Operations
- The worktree list should load and display:
  - Main worktree with path and branch
  - Any additional worktrees if they exist
  - Change summary for each worktree
- Test the "Delete" button (if you have non-main worktrees)
- Test the "Prune" button to clean up stale worktree info
- Test the "Follow" mode toggle buttons

### 5. Test Navigation Back
- Click the back arrow button
- You should return to the session list view

## Expected API Calls
When on the worktree view, check the Network tab for:
- `GET /api/worktrees?repoPath=...` - Should return list of worktrees
- `DELETE /api/worktrees/{branch}?repoPath=...` - When deleting a worktree
- `POST /api/worktrees/prune` - When pruning
- `POST /api/worktrees/follow` - When toggling follow mode

## Common Issues
- If Git icon doesn't appear: Session might not be in a Git repository
- If worktree list is empty: Check console for API errors
- If operations fail: Check server logs for Git command errors