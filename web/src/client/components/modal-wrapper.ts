/**
 * Modal Wrapper Component
 *
 * A reusable modal component that properly separates backdrop and content
 * to avoid pointer-events conflicts. This ensures both manual and automated
 * interactions work correctly.
 *
 * @fires close - When the modal is closed via backdrop click or escape key
 */
import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('modal-wrapper')
export class ModalWrapper extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Boolean }) visible = false;
  @property({ type: String }) modalClass = '';
  @property({ type: String }) contentClass =
    'modal-content font-mono text-sm w-full max-w-[calc(100vw-1rem)] sm:max-w-md lg:max-w-2xl';
  @property({ type: String }) transitionName = '';
  @property({ type: String }) ariaLabel = 'Modal dialog';
  @property({ type: Boolean }) closeOnBackdrop = true;
  @property({ type: Boolean }) closeOnEscape = true;

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Remove the keydown listener if it was added
    document.removeEventListener('keydown', this.handleKeyDown);
  }

  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);

    // Manage escape key listener
    if (changedProperties.has('visible') || changedProperties.has('closeOnEscape')) {
      if (this.visible && this.closeOnEscape) {
        document.addEventListener('keydown', this.handleKeyDown);
      } else {
        document.removeEventListener('keydown', this.handleKeyDown);
      }
    }

    // Focus management - but not if we have a special attribute to prevent it
    if (changedProperties.has('visible') && this.visible && !this.hasAttribute('no-autofocus')) {
      requestAnimationFrame(() => {
        const focusable = this.querySelector(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        (focusable as HTMLElement)?.focus();
      });
    }
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (this.visible && e.key === 'Escape' && this.closeOnEscape) {
      e.preventDefault();
      e.stopPropagation();
      this.handleClose();
    }
  };

  private handleBackdropClick(e: Event) {
    // Only close if clicking the backdrop itself, not the modal content
    if (this.closeOnBackdrop && e.target === e.currentTarget) {
      e.preventDefault();
      e.stopPropagation();
      this.handleClose();
    }
  }

  private handleClose() {
    this.dispatchEvent(new CustomEvent('close'));
  }

  render() {
    if (!this.visible) {
      return html``;
    }

    const contentStyle = this.transitionName ? `view-transition-name: ${this.transitionName}` : '';

    return html`
      <!-- Modal container with backdrop and centered content -->
      <div 
        class="modal-backdrop flex items-center justify-center p-2 sm:p-4 ${this.modalClass}"
        @click=${this.handleBackdropClick}
        data-testid="modal-backdrop"
      >
        <!-- Modal content centered within backdrop -->
        <div
          class="${this.contentClass}"
          style="${contentStyle}"
          role="dialog"
          aria-modal="true"
          aria-label="${this.ariaLabel}"
          data-testid="modal-content"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <slot></slot>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'modal-wrapper': ModalWrapper;
  }
}
