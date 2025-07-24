/**
 * Git Status Badge Component
 *
 * Displays git repository status information in a compact badge format.
 * Shows counts for modified, untracked, staged files, and ahead/behind commits.
 */
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Session } from '../../shared/types.js';

@customElement('git-status-badge')
export class GitStatusBadge extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) session: Session | null = null;
  @property({ type: Boolean }) detailed = false; // Show detailed breakdown
  @property({ type: Number }) pollInterval = 5000; // Poll every 5 seconds

  @state() private _isPolling = false;
  @state() private _gitModifiedCount = 0;
  @state() private _gitUntrackedCount = 0;
  @state() private _gitStagedCount = 0;
  @state() private _gitAheadCount = 0;
  @state() private _gitBehindCount = 0;

  private _pollTimer?: number;
  private _visibilityHandler?: () => void;

  connectedCallback() {
    super.connectedCallback();

    // Set up visibility change listener
    this._visibilityHandler = () => {
      if (!document.hidden) {
        this._startPolling();
      } else {
        this._stopPolling();
      }
    };

    document.addEventListener('visibilitychange', this._visibilityHandler);

    // Start polling if page is visible and we have a session
    if (!document.hidden && this.session?.id) {
      this._startPolling();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Clean up
    this._stopPolling();
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
    }
  }

  updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);

    // Handle session changes
    if (changedProperties.has('session')) {
      const oldSession = changedProperties.get('session') as Session | null;

      // Only log if gitRepoPath actually changed to reduce noise
      if (oldSession?.gitRepoPath !== this.session?.gitRepoPath) {
        console.debug('[GitStatusBadge] Git repo path changed', {
          oldGitRepoPath: oldSession?.gitRepoPath,
          newGitRepoPath: this.session?.gitRepoPath,
          oldId: oldSession?.id,
          newId: this.session?.id,
        });
      }

      // Initialize internal state from session
      if (this.session) {
        this._gitModifiedCount = this.session.gitModifiedCount ?? 0;
        this._gitUntrackedCount = this.session.gitUntrackedCount ?? 0;
        this._gitStagedCount = this.session.gitStagedCount ?? 0;
        this._gitAheadCount = this.session.gitAheadCount ?? 0;
        this._gitBehindCount = this.session.gitBehindCount ?? 0;
      }

      if (this.session?.id && !document.hidden) {
        this._startPolling();
      } else {
        this._stopPolling();
      }
    }

    // Handle poll interval changes
    if (changedProperties.has('pollInterval') && this._isPolling) {
      this._stopPolling();
      this._startPolling();
    }
  }

  private async _startPolling() {
    if (this._isPolling || !this.session?.id) return;

    this._isPolling = true;

    // Initial fetch
    await this._updateGitStatus();

    // Set up periodic polling
    this._pollTimer = window.setInterval(() => {
      if (!document.hidden && this.session?.id) {
        this._updateGitStatus();
      }
    }, this.pollInterval);
  }

  private _stopPolling() {
    this._isPolling = false;

    if (this._pollTimer) {
      window.clearInterval(this._pollTimer);
      this._pollTimer = undefined;
    }
  }

  private async _updateGitStatus() {
    if (!this.session?.id) return;

    try {
      const response = await fetch(`/api/sessions/${this.session.id}/git-status`);
      if (!response.ok) return;

      const status = await response.json();

      // Update internal state instead of modifying the session object
      this._gitModifiedCount = status.modified || 0;
      this._gitUntrackedCount = status.untracked || 0;
      this._gitStagedCount = status.added || 0;
      this._gitAheadCount = status.ahead || 0;
      this._gitBehindCount = status.behind || 0;

      // State updates will trigger re-render automatically
    } catch (error) {
      // Silently ignore errors to avoid disrupting the UI
      console.debug('Failed to update git status:', error);
    }
  }

  render() {
    // Show badge if we have a git repo path (even if branch is not loaded yet)
    if (!this.session?.gitRepoPath) {
      console.debug('[GitStatusBadge] Not rendering - no gitRepoPath', this.session);
      return null;
    }

    const _hasLocalChanges =
      this._gitModifiedCount > 0 || this._gitUntrackedCount > 0 || this._gitStagedCount > 0;

    const _hasRemoteChanges = this._gitAheadCount > 0 || this._gitBehindCount > 0;

    // Always show the badge when in a Git repository
    // Even if there are no changes, users want to see the branch name

    return html`
      <div class="flex items-center gap-1.5 text-xs">
        ${this.renderBranchInfo()}
        ${this.renderLocalChanges()}
        ${this.renderRemoteChanges()}
      </div>
    `;
  }

  private renderBranchInfo() {
    // Show branch if available, otherwise show "git" as placeholder
    const branchDisplay = this.session?.gitBranch || 'git';
    const isWorktree = this.session?.gitIsWorktree || false;

    return html`
      <span class="text-muted-foreground">
        [${branchDisplay}${isWorktree ? ' •' : ''}]
      </span>
    `;
  }

  private renderLocalChanges() {
    if (!this.session) return null;

    const modifiedCount = this._gitModifiedCount;
    const untrackedCount = this._gitUntrackedCount;
    const stagedCount = this._gitStagedCount;
    const totalChanges = modifiedCount + untrackedCount + stagedCount;

    if (totalChanges === 0 && !this.detailed) return null;

    if (this.detailed) {
      // Detailed view shows individual counts
      return html`
        <span class="flex items-center gap-1">
          ${
            stagedCount > 0
              ? html`
            <span class="text-green-600 dark:text-green-400" title="Staged files">
              +${stagedCount}
            </span>
          `
              : null
          }
          ${
            modifiedCount > 0
              ? html`
            <span class="text-yellow-600 dark:text-yellow-400" title="Modified files">
              ~${modifiedCount}
            </span>
          `
              : null
          }
          ${
            untrackedCount > 0
              ? html`
            <span class="text-blue-600 dark:text-blue-400" title="Untracked files">
              ?${untrackedCount}
            </span>
          `
              : null
          }
        </span>
      `;
    } else {
      // Compact view shows total with an indicator
      return html`
        <span class="text-yellow-600 dark:text-yellow-400" title="${modifiedCount} modified, ${untrackedCount} untracked, ${stagedCount} staged">
          ●${totalChanges}
        </span>
      `;
    }
  }

  private renderRemoteChanges() {
    if (!this.session) return null;

    const aheadCount = this._gitAheadCount;
    const behindCount = this._gitBehindCount;

    if (aheadCount === 0 && behindCount === 0) return null;

    return html`
      <span class="flex items-center gap-0.5">
        ${
          aheadCount > 0
            ? html`
          <span class="text-green-600 dark:text-green-400" title="Commits ahead">
            ↑${aheadCount}
          </span>
        `
            : null
        }
        ${
          behindCount > 0
            ? html`
          <span class="text-red-600 dark:text-red-400" title="Commits behind">
            ↓${behindCount}
          </span>
        `
            : null
        }
      </span>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'git-status-badge': GitStatusBadge;
  }
}
