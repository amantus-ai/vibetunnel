/**
 * VibeTunnel V3 Header Component
 *
 * Desktop header with:
 * - Title with active badge
 * - Search field
 * - New session button
 */

import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('vibetunnel-header')
export class VibeTunnelHeader extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: String }) title = 'Sessions';
  @property({ type: Number }) activeCount = 0;
  @property({ type: String }) searchQuery = '';

  private handleSearch(e: Event) {
    const input = e.target as HTMLInputElement;
    this.searchQuery = input.value;
    this.dispatchEvent(
      new CustomEvent('search', {
        detail: { query: this.searchQuery },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleNewClick() {
    this.dispatchEvent(
      new CustomEvent('create-session', {
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    return html`
      <div class="flex flex-col gap-3 w-full pb-2">
        <!-- Top row: Title and controls -->
        <div class="flex items-center justify-between">
          <!-- Left: Logo (mobile) + Title and Badge -->
          <div class="flex items-center gap-3 sm:gap-4">
            <!-- Logo icon - mobile only -->
            <div
              class="sm:hidden flex items-center justify-center w-9 h-9 rounded-[10px]"
              style="background: var(--color-primary); box-shadow: 0 0 10px rgba(0, 210, 255, 0.4);"
            >
              <svg
                class="w-[18px] h-[18px]"
                style="color: var(--color-bg);"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="m4 17 2-2-2-2m4 4h4m-8 4h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z"
                />
              </svg>
            </div>
            <h1
              class="text-lg sm:text-[32px] font-bold font-ui"
              style="color: var(--color-text);"
            >
              ${this.title}
            </h1>
            ${
              this.activeCount > 0
                ? html`
                  <div
                    class="flex items-center gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full font-ui text-[10px] sm:text-[11px] font-medium"
                    style="background: var(--color-primary-muted); border: 1px solid var(--color-primary-border); color: var(--color-primary);"
                  >
                    <div
                      class="w-1 sm:w-1.5 h-1 sm:h-1.5 rounded-full"
                      style="background: var(--color-primary);"
                    ></div>
                    ${this.activeCount}
                  </div>
                `
                : ''
            }
          </div>

          <!-- Right: Search (desktop) and New Button (desktop) -->
          <div class="hidden sm:flex items-center gap-3">
            <!-- Search -->
            <div
              class="flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] font-ui text-[13px] cursor-text"
              style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1);"
            >
              <svg
                class="w-4 h-4"
                style="color: #6B6B6B;"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                />
              </svg>
              <input
                type="text"
                placeholder="Search"
                .value=${this.searchQuery}
                @input=${this.handleSearch}
                class="bg-transparent border-none outline-none w-24 placeholder-[#6B6B6B]"
                style="color: var(--color-text);"
              />
              <span class="text-[11px]" style="color: #525252;">⌘K</span>
            </div>

            <!-- New Button -->
            <button
              @click=${this.handleNewClick}
              title="Create New Session (⌘K)"
              data-testid="create-session-button"
              class="flex items-center gap-2 px-4 py-2.5 rounded-[10px] font-ui text-[13px] font-medium transition-all cursor-pointer"
              style="background: var(--color-primary); color: var(--color-bg); box-shadow: 0 4px 16px var(--color-primary-border);"
            >
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="2"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New
            </button>
          </div>
        </div>

        <!-- Search bar - mobile only (full width) -->
        <div
          class="sm:hidden flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl font-ui text-sm"
          style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08);"
        >
          <svg
            class="w-[18px] h-[18px] flex-shrink-0"
            style="color: #525252;"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search sessions..."
            .value=${this.searchQuery}
            @input=${this.handleSearch}
            class="bg-transparent border-none outline-none flex-1 placeholder-[#525252]"
            style="color: var(--color-text);"
          />
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'vibetunnel-header': VibeTunnelHeader;
  }
}
