/**
 * VibeTunnel V3 Filter Bar Component
 *
 * Filter bar with:
 * - Server filter chips
 * - Session count
 * - Clear filters button
 */

import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

export interface ServerFilter {
  id: string;
  name: string;
  color: string; // Dot color - green for active, amber for warning, etc.
}

@customElement('vibetunnel-filter-bar')
export class VibeTunnelFilterBar extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Array }) servers: ServerFilter[] = [];
  @property({ type: String }) selectedServer: string | null = null;
  @property({ type: Number }) totalSessions = 0;
  @property({ type: Number }) filteredSessions = 0;

  private handleFilterClick(serverId: string | null) {
    this.dispatchEvent(
      new CustomEvent('filter-change', {
        detail: { serverId },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleClearFilters() {
    this.dispatchEvent(
      new CustomEvent('filter-change', {
        detail: { serverId: null },
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    const showingCount = this.selectedServer ? this.filteredSessions : this.totalSessions;

    return html`
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 w-full">
        <!-- Filter Chips (horizontally scrollable on mobile) -->
        <div class="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 -mx-1 px-1 sm:mx-0 sm:px-0 scrollbar-hide">
          <!-- Filter Label - desktop only -->
          <div class="hidden sm:flex items-center gap-1.5 flex-shrink-0">
            <svg
              class="w-3.5 h-3.5"
              style="color: #525252;"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M21.75 17.25v-.228a4.5 4.5 0 0 0-.12-1.03l-2.268-9.64a3.375 3.375 0 0 0-3.285-2.602H7.923a3.375 3.375 0 0 0-3.285 2.602l-2.268 9.64a4.5 4.5 0 0 0-.12 1.03v.228m19.5 0a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3m19.5 0a3 3 0 0 0-3-3H5.25a3 3 0 0 0-3 3m16.5 0h.008v.008h-.008v-.008Zm-3 0h.008v.008h-.008v-.008Z"
              />
            </svg>
            <span class="font-ui text-xs font-medium" style="color: #525252;">
              Server:
            </span>
          </div>

          <!-- All Chip -->
          <button
            @click=${() => this.handleFilterClick(null)}
            class="flex-shrink-0 px-3 py-1.5 sm:py-1.5 rounded-lg sm:rounded-md font-ui text-xs sm:text-[11px] font-medium transition-all cursor-pointer"
            style="${
              this.selectedServer === null
                ? 'background: var(--color-primary-muted); border: 1px solid var(--color-primary-border); color: var(--color-primary);'
                : 'background: rgba(255, 255, 255, 0.04); border: 1px solid transparent; color: #737373;'
            }"
          >
            All
          </button>

          <!-- Server Chips -->
          ${this.servers.map(
            (server) => html`
              <button
                @click=${() => this.handleFilterClick(server.id)}
                class="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 sm:py-1.5 rounded-lg sm:rounded-md font-ui text-xs sm:text-[11px] font-medium transition-all cursor-pointer"
                style="${
                  this.selectedServer === server.id
                    ? 'background: var(--color-primary-muted); border: 1px solid var(--color-primary-border); color: var(--color-primary);'
                    : 'background: rgba(255, 255, 255, 0.04); border: 1px solid transparent; color: #737373;'
                }"
              >
                <div
                  class="w-1.5 h-1.5 rounded-full"
                  style="background: ${server.color};"
                ></div>
                ${server.name}
              </button>
            `
          )}
        </div>

        <!-- Count and Clear - hidden on mobile, shown on desktop -->
        <div class="hidden sm:flex items-center gap-2 flex-shrink-0">
          <span class="font-ui text-[11px]" style="color: #3B3B3B;">
            Showing ${showingCount} session${showingCount !== 1 ? 's' : ''}
          </span>
          ${
            this.selectedServer !== null
              ? html`
                <button
                  @click=${this.handleClearFilters}
                  class="flex items-center gap-1 px-2 py-1 rounded font-ui text-[11px] transition-all cursor-pointer hover:bg-white/5"
                  style="color: #525252;"
                >
                  <svg
                    class="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    stroke-width="2"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                  Clear
                </button>
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
    'vibetunnel-filter-bar': VibeTunnelFilterBar;
  }
}
