/**
 * Directory Autocomplete Component
 *
 * Dropdown component that shows directory suggestions, Git information,
 * and repository completions for the working directory input.
 */
import { html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { AutocompleteItem } from '../autocomplete-manager.js';

@customElement('directory-autocomplete')
export class DirectoryAutocomplete extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;
  @property({ type: Array }) items: AutocompleteItem[] = [];
  @property({ type: Number }) selectedIndex = -1;
  @property({ type: Boolean }) isLoading = false;

  private handleItemClick(item: AutocompleteItem) {
    this.dispatchEvent(
      new CustomEvent('item-selected', {
        detail: { suggestion: item.suggestion },
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    if (!this.visible || this.items.length === 0) {
      return nothing;
    }

    return html`
      <div class="absolute left-0 right-0 mt-1 bg-bg-elevated border border-border/50 rounded-lg overflow-hidden shadow-lg z-50">
        <div class="max-h-48 sm:max-h-64 lg:max-h-80 overflow-y-auto">
          ${this.items.map(
            (item, index) => html`
              <button
                @click=${() => this.handleItemClick(item)}
                class="w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors duration-200 flex items-center gap-2 ${
                  index === this.selectedIndex ? 'bg-primary/20 border-l-2 border-primary' : ''
                }"
                type="button"
              >
                <svg 
                  width="12" 
                  height="12" 
                  viewBox="0 0 16 16" 
                  fill="currentColor"
                  class="${item.isRepository ? 'text-primary' : 'text-text-muted'} flex-shrink-0"
                >
                  ${
                    item.isRepository
                      ? html`<path d="M4.177 7.823A4.5 4.5 0 118 12.5a4.474 4.474 0 01-1.653-.316.75.75 0 11.557-1.392 2.999 2.999 0 001.096.208 3 3 0 10-2.108-5.134.75.75 0 01.236.662l.428 3.009a.75.75 0 01-1.255.592L2.847 7.677a.75.75 0 01.426-1.27A4.476 4.476 0 014.177 7.823zM8 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 018 1zm3.197 2.197a.75.75 0 01.092.992l-1 1.25a.75.75 0 01-1.17-.938l1-1.25a.75.75 0 01.992-.092.75.75 0 01.086.038zM5.75 8a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 015.75 8zm5.447 2.197a.75.75 0 01.092.992l-1 1.25a.75.75 0 11-1.17-.938l1-1.25a.75.75 0 01.992-.092.75.75 0 01.086.038z" />`
                      : item.type === 'directory'
                        ? html`<path d="M1.75 1h5.5c.966 0 1.75.784 1.75 1.75v1h4c.966 0 1.75.784 1.75 1.75v7.75A1.75 1.75 0 0113 15H3a1.75 1.75 0 01-1.75-1.75V2.75C1.25 1.784 1.784 1 1.75 1zM2.75 2.5v10.75c0 .138.112.25.25.25h10a.25.25 0 00.25-.25V5.5a.25.25 0 00-.25-.25H8.75v-2.5a.25.25 0 00-.25-.25h-5.5a.25.25 0 00-.25.25z" />`
                        : html`<path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0113.25 16h-9.5A1.75 1.75 0 012 14.25V1.75zm1.75-.25a.25.25 0 00-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 00.25-.25V6h-2.75A1.75 1.75 0 019 4.25V1.5H3.75zm6.75.062V4.25c0 .138.112.25.25.25h2.688a.252.252 0 00-.011-.013l-2.914-2.914a.272.272 0 00-.013-.011z" />`
                  }
                </svg>
                
                <!-- Folder name -->
                <span class="text-text text-xs sm:text-sm font-medium min-w-0">
                  ${item.name}
                </span>
                
                <!-- Git branch and worktree indicator -->
                ${
                  item.gitBranch
                    ? html`
                    <span class="text-primary text-[9px] sm:text-[10px] flex items-center gap-1">
                      <span>[${item.gitBranch}]</span>
                      ${
                        item.isWorktree
                          ? html`<span class="text-purple-500 ml-0.5" title="Git worktree">
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                              <path d="M5 3.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm0 2.122a2.25 2.25 0 10-1.5 0v.878A2.25 2.25 0 005.75 8.5h1.5v2.128a2.251 2.251 0 101.5 0V8.5h1.5a2.25 2.25 0 002.25-2.25v-.878a2.25 2.25 0 10-1.5 0v.878a.75.75 0 01-.75.75h-4.5A.75.75 0 015 6.25v-.878zm3.75 7.378a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm3-8.75a.75.75 0 100-1.5.75.75 0 000 1.5z"/>
                            </svg>
                          </span>`
                          : nothing
                      }
                    </span>`
                    : nothing
                }
                
                <!-- Git changes indicators -->
                ${
                  item.gitAddedCount || item.gitModifiedCount || item.gitDeletedCount
                    ? html`
                    <div class="flex items-center gap-1.5 text-[9px] sm:text-[10px]">
                      ${
                        item.gitAddedCount && item.gitAddedCount > 0
                          ? html`
                          <span class="flex items-center gap-0.5 text-green-500">
                            <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                            </svg>
                            <span>${item.gitAddedCount}</span>
                          </span>
                        `
                          : nothing
                      }
                      ${
                        item.gitModifiedCount && item.gitModifiedCount > 0
                          ? html`
                          <span class="flex items-center gap-0.5 text-yellow-500">
                            <svg class="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M21.731 2.269a2.625 2.625 0 00-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 000-3.712zM19.513 8.199l-3.712-3.712-8.4 8.4a5.25 5.25 0 00-1.32 2.214l-.8 2.685a.75.75 0 00.933.933l2.685-.8a5.25 5.25 0 002.214-1.32l8.4-8.4z" />
                            </svg>
                            <span>${item.gitModifiedCount}</span>
                          </span>
                        `
                          : nothing
                      }
                      ${
                        item.gitDeletedCount && item.gitDeletedCount > 0
                          ? html`
                          <span class="flex items-center gap-0.5 text-red-500">
                            <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                            </svg>
                            <span>${item.gitDeletedCount}</span>
                          </span>
                        `
                          : nothing
                      }
                    </div>
                  `
                    : nothing
                }
                
                <!-- Spacer -->
                <div class="flex-1"></div>
              </button>
            `
          )}
        </div>
      </div>
    `;
  }
}
