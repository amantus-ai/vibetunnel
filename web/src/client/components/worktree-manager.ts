/**
 * Worktree Manager Component
 *
 * Displays and manages Git worktrees for a repository
 *
 * @fires back - When user wants to go back to session list
 * @fires error - When an error occurs
 */
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { GitService, Worktree, WorktreeListResponse } from '../services/git-service.js';
import { createLogger } from '../utils/logger.js';
import { formatPathForDisplay } from '../utils/path-utils.js';
import './notification-status.js';

const logger = createLogger('worktree-manager');

@customElement('worktree-manager')
export class WorktreeManager extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) gitService?: GitService;
  @property({ type: String }) repoPath = '';

  @state() private worktrees: Worktree[] = [];
  @state() private baseBranch = 'main';
  @state() private followBranch?: string;
  @state() private loading = false;
  @state() private error = '';
  @state() private showDeleteConfirm = false;
  @state() private deleteTargetBranch = '';
  @state() private deleteHasChanges = false;
  @state() private showCreateWorktree = false;
  @state() private newBranchName = '';
  @state() private newWorktreePath = '';
  @state() private useCustomPath = false;
  @state() private isCreatingWorktree = false;

  connectedCallback() {
    super.connectedCallback();
    if (this.repoPath && this.gitService) {
      this.loadWorktrees();
    }
  }

  willUpdate(changedProperties: Map<string, unknown>) {
    if (
      (changedProperties.has('repoPath') || changedProperties.has('gitService')) &&
      this.repoPath &&
      this.gitService
    ) {
      this.loadWorktrees();
    }
  }

  private async loadWorktrees() {
    if (!this.gitService || !this.repoPath) {
      return;
    }

    this.loading = true;
    this.error = '';

    try {
      const response: WorktreeListResponse = await this.gitService.listWorktrees(this.repoPath);
      this.worktrees = response.worktrees;
      this.baseBranch = response.baseBranch;
      this.followBranch = response.followBranch;
    } catch (err) {
      logger.error('Failed to load worktrees:', err);
      this.error = err instanceof Error ? err.message : 'Failed to load worktrees';
    } finally {
      this.loading = false;
    }
  }

  private async handleSwitchBranch(branch: string) {
    if (!this.gitService || !this.repoPath) {
      return;
    }

    try {
      await this.gitService.switchBranch(this.repoPath, branch);
      this.dispatchEvent(new CustomEvent('back'));
    } catch (err) {
      logger.error('Failed to switch branch:', err);
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: {
            message: `Failed to switch to ${branch}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          },
        })
      );
    }
  }

  private async handleDeleteWorktree(branch: string, hasChanges: boolean) {
    this.showDeleteConfirm = true;
    this.deleteTargetBranch = branch;
    this.deleteHasChanges = hasChanges;
  }

  private async confirmDelete() {
    if (!this.gitService || !this.repoPath || !this.deleteTargetBranch) {
      return;
    }

    try {
      await this.gitService.deleteWorktree(
        this.repoPath,
        this.deleteTargetBranch,
        this.deleteHasChanges
      );
      this.showDeleteConfirm = false;
      this.deleteTargetBranch = '';
      this.deleteHasChanges = false;
      await this.loadWorktrees();
    } catch (err) {
      logger.error('Failed to delete worktree:', err);
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: {
            message: `Failed to delete worktree: ${err instanceof Error ? err.message : 'Unknown error'}`,
          },
        })
      );
    }
  }

  private cancelDelete() {
    this.showDeleteConfirm = false;
    this.deleteTargetBranch = '';
    this.deleteHasChanges = false;
  }

  private async handleToggleFollow(branch: string, enable: boolean) {
    if (!this.gitService) {
      return;
    }

    try {
      await this.gitService.setFollowMode(this.repoPath, branch, enable);
      await this.loadWorktrees();

      // Trigger a refresh of Git events after follow mode change
      // The Git event service will pick up the change on its next poll

      const action = enable ? 'enabled' : 'disabled';
      this.dispatchEvent(
        new CustomEvent('success', {
          detail: {
            message: `Follow mode ${action} for ${branch}`,
          },
          bubbles: true,
          composed: true,
        })
      );

      // Trigger a check for Git notifications after follow mode change
      this.dispatchEvent(
        new CustomEvent('check-git-notifications', {
          bubbles: true,
          composed: true,
        })
      );
    } catch (err) {
      logger.error('Failed to toggle follow mode:', err);
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: {
            message: `Failed to toggle follow mode: ${err instanceof Error ? err.message : 'Unknown error'}`,
          },
        })
      );
    }
  }

  private formatPath(path: string): string {
    return formatPathForDisplay(path);
  }

  private async handleCreateWorktree() {
    const branchName = this.newBranchName.trim();

    if (!branchName || !this.gitService || !this.repoPath) {
      return;
    }

    // Validate branch name
    const validationError = this.validateBranchName(branchName);
    if (validationError) {
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: { message: validationError },
          bubbles: true,
          composed: true,
        })
      );
      return;
    }

    this.isCreatingWorktree = true;
    try {
      // Use custom path if provided, otherwise generate default
      const worktreePath =
        this.useCustomPath && this.newWorktreePath.trim()
          ? this.newWorktreePath.trim()
          : this.generateWorktreePath(branchName);

      await this.gitService.createWorktree(
        this.repoPath,
        branchName,
        worktreePath,
        this.baseBranch
      );

      // Reset form
      this.showCreateWorktree = false;
      this.newBranchName = '';
      this.newWorktreePath = '';
      this.useCustomPath = false;

      // Reload worktrees
      await this.loadWorktrees();

      this.dispatchEvent(
        new CustomEvent('success', {
          detail: { message: `Created worktree for branch '${branchName}'` },
          bubbles: true,
          composed: true,
        })
      );
    } catch (err) {
      logger.error('Failed to create worktree:', err);

      let errorMessage = 'Failed to create worktree';
      if (err instanceof Error) {
        if (err.message.includes('already exists')) {
          errorMessage = `Worktree path already exists. Try a different branch name or path.`;
        } else if (err.message.includes('already checked out')) {
          errorMessage = `Branch '${branchName}' is already checked out in another worktree`;
        } else {
          errorMessage = err.message;
        }
      }

      this.dispatchEvent(
        new CustomEvent('error', {
          detail: { message: errorMessage },
          bubbles: true,
          composed: true,
        })
      );
    } finally {
      this.isCreatingWorktree = false;
    }
  }

  private validateBranchName(name: string): string | null {
    // Check if branch already exists
    const existingBranches = this.worktrees.map((wt) => wt.branch.replace(/^refs\/heads\//, ''));
    if (existingBranches.includes(name)) {
      return `Branch '${name}' already exists`;
    }

    // Git branch name validation rules
    if (name.startsWith('-') || name.endsWith('-')) {
      return 'Branch name cannot start or end with a hyphen';
    }

    if (name.includes('..') || name.includes('~') || name.includes('^') || name.includes(':')) {
      return 'Branch name contains invalid characters (.. ~ ^ :)';
    }

    if (name.endsWith('.lock')) {
      return 'Branch name cannot end with .lock';
    }

    if (name.includes('//') || name.includes('\\')) {
      return 'Branch name cannot contain consecutive slashes';
    }

    // Reserved names
    const reserved = ['HEAD', 'FETCH_HEAD', 'ORIG_HEAD', 'MERGE_HEAD'];
    if (reserved.includes(name.toUpperCase())) {
      return `'${name}' is a reserved Git name`;
    }

    return null;
  }

  private generateWorktreePath(branchName: string): string {
    const branchSlug = branchName.trim().replace(/[^a-zA-Z0-9-_]/g, '-');
    return `${this.repoPath}-${branchSlug}`;
  }

  private handleCancelCreateWorktree() {
    this.showCreateWorktree = false;
    this.newBranchName = '';
    this.newWorktreePath = '';
    this.useCustomPath = false;
  }

  render() {
    return html`
      <div class="p-4 h-full overflow-y-auto bg-bg">
        <div class="max-w-4xl mx-auto">
          <div class="mb-6">
            <h1 class="text-xl font-bold text-text">Git Worktrees</h1>
          </div>

        ${
          this.error
            ? html`
          <div class="bg-status-error text-white px-4 py-2 rounded mb-4">
            ${this.error}
          </div>
        `
            : ''
        }

        ${
          this.loading
            ? html`
          <div class="flex justify-center items-center py-8">
            <div class="text-secondary">Loading worktrees...</div>
          </div>
        `
            : html`
          <div class="space-y-4">
            <div class="text-sm text-text-muted mb-4">
              Repository: <span class="font-mono text-text break-all">${this.formatPath(this.repoPath)}</span>
            </div>
            
            ${
              this.worktrees.length === 0 ||
              (this.worktrees.length === 1 && this.worktrees[0].isMainWorktree)
                ? html`
              <div class="text-center py-12 space-y-4">
                <div class="text-text-muted text-lg">
                  No additional worktrees found
                </div>
                <div class="text-text-dim text-sm max-w-md mx-auto">
                  This repository only has the main worktree. You can create additional worktrees using the git worktree command in your terminal.
                </div>
                <div class="mt-6">
                  <code class="text-xs bg-surface px-2 py-1 rounded font-mono text-text-muted">
                    git worktree add ../feature-branch feature-branch
                  </code>
                </div>
              </div>
            `
                : html`
              <div class="grid gap-4">
                ${this.worktrees.map(
                  (worktree) => html`
                  <div class="bg-surface rounded-lg p-4 border border-border hover:border-border-focus transition-colors">
                    <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-2 flex-wrap">
                          <h3 class="font-semibold text-lg text-text">
                            ${worktree.branch || 'detached'}
                          </h3>
                          ${
                            worktree.isMainWorktree
                              ? html`
                            <span class="px-2 py-1 text-xs bg-primary text-bg-elevated rounded">Main</span>
                          `
                              : ''
                          }
                          ${
                            worktree.isCurrentWorktree
                              ? html`
                            <span class="px-2 py-1 text-xs bg-status-success text-bg-elevated rounded">Current</span>
                          `
                              : ''
                          }
                        </div>
                        
                        <div class="text-sm text-text-muted space-y-1">
                          <div class="font-mono text-text-dim break-all">${this.formatPath(worktree.path)}</div>
                          ${
                            worktree.HEAD
                              ? html`
                            <div class="text-text-muted">HEAD: <span class="font-mono">${worktree.HEAD.slice(0, 7)}</span></div>
                          `
                              : ''
                          }
                          ${
                            worktree.commitsAhead !== undefined
                              ? html`
                            <div class="flex items-center gap-4 flex-wrap">
                              ${
                                worktree.commitsAhead > 0
                                  ? html`
                                <span class="text-status-success">↑ ${worktree.commitsAhead} ahead</span>
                              `
                                  : ''
                              }
                              ${
                                worktree.hasUncommittedChanges
                                  ? html`
                                <span class="text-status-warning">● Uncommitted changes</span>
                              `
                                  : ''
                              }
                            </div>
                          `
                              : ''
                          }
                        </div>
                      </div>
                      
                      <div class="flex gap-2 flex-wrap sm:flex-nowrap sm:ml-4">
                        ${
                          !worktree.isMainWorktree
                            ? html`
                          <button
                            @click=${() => this.handleToggleFollow(worktree.branch, this.followBranch !== worktree.branch)}
                            class="px-3 py-1 text-sm font-medium ${
                              this.followBranch === worktree.branch
                                ? 'text-bg-elevated bg-status-success hover:bg-status-success/90'
                                : 'text-text bg-surface hover:bg-surface-hover border border-border'
                            } rounded transition-colors"
                            title="${this.followBranch === worktree.branch ? 'Disable follow mode' : 'Enable follow mode'}"
                          >
                            ${this.followBranch === worktree.branch ? 'Following' : 'Follow'}
                          </button>
                        `
                            : ''
                        }
                        ${
                          !worktree.isCurrentWorktree
                            ? html`
                          <button
                            @click=${() => this.handleSwitchBranch(worktree.branch)}
                            class="px-3 py-1 text-sm font-medium text-bg-elevated bg-primary rounded hover:bg-primary-hover transition-colors"
                          >
                            Switch
                          </button>
                        `
                            : ''
                        }
                        ${
                          !worktree.isMainWorktree
                            ? html`
                          <button
                            @click=${() => this.handleDeleteWorktree(worktree.branch, worktree.hasUncommittedChanges || false)}
                            class="px-3 py-1 text-sm font-medium text-bg-elevated bg-status-error rounded hover:bg-status-error/90 transition-colors"
                          >
                            Delete
                          </button>
                        `
                            : ''
                        }
                      </div>
                    </div>
                  </div>
                `
                )}
              </div>
            `
            }
          </div>

          <!-- Create New Worktree Button -->
          <div class="mt-6 flex justify-center">
            <button
              @click=${() => {
                this.showCreateWorktree = true;
              }}
              class="px-4 py-2 text-sm font-medium text-bg-elevated bg-primary rounded hover:bg-primary-hover transition-colors flex items-center gap-2"
              ?disabled=${this.loading}
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Create New Worktree
            </button>
          </div>
        `
        }

        <!-- Create Worktree Modal -->
        ${
          this.showCreateWorktree
            ? html`
            <div class="fixed inset-0 bg-bg/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div class="bg-surface rounded-lg p-6 max-w-md w-full border border-border shadow-elevated">
                <h3 class="text-lg font-semibold mb-4 text-text">Create New Worktree</h3>
                
                <div class="space-y-4">
                  <!-- Branch Name Input -->
                  <div>
                    <label class="block text-sm font-medium text-text-muted mb-1">
                      Branch Name
                    </label>
                    <input
                      type="text"
                      .value=${this.newBranchName}
                      @input=${(e: InputEvent) => {
                        this.newBranchName = (e.target as HTMLInputElement).value;
                      }}
                      placeholder="feature/new-feature"
                      class="w-full px-3 py-2 bg-bg border border-border rounded focus:border-primary focus:outline-none text-text"
                      ?disabled=${this.isCreatingWorktree}
                      @keydown=${(e: KeyboardEvent) => {
                        if (e.key === 'Enter' && this.newBranchName.trim()) {
                          this.handleCreateWorktree();
                        } else if (e.key === 'Escape') {
                          this.handleCancelCreateWorktree();
                        }
                      }}
                    />
                    ${
                      this.newBranchName.trim()
                        ? html`
                        <div class="text-xs mt-1 ${this.validateBranchName(this.newBranchName) ? 'text-status-error' : 'text-text-dim'}">
                          ${this.validateBranchName(this.newBranchName) || 'Valid branch name'}
                        </div>
                      `
                        : ''
                    }
                  </div>

                  <!-- Base Branch Selection -->
                  <div>
                    <label class="block text-sm font-medium text-text-muted mb-1">
                      Base Branch
                    </label>
                    <div class="text-sm text-text bg-bg px-3 py-2 border border-border rounded">
                      ${this.baseBranch}
                    </div>
                  </div>

                  <!-- Path Customization -->
                  <div>
                    <label class="flex items-center gap-2 text-sm text-text-muted cursor-pointer">
                      <input
                        type="checkbox"
                        .checked=${this.useCustomPath}
                        @change=${(e: Event) => {
                          this.useCustomPath = (e.target as HTMLInputElement).checked;
                          if (!this.useCustomPath) {
                            this.newWorktreePath = '';
                          }
                        }}
                        ?disabled=${this.isCreatingWorktree}
                        class="rounded"
                      />
                      <span>Customize worktree path</span>
                    </label>
                  </div>

                  ${
                    this.useCustomPath
                      ? html`
                      <div>
                        <label class="block text-sm font-medium text-text-muted mb-1">
                          Custom Path
                        </label>
                        <input
                          type="text"
                          .value=${this.newWorktreePath}
                          @input=${(e: InputEvent) => {
                            this.newWorktreePath = (e.target as HTMLInputElement).value;
                          }}
                          placeholder="/path/to/worktree"
                          class="w-full px-3 py-2 bg-bg border border-border rounded focus:border-primary focus:outline-none text-text"
                          ?disabled=${this.isCreatingWorktree}
                        />
                        <div class="text-xs text-text-dim mt-1">
                          ${
                            this.newWorktreePath.trim()
                              ? `Will create at: ${this.newWorktreePath.trim()}`
                              : 'Enter absolute path for the worktree'
                          }
                        </div>
                      </div>
                    `
                      : html`
                      <div class="text-xs text-text-dim">
                        Default path: ${this.generateWorktreePath(this.newBranchName.trim() || 'branch')}
                      </div>
                    `
                  }
                </div>

                <!-- Modal Actions -->
                <div class="flex justify-end gap-2 mt-6">
                  <button
                    @click=${this.handleCancelCreateWorktree}
                    class="px-4 py-2 text-sm font-medium text-text bg-surface rounded hover:bg-surface-hover transition-colors border border-border"
                    ?disabled=${this.isCreatingWorktree}
                  >
                    Cancel
                  </button>
                  <button
                    @click=${this.handleCreateWorktree}
                    class="px-4 py-2 text-sm font-medium text-bg-elevated bg-primary rounded hover:bg-primary-hover transition-colors disabled:opacity-50"
                    ?disabled=${!this.newBranchName.trim() || !!this.validateBranchName(this.newBranchName.trim()) || (this.useCustomPath && !this.newWorktreePath.trim()) || this.isCreatingWorktree}
                  >
                    ${this.isCreatingWorktree ? 'Creating...' : 'Create Worktree'}
                  </button>
                </div>
              </div>
            </div>
          `
            : ''
        }

        ${
          this.showDeleteConfirm
            ? html`
          <div class="fixed inset-0 bg-bg/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div class="bg-surface rounded-lg p-6 max-w-md w-full border border-border shadow-elevated">
              <h3 class="text-lg font-semibold mb-4 text-text">Confirm Delete</h3>
              <p class="text-text-muted mb-4">
                Are you sure you want to delete the worktree for branch 
                <span class="font-mono font-semibold text-text">${this.deleteTargetBranch}</span>?
              </p>
              ${
                this.deleteHasChanges
                  ? html`
                <p class="text-status-warning mb-4">
                  ⚠️ This worktree has uncommitted changes that will be lost.
                </p>
              `
                  : ''
              }
              <div class="flex justify-end gap-2">
                <button
                  @click=${this.cancelDelete}
                  class="px-4 py-2 text-sm font-medium text-text bg-surface rounded hover:bg-surface-hover transition-colors border border-border"
                >
                  Cancel
                </button>
                <button
                  @click=${this.confirmDelete}
                  class="px-4 py-2 text-sm font-medium text-bg-elevated bg-status-error rounded hover:bg-status-error/90 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        `
            : ''
        }
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'worktree-manager': WorktreeManager;
  }
}
