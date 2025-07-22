# Worktree and Git Integration Feature Overview

## 1. Objective

The goal is to create an **optional** feature that allows seamless, branch-focused management of Git worktrees and enhances all terminal sessions with Git context. This includes:
*   Creating sessions from branches via worktrees.
*   A "follow mode" to keep the main checkout and a worktree in sync.
*   **Git-aware dynamic titles** that show the current branch.
*   UI for managing worktrees (pruning, deleting, etc.).

The feature should feel like a natural extension of the existing session management, only presenting its specialized UI when the user is working within a Git repository.

## 2. Core Components

### 2.1. Server-Side Logic (web/)

The core logic will reside in the server application (`web/`).

#### 2.1.1. Git-Aware Dynamic Titles & State Management

*   **Title Format:** The dynamic title for sessions within a Git repository will follow the format: `activity - repoName-branch - sessionName`.
*   **Session Creation:** When a session is created with `titleMode: 'dynamic'`, the server will detect if the working directory is in a Git repo. If so, it will fetch the `repoName` (e.g., the directory name) and the current `branch` to construct the initial title.
*   **`POST /api/git/event`**: A single, generic endpoint to notify the server of a change in a Git repository.
    *   **Request Body:** `repoPath` (string, required).
    *   **Action:** This endpoint is the central hub for all hook-based automation. It will use an in-memory lock to prevent race conditions from multiple, rapid-fire events for the same repository. When triggered, it will:
        1.  **Update Titles:** Find all active sessions within the `repoPath` and reconstruct their dynamic titles using the new format, fetching the fresh branch name for each session's specific working directory.
        2.  **Check Follow Mode:** Read the follow mode state using `git config vibetunnel.followBranch`.
        3.  **Trigger Sync:** If follow mode is active, it will trigger the bi-directional sync logic.
        4.  **Check for Auto-Disable:** If the event was triggered from the main repo, it will check if the current branch has diverged from the followed branch and disable follow mode if necessary.
        5.  **Send Notifications:** Send events to the macOS client for any actions taken (e.g., "Follow mode disabled").

#### 2.1.2. API Endpoint Modifications

*   **`POST /api/sessions`**
    *   The `ptyManager.createSession` logic will be updated to store `gitRepoPath` and `branch` on the session object if they are provided in the request. This data is crucial for UI grouping and labeling.

*   **`GET /api/sessions`**
    *   The returned `Session` objects will now optionally include `gitRepoPath` and `branch` fields, allowing the client to group and label sessions correctly.

#### 2.1.3. New API Endpoints for Worktree Management

A new set of routes will be created, likely in `web/src/server/routes/worktrees.ts`.

*   **`GET /api/git/repo-info`**
    *   **Query Param:** `path` (string, required)
    *   **Action:** Checks if the given path is within a Git repository. If so, returns the root path of the repository.
    *   **Returns:** `{ "isGitRepo": true, "repoPath": "/path/to/repo" }` or `{ "isGitRepo": false }`.

*   **`GET /api/worktrees`**
    *   **Query Param:** `repoPath` (string, required)
    *   **Action:**
        1.  Auto-detects the repository's default branch (the `base_branch`) by running `git symbolic-ref refs/remotes/origin/HEAD`. It will fall back to `main` and then `master` if detection fails.
        2.  Executes `git worktree list --porcelain` to get all worktrees.
        3.  For each worktree, it will also execute:
            *   `git rev-list --count <base_branch>...<branch>` to get the number of commits ahead of the base branch.
            *   `git diff --shortstat <base_branch>...<branch>` to get the total file changes and LOC additions/deletions.
            *   `git status --porcelain` within the worktree directory to check for uncommitted changes.
    *   **Returns:** A JSON list of worktrees, each with its path, branch, commit count, LOC stats, and dirty status.

*   **`DELETE /api/worktrees/:branch`**
    *   **Query Params:** `repoPath` (string, required), `force` (boolean, optional, default: `false`)
    *   **Action:**
        1.  The server will map the URL-encoded `:branch` name to its corresponding worktree path.
        2.  Checks for uncommitted changes in the worktree using `git status --porcelain`.
        3.  If changes exist and `force` is `false`, it returns a `409 Conflict` error.
        4.  If no changes exist or `force` is `true`, it executes `git worktree remove --force <worktree-path>`.

*   **`POST /api/worktrees/prune`**
    *   **Request Body:** `repoPath` (string, required)
    *   **Action:** Executes `git worktree prune` in the specified repository path.

*   **`POST /api/worktrees/switch`**
    *   **Request Body:** `repoPath` (string, required), `branch` (string, required)
    *   **Action:** A convenience endpoint that switches the main repository to the specified branch and enables follow mode.
        1.  `git -C <repoPath> checkout <branch>`
        2.  Calls the `follow` logic internally to enable follow mode for that branch.

*   **`POST /api/worktrees/follow`**
    *   **Request Body:**
        *   `repoPath` (string, required): Path to the main repository.
        *   `branch` (string, required): The branch whose worktree to follow.
        *   `enable` (boolean, required): `true` to enable follow mode, `false` to disable.
    *   **Action:**
        1.  If `enable` is `true`, this endpoint is responsible for the **one-time installation of the Git hooks** if they don't already exist.
        2.  It sets the follow state using `git config --local vibetunnel.followBranch <branch>`.
        3.  If `enable` is `false`, it unsets the config using `git config --local --unset vibetunnel.followBranch`.

### 2.2. Event-Driven Notifications

To keep the user informed about background activities, the server implements a dual notification system:

*   **Dual Notification Modes:**
    *   **When macOS client is connected:** The server sends events to the macOS client via the existing Unix socket, which displays them as native macOS notifications.
    *   **When macOS client is not connected:** The web UI displays notifications using its built-in notification system (toast messages).

*   **Event Structure:** A standardized JSON payload will be used, e.g., `{ "type": "notification", "payload": { "level": "info" | "error", "title": "...", "message": "..." } }`.
*   **Events to Implement:**
    *   `follow.enabled`: "Follow mode enabled for branch [branch]."
    *   `follow.disabled`: "Follow mode disabled."
    *   `sync.success`: "Repository synced successfully."
    *   `sync.error`: "Error syncing repository: [details]."
*   **Server Logic:** The `/api/git/event` handler will be responsible for:
    1. Checking if the macOS client is connected via the Unix socket.
    2. If connected, sending event messages through the `controlUnixHandler` for native notifications.
    3. If not connected, storing events for the web UI to poll or receive via SSE.

### 2.3. macOS Client (mac/)

The macOS client provides native UI for Git worktree management.

**Implementation Details:**
*   **Git Detection:** Uses `GitRepositoryMonitor` to automatically detect when the selected working directory is within a Git repository.
*   **Worktree UI:** When Git is detected, `WorktreeSelectionView` appears in the session creation form, showing:
    *   Current branch information  
    *   List of available worktrees with their paths
    *   Option to create new worktrees with custom branch names
    *   Follow mode status indicator
*   **Service Layer:** `WorktreeService` handles all communication with the server's `/api/worktrees` endpoints.
*   **Data Models:** `Worktree.swift` defines the data structures for worktree information.

*   **Notification Handling:** The client will listen for notification events on the Unix socket. Upon receiving one, it will generate and display a native `NSUserNotification` to the user.

*   **Context-Aware UI:**
    *   When a user selects a working directory for a new session, the client automatically detects if it's a Git repository using `GitRepositoryMonitor`.
    *   If the directory is a Git repository, the UI dynamically displays `WorktreeSelectionView` with options to select existing worktrees or create new ones.
    *   When a worktree is selected or created, the working directory automatically updates to the worktree path.

*   **UI Grouping and Labeling:**
    *   The main session list will be updated to group sessions by `gitRepoPath`.
    *   Each group will have a header (e.g., the project folder name).
    *   Within a group, each session will be clearly labeled with its `branch` name.

*   **Worktree Management UI:**
    *   The dedicated management view will list worktrees based on their branches.
    *   This view will fetch data from `GET /api/worktrees` and display:
        *   The branch name.
        *   A summary of changes (e.g., "30 commits, +150, -25 lines").
        *   A visual indicator (e.g., a dot) if the worktree has uncommitted changes.
    *   It will include a button to trigger `POST /api/worktrees/prune`.
    *   It will allow a user to select a branch and enable/disable "Follow Mode" via a call to `POST /api/worktrees/follow`.
    *   **Deletion Flow:**
        *   Each branch in the list will have a "Delete" button.
        *   Clicking "Delete" calls `DELETE /api/worktrees/:branch`.
        *   If the server responds with `409 Conflict`, the UI will present a confirmation dialog with two options:
            1.  **Delete Anyway:** Calls `DELETE /api/worktrees/:branch?force=true`.
            2.  **Cancel:** Closes the dialog.

### 2.4. Web UI (web/)

The web UI provides Git-aware features when the macOS client is not available:

*   **Session Creation with Git Integration:**
    *   When creating a new session, the UI detects if the selected directory is a Git repository.
    *   If a Git repository is detected, users can:
        *   Select an existing branch from a dropdown
        *   Create a new worktree with a custom branch name
        *   Navigate to the worktree management UI
    *   When creating a new worktree, the working directory automatically switches to the new worktree path.

*   **Session Grouping and Branch Labels:**
    *   Sessions are automatically grouped by their `gitRepoPath` property.
    *   Each session displays its current Git branch name in brackets next to the session name.
    *   Repository groups show a Git icon and the repository name as a header.

*   **Worktree Management UI:**
    *   Accessible via a Git icon button on session cards that have a `gitRepoPath`.
    *   Also accessible from the session creation dialog when a Git repository is detected.
    *   Displays the same worktree management interface as the macOS client.
    *   All worktree operations (list, delete, prune, follow mode) are available.
    *   Success/error notifications are displayed as toast messages in the web UI.

*   **Notification Handling:**
    *   Git event notifications are event-driven, not polled.
    *   When the macOS client is connected, notifications are sent via Unix socket for native display.
    *   When the macOS client is not connected, notifications are stored server-side and included in API responses.
    *   The web UI displays these notifications as temporary toast messages using the existing `showSuccess` and `showError` methods.

### 2.5. CLI Tool (`vt`)

The `vt` command-line tool will be extended to support worktree operations.

*   **New Subcommand: `vt wtree`**
    *   **`vt wtree switch <branch-name>`:** A high-level command to switch the main repository to a branch and enable follow mode.
    *   **`vt wtree follow <branch>`:** A CLI method to enable follow mode for a specific branch's worktree.
    *   **`vt wtree unfollow`:** Disables follow mode.
*   **New Subcommand: `vt git`**
    *   **`vt git event`:** Called by Git hooks to notify the server of a change.

## 3. Git Integration and Follow Mode

*   **Path Structure:**
    *   When creating worktrees, branch names will be "slugified" (e.g., `feature/foo` becomes `feature-foo`) to create valid directory names. The server will manage this mapping.

*   **Hook Installation and Resilience:**
    *   **On-Demand Installation:** The server will only install the Git hooks (`post-commit`, `post-checkout`) when a user explicitly enables "Follow Mode" for the first time on a given repository (via the UI or the `vt wtree switch` command).
    *   **Safe Amendment (Chaining):** The installation process will first resolve the correct hooks directory (checking `git config core.hooksPath`). If a hook file already exists, it will be backed up (e.g., `post-checkout.vtbak`), and the new VibeTunnel hook will be written to `exec` the backup script if it exists, thus chaining the hooks. Uninstallation will restore the backup.
    *   **Resilient by Design:** The installed hook scripts will be designed to be robust and non-intrusive. They will first check if the `vt` command is available in the system's `PATH`. If `vt` is not found, the hook will immediately and silently exit with a success code.

*   **Hook Logic:**
    *   Both the `post-commit` and `post-checkout` hooks will simply call `vt git event`, which notifies the server that a change has occurred in the repository.
    *   All hook operations will run in the background (`&`) to avoid blocking Git operations.

*   **Configuration:**
    *   Follow mode state will be stored in Git's own configuration system (`git config --local vibetunnel.followBranch <branch>`). This avoids creating extra files in the user's repository.

*   **Automatic Disabling:**
    *   When the `/api/git/event` endpoint is triggered, it will check if the main repo's current branch has diverged from the followed branch, and if so, disable follow mode.

## 4. Implementation Steps

1.  **Server-Side:**
    a. Implement the new `/api/worktrees` and `/api/git` routes, including the unified `/api/git/event` endpoint with its in-memory lock.
    b. Extend the `POST /api/sessions` and `GET /api/sessions` logic to handle the new Git-related session metadata (gitRepoPath, gitBranch).
    c. Implement the server-side intelligence in the `/api/git/event` handler to manage titles, sync, and follow-mode state.
    d. Implement dual notification delivery: Unix socket for macOS client, and event storage for web UI.
    e. Implement the core logic for shelling out to `git` for all worktree operations, ensuring all commands are executed with parameterized arguments (e.g., via `spawn`) to prevent injection vulnerabilities.
2.  **CLI:**
    a. Add the `wtree` and `git` subcommands to the `vt` tool, including the simplified `git event` command.
3.  **Web UI:**
    a. Implement session grouping by repository with branch labels display.
    b. Add Git icon button to session cards that have a gitRepoPath.
    c. Implement the worktree management UI component with all operations (list, delete, prune, follow mode).
    d. Integrate success/error notifications using the existing toast message system.
    e. Add navigation between session list and worktree management views.
4.  **macOS Client:**
    a. ✅ Implement the context-aware UI for session creation - When a Git repository is detected, WorktreeSelectionView displays available worktrees and allows creating new ones.
    b. Implement the project-based grouping and branch labeling in the session list.
    c. Implement the notification handler for events received over the Unix socket.
    d. ✅ Design and implement the UI for worktree management - WorktreeSelectionView provides full worktree management capabilities integrated into session creation.
    e. ✅ Integrate the UI with the new server APIs - WorktreeService communicates with the server's /api/worktrees endpoints.
5.  **Hooks:**
    a. Implement the logic for the safe, on-demand, chaining installation and uninstallation of the Git hooks.
6.  **Testing:**
    a. Write unit and integration tests for the new API endpoints.
    b. Perform end-to-end testing of both web and macOS UI flows.

## 5. Design Rationale

This section documents the key architectural decisions and alternatives considered during the planning phase.

*   **Git Interaction: Shelling Out vs. `libgit2`**
    *   **Decision:** The plan specifies shelling out to the `git` command-line tool directly.
    *   **Rationale:** This approach is simple, has no additional dependencies, and is guaranteed to be compatible with the user's installed version of Git. It is the most pragmatic and robust starting point.
    *   **Alternative Considered:** Using a library like `nodegit` (which provides bindings for `libgit2`). While potentially faster and providing structured output, it adds a complex native dependency that can complicate installation and maintenance. It remains a viable option for a future performance optimization if the shelling-out approach proves to be too slow.

*   **Automation Trigger: Git Hooks vs. File System Watchers**
    *   **Decision:** Use Git hooks (`post-commit`, `post-checkout`).
    *   **Rationale:** Hooks provide precise, high-level information about specific Git events. A `post-commit` hook fires exactly once after a successful commit. A file system watcher, in contrast, would generate a storm of low-level events during a commit or rebase, making it difficult and error-prone to determine the user's actual intent. Hooks are the idiomatic and correct tool for this job.

*   **Hook Architecture: Simple "Poke" vs. "Smart" Hooks**
    *   **Decision:** The hooks are designed to be simple, containing only a single command (`vt git event`) that notifies the server of a change.
    *   **Rationale:** This makes the hooks themselves extremely robust and easy to maintain. All the complex logic (determining the branch, checking follow mode, updating titles, triggering syncs) is centralized on the server. This is a much cleaner separation of concerns than having complex logic in the hook scripts themselves.

*   **Security: Single-User Context and Best Practices**
    *   **Context:** This feature is designed for a single-user, local desktop application where the server and the Git commands run with the user's own permissions. This mitigates the most severe risks, such as privilege escalation or accessing unauthorized parts of the file system.
    *   **Decision:** Despite the mitigated risk, the plan explicitly adopts security best practices.
    *   **Rationale:** Using parameterized arguments for all shell commands prevents command injection vulnerabilities and is a good engineering practice. This ensures the feature is safe and robust, even if parts of the code are reused in different contexts in the future.

*   **Hook Installation: On-Demand & Safe Chaining**
    *   **Decision:** Hooks are only installed when a user explicitly opts into "Follow Mode". The installation process safely chains with any existing user hooks.
    *   **Rationale:** This is a core principle of minimizing the application's footprint and respecting the user's existing workflow. We should never overwrite or break a user's configuration.

*   **State Management: `git config` vs. Custom File**
    *   **Decision:** Use `git config` to store the follow-mode state.
    *   **Rationale:** This is the idiomatic "Git way" to store repository-specific configuration. It avoids creating extra files that need to be ignored and leverages Git's own robust configuration system.

### 5.1. Future Considerations

This section documents potential improvements that are out of scope for the initial implementation but are worth considering for future iterations.

*   **Performance:** The `GET /api/worktrees` endpoint can be slow on repositories with many worktrees. Future optimizations could include caching the results for a few seconds or splitting the API to load stats on demand.
*   **Event Debouncing:** Rapid-fire Git events (e.g., during an interactive rebase) could spam the `/api/git/event` endpoint. A debouncing mechanism could be added to batch these events.
*   **Advanced Repositories:** The initial implementation may have undefined behavior with non-standard repository setups like bare repos or those with many submodules. Future work could add explicit checks to detect and handle (or disable the feature for) these cases.
*   **Configurable Title Template:** The dynamic title format is currently fixed. A future version could allow users to customize this template.
