/**
 * Git Status Badge Component
 *
 * Displays git repository status information in a compact badge format.
 * Shows counts for added, modified, deleted files, and ahead/behind commits.
 */
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Session } from '../../shared/types.js';

@customElement('git-status-badge')
export class GitStatusBadge extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) session: Session | null = null;
  @property({ type: Boolean }) detailed = false; // Show detailed breakdown

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
    }
  }

  render() {
    // Show badge if we have a git repo path (even if branch is not loaded yet)
    if (!this.session?.gitRepoPath) {
      console.debug('[GitStatusBadge] Not rendering - no gitRepoPath', this.session);
      return null;
    }

    const _hasLocalChanges =
      (this.session?.gitModifiedCount ?? 0) > 0 ||
      (this.session?.gitAddedCount ?? 0) > 0 ||
      (this.session?.gitDeletedCount ?? 0) > 0;

    const _hasRemoteChanges =
      (this.session?.gitAheadCount ?? 0) > 0 || (this.session?.gitBehindCount ?? 0) > 0;

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

    const addedCount = this.session?.gitAddedCount ?? 0;
    const modifiedCount = this.session?.gitModifiedCount ?? 0;
    const deletedCount = this.session?.gitDeletedCount ?? 0;
    const totalChanges = addedCount + modifiedCount + deletedCount;

    if (totalChanges === 0 && !this.detailed) return null;

    if (this.detailed) {
      // Detailed view shows individual counts
      return html`
        <span class="flex items-center gap-1">
          ${
            addedCount > 0
              ? html`
            <span class="text-green-600 dark:text-green-400" title="New files">
              +${addedCount}
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
            deletedCount > 0
              ? html`
            <span class="text-red-600 dark:text-red-400" title="Deleted files">
              -${deletedCount}
            </span>
          `
              : null
          }
        </span>
      `;
    } else {
      // Compact view shows total with an indicator
      return html`
        <span class="text-yellow-600 dark:text-yellow-400" title="${addedCount} new, ${modifiedCount} modified, ${deletedCount} deleted">
          ●${totalChanges}
        </span>
      `;
    }
  }

  private renderRemoteChanges() {
    if (!this.session) return null;

    const aheadCount = this.session?.gitAheadCount ?? 0;
    const behindCount = this.session?.gitBehindCount ?? 0;

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
