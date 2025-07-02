/**
 * Modal Wrapper Component
 *
 * A reusable modal component that properly separates backdrop and content
 * to avoid pointer-events conflicts. This ensures both manual and automated
 * interactions work correctly.
 *
 * @fires close - When the modal is closed via backdrop click or escape key
 */
import { html, LitElement } from 'lit';
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
    'modal-content modal-positioned font-mono text-sm w-full max-w-[calc(100vw-1rem)] sm:max-w-md lg:max-w-2xl';
  @property({ type: String }) transitionName = '';
  @property({ type: String }) ariaLabel = 'Modal dialog';
  @property({ type: Boolean }) closeOnBackdrop = true;
  @property({ type: Boolean }) closeOnEscape = true;

  connectedCallback() {
    super.connectedCallback();
    if (this.closeOnEscape) {
      document.addEventListener('keydown', this.handleKeyDown);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.handleKeyDown);
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
      <!-- Backdrop as separate element -->
      <div 
        class="modal-backdrop ${this.modalClass}"
        @click=${this.handleBackdropClick}
        data-testid="modal-backdrop"
        aria-hidden="true"
      ></div>
      
      <!-- Modal content as sibling, positioned independently -->
      <div
        class="${this.contentClass}"
        style="${contentStyle}"
        role="dialog"
        aria-modal="true"
        aria-label="${this.ariaLabel}"
        data-testid="modal-content"
      >
        <slot></slot>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'modal-wrapper': ModalWrapper;
  }
}
