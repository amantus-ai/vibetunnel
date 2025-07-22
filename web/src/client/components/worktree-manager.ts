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

  private handleBack() {
    this.dispatchEvent(new CustomEvent('back'));
  }

  private async handleToggleFollow(branch: string, enable: boolean) {
    if (!this.gitService) {
      return;
    }

    try {
      await this.gitService.setFollowMode(this.repoPath, branch, enable);
      await this.loadWorktrees();
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
    const home = process.env.HOME || '';
    if (home && path.startsWith(home)) {
      return `~${path.slice(home.length)}`;
    }
    return path;
  }

  render() {
    return html`
      <div class="p-4 max-w-4xl mx-auto">
        <div class="flex items-center justify-between mb-6">
          <h1 class="text-2xl font-bold">Git Worktrees</h1>
          <button 
            @click=${this.handleBack}
            class="px-4 py-2 text-sm font-medium text-primary-dark bg-primary-light rounded-md hover:bg-primary-lighter transition-colors"
          >
            Back to Sessions
          </button>
        </div>

        ${
          this.error
            ? html`
          <notification-status
            .message=${this.error}
            type="error"
            .visible=${true}
          ></notification-status>
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
            <div class="text-sm text-secondary mb-2">
              Repository: <span class="font-mono">${this.formatPath(this.repoPath)}</span>
            </div>
            
            ${
              this.worktrees.length === 0
                ? html`
              <div class="text-center py-8 text-secondary">
                No worktrees found
              </div>
            `
                : html`
              <div class="grid gap-4">
                ${this.worktrees.map(
                  (worktree) => html`
                  <div class="bg-primary-light rounded-lg p-4 border border-primary-lighter">
                    <div class="flex items-start justify-between">
                      <div class="flex-1">
                        <div class="flex items-center gap-2 mb-2">
                          <h3 class="font-semibold text-lg">
                            ${worktree.branch || 'detached'}
                          </h3>
                          ${
                            worktree.isMainWorktree
                              ? html`
                            <span class="px-2 py-1 text-xs bg-accent-primary text-white rounded">Main</span>
                          `
                              : ''
                          }
                          ${
                            worktree.isCurrentWorktree
                              ? html`
                            <span class="px-2 py-1 text-xs bg-green-600 text-white rounded">Current</span>
                          `
                              : ''
                          }
                        </div>
                        
                        <div class="text-sm text-secondary space-y-1">
                          <div class="font-mono">${this.formatPath(worktree.path)}</div>
                          ${
                            worktree.HEAD
                              ? html`
                            <div>HEAD: <span class="font-mono">${worktree.HEAD.slice(0, 7)}</span></div>
                          `
                              : ''
                          }
                          ${
                            worktree.commitsAhead !== undefined
                              ? html`
                            <div class="flex items-center gap-4">
                              ${
                                worktree.commitsAhead > 0
                                  ? html`
                                <span class="text-green-600">↑ ${worktree.commitsAhead} ahead</span>
                              `
                                  : ''
                              }
                              ${
                                worktree.hasUncommittedChanges
                                  ? html`
                                <span class="text-yellow-600">● Uncommitted changes</span>
                              `
                                  : ''
                              }
                            </div>
                          `
                              : ''
                          }
                        </div>
                      </div>
                      
                      <div class="flex gap-2 ml-4">
                        ${
                          !worktree.isMainWorktree
                            ? html`
                          <button
                            @click=${() => this.handleToggleFollow(worktree.branch, this.followBranch !== worktree.branch)}
                            class="px-3 py-1 text-sm font-medium ${
                              this.followBranch === worktree.branch
                                ? 'text-white bg-green-600 hover:bg-green-700'
                                : 'text-primary-dark bg-primary-lighter hover:bg-primary-lightest'
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
                            class="px-3 py-1 text-sm font-medium text-white bg-accent-primary rounded hover:bg-accent-primary-dark transition-colors"
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
                            class="px-3 py-1 text-sm font-medium text-white bg-red-600 rounded hover:bg-red-700 transition-colors"
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
        `
        }

        ${
          this.showDeleteConfirm
            ? html`
          <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div class="bg-primary-light rounded-lg p-6 max-w-md w-full mx-4">
              <h3 class="text-lg font-semibold mb-4">Confirm Delete</h3>
              <p class="text-secondary mb-4">
                Are you sure you want to delete the worktree for branch 
                <span class="font-mono font-semibold">${this.deleteTargetBranch}</span>?
              </p>
              ${
                this.deleteHasChanges
                  ? html`
                <p class="text-yellow-600 mb-4">
                  ⚠️ This worktree has uncommitted changes that will be lost.
                </p>
              `
                  : ''
              }
              <div class="flex justify-end gap-2">
                <button
                  @click=${this.cancelDelete}
                  class="px-4 py-2 text-sm font-medium text-primary-dark bg-primary-lighter rounded hover:bg-primary-lightest transition-colors"
                >
                  Cancel
                </button>
                <button
                  @click=${this.confirmDelete}
                  class="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded hover:bg-red-700 transition-colors"
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
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'worktree-manager': WorktreeManager;
  }
}
