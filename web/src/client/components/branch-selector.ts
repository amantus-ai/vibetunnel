import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('branch-selector');

/**
 * Branch selector dropdown component
 * Shows current branch and allows switching between branches
 */
@customElement('branch-selector')
export class BranchSelector extends LitElement {
  static override styles = css`
    :host {
      display: inline-block;
      position: relative;
    }

    .trigger {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background: var(--color-surface-2);
      border: 1px solid var(--color-border);
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      transition: all 0.2s;
    }

    .trigger:hover {
      background: var(--color-surface-3);
      border-color: var(--color-border-hover);
    }

    .trigger.open {
      background: var(--color-surface-3);
      border-color: var(--color-primary);
    }

    .branch-icon {
      width: 12px;
      height: 12px;
      opacity: 0.7;
    }

    .chevron {
      width: 8px;
      height: 8px;
      transition: transform 0.2s;
    }

    .chevron.open {
      transform: rotate(180deg);
    }

    .dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 4px;
      min-width: 200px;
      max-width: 300px;
      max-height: 250px;
      background: var(--color-surface-1);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      overflow: hidden;
      z-index: 1000;
      opacity: 0;
      transform: translateY(-4px);
      pointer-events: none;
      transition: all 0.2s;
    }

    .dropdown.open {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }

    .dropdown-content {
      max-height: 250px;
      overflow-y: auto;
    }

    .loading {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px;
      font-size: 11px;
      color: var(--color-text-muted);
    }

    .spinner {
      width: 12px;
      height: 12px;
      border: 2px solid var(--color-border);
      border-top-color: var(--color-primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .branch-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      font-size: 11px;
      cursor: pointer;
      transition: background 0.2s;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
    }

    .branch-item:hover {
      background: var(--color-surface-2);
    }

    .branch-item.current {
      background: var(--color-primary-bg);
      color: var(--color-primary);
    }

    .checkmark {
      width: 12px;
      height: 12px;
      flex-shrink: 0;
    }

    .checkmark.placeholder {
      opacity: 0;
    }

    .error {
      padding: 12px;
      font-size: 11px;
      color: var(--color-status-error);
    }
  `;

  @property({ type: String })
  repoPath = '';

  @property({ type: String })
  currentBranch = '';

  @property({ type: Function })
  onSelectBranch?: (branch: string) => void;

  @state()
  private isOpen = false;

  @state()
  private branches: string[] = [];

  @state()
  private loading = false;

  @state()
  private error = '';

  override render() {
    return html`
      <div class="trigger ${this.isOpen ? 'open' : ''}" @click=${this.toggleDropdown}>
        <svg class="branch-icon" viewBox="0 0 16 16" fill="currentColor">
          <path d="M5 3.25a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm0 9.5a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm8.75-2.25a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/>
          <path d="M5.75 3v2.5a.75.75 0 01-1.5 0V3a.75.75 0 011.5 0zm0 7.5v2.5a.75.75 0 01-1.5 0v-2.5a.75.75 0 011.5 0zm7.25-7v7a.75.75 0 01-1.5 0v-7a.75.75 0 011.5 0z"/>
        </svg>
        <span>${this.currentBranch || 'Select branch'}</span>
        <svg class="chevron ${this.isOpen ? 'open' : ''}" viewBox="0 0 8 8" fill="currentColor">
          <path d="M4 5L1 2h6L4 5z"/>
        </svg>
      </div>

      <div class="dropdown ${this.isOpen ? 'open' : ''}">
        <div class="dropdown-content">
          ${
            this.loading
              ? html`
            <div class="loading">
              <div class="spinner"></div>
              <span>Loading branches...</span>
            </div>
          `
              : this.error
                ? html`
            <div class="error">${this.error}</div>
          `
                : this.branches.map(
                    (branch) => html`
            <button
              class="branch-item ${branch === this.currentBranch ? 'current' : ''}"
              @click=${() => this.selectBranch(branch)}
            >
              ${
                branch === this.currentBranch
                  ? html`
                <svg class="checkmark" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                </svg>
              `
                  : html`
                <div class="checkmark placeholder"></div>
              `
              }
              <span>${branch}</span>
            </button>
          `
                  )
          }
        </div>
      </div>
    `;
  }

  private async toggleDropdown() {
    this.isOpen = !this.isOpen;

    if (this.isOpen && this.branches.length === 0) {
      await this.loadBranches();
    }
  }

  private async loadBranches() {
    this.loading = true;
    this.error = '';

    try {
      // TODO: Implement API call to fetch branches
      // For now, mock some branches
      await new Promise((resolve) => setTimeout(resolve, 500));
      this.branches = ['main', 'develop', 'feature/git-status', 'bugfix/terminal-output'];
    } catch (error) {
      logger.error('Failed to load branches:', error);
      this.error = 'Failed to load branches';
    } finally {
      this.loading = false;
    }
  }

  private selectBranch(branch: string) {
    if (branch !== this.currentBranch) {
      this.onSelectBranch?.(branch);
    }
    this.isOpen = false;
  }

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this.handleOutsideClick);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this.handleOutsideClick);
  }

  private handleOutsideClick = (e: MouseEvent) => {
    if (!this.contains(e.target as Node)) {
      this.isOpen = false;
    }
  };
}
