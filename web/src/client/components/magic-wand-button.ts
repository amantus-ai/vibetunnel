/**
 * Magic Wand Button Component
 *
 * Reusable button for sending prompts to AI assistant sessions
 * to encourage them to update their terminal titles.
 */
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { AuthClient } from '../services/auth-client.js';
import { sendAIPrompt } from '../utils/ai-sessions.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('magic-wand-button');

@customElement('magic-wand-button')
export class MagicWandButton extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: String }) sessionId!: string;
  @property({ type: Object }) authClient!: AuthClient;
  @property({ type: String }) size: 'small' | 'medium' = 'small';
  @property({ type: Boolean }) showText = false;

  @state() private sending = false;

  private async handleClick(e: Event) {
    e.stopPropagation();
    e.preventDefault();

    if (this.sending) return;

    this.sending = true;

    try {
      await sendAIPrompt(this.sessionId, this.authClient);

      // Dispatch success event
      this.dispatchEvent(
        new CustomEvent('prompt-sent', {
          detail: { sessionId: this.sessionId },
          bubbles: true,
          composed: true,
        })
      );
    } catch (error) {
      logger.error('Failed to send AI prompt', error);

      // Dispatch error event
      this.dispatchEvent(
        new CustomEvent('prompt-error', {
          detail: {
            sessionId: this.sessionId,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          bubbles: true,
          composed: true,
        })
      );
    } finally {
      this.sending = false;
    }
  }

  render() {
    const sizeClasses = {
      small: 'w-4 h-4',
      medium: 'w-5 h-5',
    };

    const buttonClasses = this.size === 'small' ? 'p-1.5' : 'p-1';

    return html`
      <button
        class="btn-ghost text-primary ${buttonClasses} rounded-md transition-all hover:bg-elevated hover:shadow-sm hover:scale-110 disabled:opacity-50"
        @click=${this.handleClick}
        ?disabled=${this.sending}
        title="Send prompt to update terminal title"
      >
        ${
          this.sending
            ? html`
            <svg
              class="${sizeClasses[this.size]} animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              ></circle>
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          `
            : html`
            <svg
              class="${sizeClasses[this.size]}"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M12 8l-2 2m4-2l-2 2m4 0l-2 2"
                opacity="0.6"
              />
            </svg>
          `
        }
        ${this.showText ? html`<span class="ml-2">Update Title</span>` : ''}
      </button>
    `;
  }
}
