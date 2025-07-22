/**
 * Worktree Manager Component
 *
 * Displays and manages Git worktrees for a repository
 * 
 * @fires error - When an error occurs
 * @fires navigate-to-list - When user wants to go back to session list
 */
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createLogger } from '../utils/logger.js';
import type { GitService, Worktree, WorktreeListResponse } from '../services/git-service.js';
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
  @state() private loading = false;
  @state() private error = '';
  @state() private showDeleteConfirm = false;
  @state() private deleteTargetBranch = '';
  @state() private deleteHasChanges = false;
  @state() private followBranch: string | null = null;

  connectedCallback() {
    super.connectedCallback();
    if (this.repoPath && this.gitService) {
      this.loadWorktrees();
    }
  }

  willUpdate(changedProperties: Map<string, unknown>) {
    if ((changedProperties.has('repoPath') || changedProperties.has('gitService')) && 
        this.repoPath && this.gitService) {
      this.loadWorktrees();
    }
  }

  private async loadWorktrees() {
    if (!this.gitService || !this.repoPath) {
      logger.warn('Cannot load worktrees: missing gitService or repoPath');
      return;
    }

    this.loading = true;
    this.error = '';

    try {
      const response: WorktreeListResponse = await this.gitService.listWorktrees(this.repoPath);
      this.worktrees = response.worktrees;
      this.baseBranch = response.baseBranch;
      this.followBranch = response.followBranch || null;
      logger.debug('Loaded worktrees:', this.worktrees);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load worktrees';
      logger.error('Failed to load worktrees:', error);
      this.error = message;
      this.dispatchEvent(new CustomEvent('error', { 
        detail: { message },
        bubbles: true,
        composed: true 
      }));
    } finally {
      this.loading = false;
    }
  }

  private async handleDelete(branch: string, hasChanges: boolean) {
    if (hasChanges) {
      // Show confirmation dialog for worktrees with uncommitted changes
      this.deleteTargetBranch = branch;
      this.deleteHasChanges = true;
      this.showDeleteConfirm = true;
    } else {
      // Delete directly if no uncommitted changes
      await this.performDelete(branch, false);
    }
  }

  private async performDelete(branch: string, force: boolean) {
    if (!this.gitService) return;

    try {
      await this.gitService.deleteWorktree(this.repoPath, branch, force);
      
      // Reload worktrees after successful deletion
      await this.loadWorktrees();
      
      // Show success message
      this.dispatchEvent(new CustomEvent('success', { 
        detail: { message: `Worktree '${branch}' deleted successfully` },
        bubbles: true,
        composed: true 
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to delete worktree '${branch}'`;
      logger.error('Failed to delete worktree:', error);
      this.dispatchEvent(new CustomEvent('error', { 
        detail: { message },
        bubbles: true,
        composed: true 
      }));
    } finally {
      this.showDeleteConfirm = false;
      this.deleteTargetBranch = '';
      this.deleteHasChanges = false;
    }
  }

  private async handlePrune() {
    if (!this.gitService) return;

    try {
      await this.gitService.pruneWorktrees(this.repoPath);
      
      // Reload worktrees after pruning
      await this.loadWorktrees();
      
      // Show success message
      this.dispatchEvent(new CustomEvent('success', { 
        detail: { message: 'Worktrees pruned successfully' },
        bubbles: true,
        composed: true 
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to prune worktrees';
      logger.error('Failed to prune worktrees:', error);
      this.dispatchEvent(new CustomEvent('error', { 
        detail: { message },
        bubbles: true,
        composed: true 
      }));
    }
  }

  private async handleFollowToggle(branch: string, enable: boolean) {
    if (!this.gitService) return;

    try {
      await this.gitService.setFollowMode(this.repoPath, branch, enable);
      
      // Update local state
      this.followBranch = enable ? branch : null;
      
      // Show success message
      const action = enable ? 'enabled' : 'disabled';
      this.dispatchEvent(new CustomEvent('success', { 
        detail: { message: `Follow mode ${action} for branch '${branch}'` },
        bubbles: true,
        composed: true 
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to ${enable ? 'enable' : 'disable'} follow mode`;
      logger.error('Failed to toggle follow mode:', error);
      this.dispatchEvent(new CustomEvent('error', { 
        detail: { message },
        bubbles: true,
        composed: true 
      }));
    }
  }

  private formatChangeSummary(worktree: WorktreeInfo): string {
    if (!worktree.stats) return '';
    
    const parts = [];
    
    if (worktree.stats.commitsAhead > 0) {
      parts.push(`${worktree.stats.commitsAhead} commits`);
    }
    
    if (worktree.stats.filesChanged > 0) {
      parts.push(`${worktree.stats.filesChanged} files`);
    }
    
    if (worktree.stats.linesAdded > 0 || worktree.stats.linesDeleted > 0) {
      parts.push(`+${worktree.stats.linesAdded}, -${worktree.stats.linesDeleted}`);
    }
    
    return parts.join(', ');
  }

  private handleNavigateBack() {
    this.dispatchEvent(new CustomEvent('navigate-to-list', { 
      bubbles: true,
      composed: true 
    }));
  }

  render() {
    return html`
      <div class="min-h-screen bg-primary text-text-primary">
        <!-- Header -->
        <div class="bg-bg-elevated border-b border-border">
          <div class="px-4 py-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <button
                  @click=${this.handleNavigateBack}
                  class="btn btn-secondary p-2"
                  title="Back to sessions"
                >
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </button>
                <h1 class="text-xl font-semibold">Git Worktrees</h1>
                <span class="text-sm text-text-secondary">${this.repoPath}</span>
              </div>
              
              <button
                @click=${this.handlePrune}
                class="btn btn-secondary"
                ?disabled=${this.loading}
              >
                Prune Worktrees
              </button>
            </div>
          </div>
        </div>

        <!-- Loading state -->
        ${this.loading ? html`
          <div class="flex items-center justify-center py-12">
            <div class="text-text-secondary">Loading worktrees...</div>
          </div>
        ` : ''}

        <!-- Error state -->
        ${this.error ? html`
          <div class="mx-4 mt-4 p-4 bg-status-error bg-opacity-10 border border-status-error rounded">
            <div class="text-status-error">${this.error}</div>
          </div>
        ` : ''}

        <!-- Worktree list -->
        ${!this.loading && !this.error ? html`
          <div class="p-4">
            <div class="space-y-3">
              ${this.worktrees.map(worktree => html`
                <div class="bg-bg-elevated border border-border rounded-lg p-4">
                  <div class="flex items-start justify-between">
                    <div class="flex-1">
                      <div class="flex items-center gap-3">
                        <h3 class="text-lg font-medium text-text-primary">
                          ${worktree.branch}
                        </h3>
                        ${worktree.isMainWorktree ? html`
                          <span class="px-2 py-0.5 text-xs bg-accent-primary bg-opacity-20 text-accent-primary rounded">
                            Main
                          </span>
                        ` : ''}
                        ${worktree.isDirty ? html`
                          <span class="w-2 h-2 bg-status-warning rounded-full" title="Uncommitted changes"></span>
                        ` : ''}
                        ${this.followBranch === worktree.branch ? html`
                          <span class="px-2 py-0.5 text-xs bg-status-success bg-opacity-20 text-status-success rounded">
                            Following
                          </span>
                        ` : ''}
                      </div>
                      
                      <div class="mt-1 text-sm text-text-secondary">
                        ${worktree.path}
                      </div>
                      
                      ${worktree.stats ? html`
                        <div class="mt-2 text-sm text-text-tertiary">
                          ${this.formatChangeSummary(worktree)}
                        </div>
                      ` : ''}
                    </div>
                    
                    <div class="flex items-center gap-2 ml-4">
                      ${!worktree.isMainWorktree ? html`
                        <button
                          @click=${() => this.handleFollowToggle(worktree.branch, this.followBranch !== worktree.branch)}
                          class="btn btn-secondary text-sm"
                          title="${this.followBranch === worktree.branch ? 'Disable' : 'Enable'} follow mode"
                        >
                          ${this.followBranch === worktree.branch ? 'Unfollow' : 'Follow'}
                        </button>
                        
                        <button
                          @click=${() => this.handleDelete(worktree.branch, worktree.isDirty)}
                          class="btn btn-danger text-sm"
                          title="Delete worktree"
                        >
                          Delete
                        </button>
                      ` : ''}
                    </div>
                  </div>
                </div>
              `)}
            </div>
          </div>
        ` : ''}

        <!-- Delete confirmation dialog -->
        ${this.showDeleteConfirm ? html`
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
            <div class="bg-bg-elevated rounded-lg p-6 max-w-md w-full">
              <h3 class="text-lg font-semibold mb-4">Delete Worktree</h3>
              
              <p class="text-text-secondary mb-4">
                ${this.deleteHasChanges 
                  ? `The worktree '${this.deleteTargetBranch}' has uncommitted changes. Are you sure you want to delete it?`
                  : `Are you sure you want to delete the worktree '${this.deleteTargetBranch}'?`
                }
              </p>
              
              <div class="flex justify-end gap-3">
                <button
                  @click=${() => this.showDeleteConfirm = false}
                  class="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  @click=${() => this.performDelete(this.deleteTargetBranch, this.deleteHasChanges)}
                  class="btn btn-danger"
                >
                  Delete${this.deleteHasChanges ? ' Anyway' : ''}
                </button>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }
}