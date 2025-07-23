/**
 * Repository Dropdown Component
 *
 * Dropdown list of discovered repositories for quick selection.
 */
import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Repository } from '../autocomplete-manager.js';

@customElement('repository-dropdown')
export class RepositoryDropdown extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;
  @property({ type: Array }) repositories: Repository[] = [];

  private handleRepositoryClick(repoPath: string) {
    this.dispatchEvent(
      new CustomEvent('repository-selected', {
        detail: { path: repoPath },
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    if (!this.visible || this.repositories.length === 0) {
      return nothing;
    }

    return html`
      <div class="mt-2 bg-bg-elevated border border-border/50 rounded-lg overflow-hidden">
        <div class="max-h-48 overflow-y-auto">
          ${this.repositories.map(
            (repo) => html`
              <button
                @click=${() => this.handleRepositoryClick(repo.path)}
                class="w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors duration-200 border-b border-border/30 last:border-b-0"
                type="button"
              >
                <div class="flex items-center justify-between">
                  <div class="flex-1">
                    <div class="flex items-center gap-2">
                      <div class="text-text text-xs sm:text-sm font-medium">${repo.folderName}</div>
                    </div>
                    <div class="text-text-muted text-[9px] sm:text-[10px] mt-0.5">${repo.relativePath}</div>
                  </div>
                  <div class="text-text-muted text-[9px] sm:text-[10px]">
                    ${new Date(repo.lastModified).toLocaleDateString()}
                  </div>
                </div>
              </button>
            `
          )}
        </div>
      </div>
    `;
  }
}
