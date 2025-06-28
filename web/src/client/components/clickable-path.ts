/**
 * Clickable Path Component
 *
 * Displays a formatted path (with ~/ for home directory) that can be clicked to copy the full path.
 * Provides visual feedback with hover effects and a copy icon.
 *
 * @fires path-copied - When path is successfully copied (detail: { path: string })
 * @fires path-copy-failed - When path copy fails (detail: { path: string, error: string })
 */
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { createLogger } from '../utils/logger.js';
import { copyToClipboard } from '../utils/path-utils.js';
import './copy-icon.js';

const logger = createLogger('clickable-path');

@customElement('clickable-path')
export class ClickablePath extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: String }) path = '';
  @property({ type: String }) displayPath = '';
  @property({ type: String }) class = '';
  @property({ type: Number }) iconSize = 12;

  private async handleClick(e: Event) {
    e.stopPropagation();
    e.preventDefault();

    if (!this.path) return;

    try {
      const success = await copyToClipboard(this.path);
      if (success) {
        logger.log('Path copied to clipboard', { path: this.path });
        this.dispatchEvent(
          new CustomEvent('path-copied', {
            detail: { path: this.path },
            bubbles: true,
            composed: true,
          })
        );
      } else {
        throw new Error('Copy command failed');
      }
    } catch (error) {
      logger.error('Failed to copy path to clipboard', { error, path: this.path });
      this.dispatchEvent(
        new CustomEvent('path-copy-failed', {
          detail: {
            path: this.path,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  render() {
    if (!this.path) return html``;

    const displayText = this.displayPath || this.path;

    return html`
      <div
        class="truncate cursor-pointer hover:text-accent-green transition-colors inline-flex items-center gap-1 max-w-full ${
          this.class
        }"
        title="Click to copy path"
        @click=${this.handleClick}
      >
        <span class="truncate">${displayText}</span>
        <copy-icon size="${this.iconSize}" class="flex-shrink-0"></copy-icon>
      </div>
    `;
  }
}
