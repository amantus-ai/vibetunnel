/**
 * Terminal Search Component
 *
 * Provides search functionality for terminal with:
 * - Ctrl/Cmd+F to open
 * - Live search as you type
 * - Match count display
 * - Navigation through results
 * - Handles terminal reflow
 */
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

export interface SearchMatch {
  row: number;
  col: number;
  length: number;
  text: string;
}

@customElement('terminal-search')
export class TerminalSearch extends LitElement {
  static styles = css`
    :host {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 1000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .search-container {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(30, 30, 30, 0.95);
      border: 1px solid #444;
      border-radius: 4px;
      padding: 8px 12px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(10px);
    }

    .search-input {
      background: #1a1a1a;
      border: 1px solid #333;
      color: #e4e4e4;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 14px;
      width: 200px;
      outline: none;
    }

    .search-input:focus {
      border-color: #23d18b;
    }

    .search-info {
      color: #999;
      font-size: 12px;
      min-width: 80px;
      text-align: center;
    }

    .search-buttons {
      display: flex;
      gap: 4px;
    }

    button {
      background: #333;
      border: 1px solid #444;
      color: #e4e4e4;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      outline: none;
      transition: background 0.2s;
    }

    button:hover:not(:disabled) {
      background: #444;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .close-button {
      background: transparent;
      border: none;
      color: #999;
      font-size: 16px;
      padding: 0 4px;
    }

    .close-button:hover {
      color: #e4e4e4;
      background: transparent;
    }

    .no-matches {
      color: #ff6b6b;
    }

    .match-count {
      color: #23d18b;
    }
  `;

  @property({ type: Boolean }) visible = false;
  @state() private searchTerm = '';
  @state() private searchMatches: SearchMatch[] = [];
  @state() private currentMatchIndex = -1;
  @state() private isSearching = false;

  private searchTimeout?: number;

  render() {
    if (!this.visible) return html``;

    const hasMatches = this.searchMatches.length > 0;
    const currentMatch =
      this.currentMatchIndex >= 0 && this.currentMatchIndex < this.matches.length
        ? this.currentMatchIndex + 1
        : 0;

    return html`
      <div class="search-container">
        <input
          type="text"
          class="search-input"
          placeholder="Search..."
          .value=${this.searchTerm}
          @input=${this.handleInput}
          @keydown=${this.handleKeydown}
          autofocus
        />
        <div class="search-info">
          ${this.isSearching
            ? html`<span>Searching...</span>`
            : this.searchTerm && !hasMatches
              ? html`<span class="no-matches">No matches</span>`
              : this.searchTerm && hasMatches
                ? html`<span class="match-count"
                    >${currentMatch}/${this.searchMatches.length}</span
                  >`
                : html`<span>Type to search</span>`}
        </div>
        <div class="search-buttons">
          <button
            @click=${this.previousMatch}
            ?disabled=${!hasMatches}
            title="Previous match (Shift+Enter)"
          >
            ↑
          </button>
          <button @click=${this.nextMatch} ?disabled=${!hasMatches} title="Next match (Enter)">
            ↓
          </button>
        </div>
        <button class="close-button" @click=${this.close} title="Close (Esc)">✕</button>
      </div>
    `;
  }

  private handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.searchTerm = input.value;

    // Clear existing timeout
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }

    // Debounce search
    this.searchTimeout = window.setTimeout(() => {
      this.performSearch();
    }, 150);
  }

  private handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        this.previousMatch();
      } else {
        this.nextMatch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  private performSearch() {
    if (!this.searchTerm) {
      this.searchMatches = [];
      this.currentMatchIndex = -1;
      this.dispatchEvent(new CustomEvent('search-clear'));
      return;
    }

    this.isSearching = true;

    // Dispatch search event for terminal to handle
    this.dispatchEvent(
      new CustomEvent('search-perform', {
        detail: { term: this.searchTerm },
        bubbles: true,
      })
    );
  }

  private nextMatch() {
    if (this.searchMatches.length === 0) return;

    if (this.currentMatchIndex < this.searchMatches.length - 1) {
      this.currentMatchIndex++;
    } else {
      this.currentMatchIndex = 0; // Wrap around
    }

    this.navigateToCurrentMatch();
  }

  private previousMatch() {
    if (this.searchMatches.length === 0) return;

    if (this.currentMatchIndex > 0) {
      this.currentMatchIndex--;
    } else {
      this.currentMatchIndex = this.searchMatches.length - 1; // Wrap around
    }

    this.navigateToCurrentMatch();
  }

  private navigateToCurrentMatch() {
    if (this.currentMatchIndex >= 0 && this.currentMatchIndex < this.searchMatches.length) {
      const match = this.searchMatches[this.currentMatchIndex];
      this.dispatchEvent(
        new CustomEvent('search-navigate', {
          detail: { match, index: this.currentMatchIndex },
          bubbles: true,
        })
      );
    }
  }

  private close() {
    this.visible = false;
    this.searchTerm = '';
    this.searchMatches = [];
    this.currentMatchIndex = -1;
    this.dispatchEvent(new CustomEvent('search-close', { bubbles: true }));
  }

  // Public methods for terminal to call
  public updateMatches(matches: SearchMatch[]) {
    this.searchMatches = matches;
    this.isSearching = false;

    // If we have matches, select the first one
    if (matches.length > 0 && this.currentMatchIndex === -1) {
      this.currentMatchIndex = 0;
      this.navigateToCurrentMatch();
    } else if (matches.length === 0) {
      this.currentMatchIndex = -1;
    } else if (this.currentMatchIndex >= this.searchMatches.length) {
      // Handle case where matches reduced and current index is out of bounds
      this.currentMatchIndex = this.searchMatches.length - 1;
      this.navigateToCurrentMatch();
    }
  }

  public show() {
    this.visible = true;
    this.requestUpdate();

    // Focus input after render
    setTimeout(() => {
      const input = this.shadowRoot?.querySelector('.search-input') as HTMLInputElement;
      input?.focus();
      input?.select();
    }, 0);
  }

  public hide() {
    this.close();
  }
}
