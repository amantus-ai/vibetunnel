/**
 * Repository Header Component
 *
 * Displays a repository header with Git info, follow mode indicator, and controls.
 * Used to group sessions by repository in the session list.
 *
 * @fires follow-mode-change - When follow mode is changed
 * @fires worktree-action - When a worktree action is triggered
 */
import { html, LitElement, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { getBaseRepoName } from '../../../shared/utils/git.js';

@customElement('repository-header')
export class RepositoryHeader extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: String }) repoPath!: string;
  @property({ type: String }) followMode?: string;
  @property({ type: Object }) followModeSelector?: TemplateResult | string; // Will be rendered from parent
  @property({ type: Object }) worktreeSelector?: TemplateResult | string; // Will be rendered from parent

  private getRepoName(): string {
    return getBaseRepoName(this.repoPath);
  }

  private renderFollowModeIndicator() {
    if (!this.followMode) return '';

    return html`
      <span class="text-[10px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded flex items-center gap-1" 
            title="Following worktree: ${this.followMode}">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
        ${this.followMode}
      </span>
    `;
  }

  render() {
    return html`
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m9.632 4.684C18.114 15.938 18 15.482 18 15c0-.482.114-.938.316-1.342m0 2.684a3 3 0 110-2.684M15 9a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <h4 class="text-sm font-medium text-text-muted flex items-center gap-2">
            ${this.getRepoName()}
            ${this.renderFollowModeIndicator()}
          </h4>
        </div>
        <div class="flex items-center gap-2">
          ${this.followModeSelector}
          ${this.worktreeSelector}
        </div>
      </div>
    `;
  }
}
