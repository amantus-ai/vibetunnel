import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

/**
 * Inline Edit Component
 *
 * Provides inline editing functionality with a pencil icon that appears on hover.
 * Supports keyboard shortcuts (Enter to save, Esc to cancel).
 *
 * @fires save - When edit is saved (detail: { value: string })
 * @fires cancel - When edit is cancelled
 */
@customElement('inline-edit')
export class InlineEdit extends LitElement {
  static override styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      max-width: 100%;
    }

    .display-container {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      max-width: 100%;
      min-width: 0;
    }

    .display-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .edit-icon {
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.2s;
      flex-shrink: 0;
      width: 1em;
      height: 1em;
    }

    :host(:hover) .edit-icon {
      opacity: 0.5;
    }

    .edit-icon:hover {
      opacity: 1 !important;
    }

    .edit-container {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      width: 100%;
    }

    input {
      background: var(--dark-bg-tertiary, #1a1a1a);
      border: 1px solid var(--dark-border, #333);
      color: inherit;
      font: inherit;
      padding: 0.125rem 0.25rem;
      border-radius: 0.25rem;
      outline: none;
      width: 100%;
      min-width: 0;
    }

    input:focus {
      border-color: var(--accent-green, #10b981);
    }

    .action-buttons {
      display: flex;
      gap: 0.25rem;
      flex-shrink: 0;
    }

    button {
      background: none;
      border: none;
      cursor: pointer;
      padding: 0.125rem;
      border-radius: 0.25rem;
      color: var(--dark-text-muted, #999);
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 1.25rem;
      height: 1.25rem;
    }

    button:hover {
      background: var(--dark-bg-tertiary, #1a1a1a);
    }

    button.save {
      color: var(--accent-green, #10b981);
    }

    button.save:hover {
      background: var(--accent-green, #10b981);
      background-opacity: 0.2;
    }

    button.cancel {
      color: var(--status-error, #ef4444);
    }

    button.cancel:hover {
      background: var(--status-error, #ef4444);
      background-opacity: 0.2;
    }
  `;

  @property({ type: String })
  value = '';

  @property({ type: String })
  placeholder = '';

  @property({ attribute: false })
  onSave?: (value: string) => void;

  @state()
  private isEditing = false;

  @state()
  private editValue = '';

  private inputElement?: HTMLInputElement;

  override render() {
    if (this.isEditing) {
      return html`
        <div class="edit-container">
          <input
            type="text"
            .value=${this.editValue}
            @input=${this.handleInput}
            @keydown=${this.handleKeyDown}
            placeholder=${this.placeholder}
          />
          <div class="action-buttons">
            <button class="save" @click=${(e: Event) => {
              e.stopPropagation();
              this.handleSave();
            }} title="Save (Enter)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </button>
            <button class="cancel" @click=${(e: Event) => {
              e.stopPropagation();
              this.handleCancel();
            }} title="Cancel (Esc)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
      `;
    }

    return html`
      <div class="display-container">
        <span class="display-text" title=${this.value}>${this.value}</span>
        <svg
          class="edit-icon"
          @click=${(e: Event) => {
            e.stopPropagation();
            this.startEdit();
          }}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      </div>
    `;
  }

  override updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('isEditing') && this.isEditing) {
      // Focus input on next frame
      requestAnimationFrame(() => {
        this.inputElement = this.shadowRoot?.querySelector('input') as HTMLInputElement;
        if (this.inputElement) {
          this.inputElement.focus();
          this.inputElement.select();
        }
      });
    }
  }

  private startEdit() {
    this.editValue = this.value;
    this.isEditing = true;
  }

  private handleInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.editValue = input.value;
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.handleCancel();
    }
  }

  private handleSave() {
    const trimmedValue = this.editValue.trim();
    if (trimmedValue && trimmedValue !== this.value) {
      this.onSave?.(trimmedValue);
    }
    this.isEditing = false;
  }

  private handleCancel() {
    this.isEditing = false;
    this.editValue = '';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'inline-edit': InlineEdit;
  }
}
