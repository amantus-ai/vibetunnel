import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { focusTrap, announceToScreenReader, KEYS, handleKeyboardNav } from '../../utils/accessibility';
import { buttonStyles, animationStyles } from './styles';
import './vt-button';

/**
 * Accessible modal component with focus trap and keyboard navigation
 */
@customElement('vt-modal')
export class VTModal extends LitElement {
  static override styles = [
    buttonStyles,
    animationStyles,
    css`
      :host {
        display: contents;
      }

      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        opacity: 0;
        visibility: hidden;
        transition: opacity var(--transition-base), visibility var(--transition-base);
      }

      .modal-overlay.open {
        opacity: 1;
        visibility: visible;
      }

      .modal {
        background: var(--bg-primary);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-xl);
        max-width: 600px;
        width: 90%;
        max-height: 90vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        transform: scale(0.9) translateY(20px);
        transition: transform var(--transition-base);
      }

      .modal-overlay.open .modal {
        transform: scale(1) translateY(0);
      }

      .modal-header {
        padding: 24px;
        border-bottom: 1px solid var(--border-primary);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .modal-title {
        font-size: 20px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
      }

      .modal-close {
        background: none;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        padding: 8px;
        border-radius: var(--radius-md);
        transition: all var(--transition-base);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .modal-close:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }

      .modal-close:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }

      .modal-body {
        padding: 24px;
        overflow-y: auto;
        flex: 1;
      }

      .modal-footer {
        padding: 24px;
        border-top: 1px solid var(--border-primary);
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }

      /* Reduced motion support */
      @media (prefers-reduced-motion: reduce) {
        .modal-overlay,
        .modal {
          transition: none;
        }
      }

      /* Mobile responsive */
      @media (max-width: 600px) {
        .modal {
          width: 100%;
          height: 100%;
          max-height: 100vh;
          border-radius: 0;
        }
      }
    `
  ];

  @property({ type: Boolean })
  open = false;

  @property({ type: String })
  title = '';

  @property({ type: Boolean })
  hideClose = false;

  @property({ type: Boolean })
  preventClose = false;

  @state()
  private _previousFocus: HTMLElement | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'dialog');
    this.setAttribute('aria-modal', 'true');
    
    if (this.title) {
      this.setAttribute('aria-label', this.title);
    }
  }

  override updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('open')) {
      if (this.open) {
        this._onOpen();
      } else {
        this._onClose();
      }
    }

    if (changedProperties.has('title') && this.title) {
      this.setAttribute('aria-label', this.title);
    }
  }

  private _onOpen() {
    // Store current focus
    this._previousFocus = document.activeElement as HTMLElement;
    
    // Announce to screen readers
    announceToScreenReader(`${this.title || 'Modal'} opened`);
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
    
    // Dispatch open event
    this.dispatchEvent(new CustomEvent('modal-open', {
      bubbles: true,
      composed: true
    }));
  }

  private _onClose() {
    // Restore body scroll
    document.body.style.overflow = '';
    
    // Restore focus
    if (this._previousFocus) {
      this._previousFocus.focus();
      this._previousFocus = null;
    }
    
    // Announce to screen readers
    announceToScreenReader(`${this.title || 'Modal'} closed`);
    
    // Dispatch close event
    this.dispatchEvent(new CustomEvent('modal-close', {
      bubbles: true,
      composed: true
    }));
  }

  private _handleOverlayClick(e: Event) {
    if (!this.preventClose && e.target === e.currentTarget) {
      this.close();
    }
  }

  private _handleKeyDown(e: KeyboardEvent) {
    handleKeyboardNav(e, {
      onEscape: () => {
        if (!this.preventClose) {
          this.close();
        }
      }
    });
  }

  close() {
    this.open = false;
  }

  override render() {
    const overlayClasses = {
      'modal-overlay': true,
      'open': this.open
    };

    return html`
      <div 
        class=${classMap(overlayClasses)}
        @click=${this._handleOverlayClick}
        @keydown=${this._handleKeyDown}
        aria-hidden=${!this.open}
      >
        <div 
          class="modal"
          ${focusTrap(this.open)}
          role="dialog"
          aria-labelledby="modal-title"
          aria-describedby="modal-body"
        >
          <div class="modal-header">
            <h2 id="modal-title" class="modal-title">${this.title}</h2>
            ${!this.hideClose ? html`
              <button
                class="modal-close"
                @click=${this.close}
                aria-label="Close modal"
                title="Close (Esc)"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </button>
            ` : ''}
          </div>
          
          <div id="modal-body" class="modal-body">
            <slot></slot>
          </div>
          
          <div class="modal-footer">
            <slot name="footer">
              <vt-button variant="ghost" @click=${this.close}>
                Cancel
              </vt-button>
              <vt-button @click=${this.close}>
                OK
              </vt-button>
            </slot>
          </div>
        </div>
      </div>
    `;
  }
}