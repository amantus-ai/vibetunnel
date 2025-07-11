import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('file-browser-fab')
export class FileBrowserFAB extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 100;
    }

    .fab {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: rgb(var(--color-primary));
      color: rgb(var(--color-text-bright));
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 8px rgb(var(--color-bg-base) / 0.3);
      transition: all 0.3s ease;
    }

    .fab:hover {
      background: rgb(var(--color-primary-hover));
      box-shadow: 0 6px 12px rgb(var(--color-bg-base) / 0.4);
      transform: translateY(-2px);
    }

    .fab:active {
      transform: translateY(0);
      box-shadow: 0 2px 4px rgb(var(--color-bg-base) / 0.3);
    }

    .icon {
      font-size: 24px;
    }

    .tooltip {
      position: absolute;
      bottom: 100%;
      right: 0;
      margin-bottom: 8px;
      background: rgb(var(--color-surface));
      color: rgb(var(--color-text));
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 12px;
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s;
    }

    .fab:hover + .tooltip {
      opacity: 1;
    }

    @media (max-width: 768px) {
      :host {
        bottom: 16px;
        right: 16px;
      }

      .fab {
        width: 48px;
        height: 48px;
      }

      .icon {
        font-size: 20px;
      }
    }
  `;

  @property({ type: Boolean }) visible = true;

  private handleClick() {
    this.dispatchEvent(new CustomEvent('open-file-browser'));
  }

  render() {
    if (!this.visible) {
      return html``;
    }

    return html`
      <button class="fab" @click=${this.handleClick} title="Browse Files (⌘O)">
        <svg
          class="icon"
          fill="currentColor"
          viewBox="0 0 20 20"
          style="width: 24px; height: 24px;"
        >
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
      </button>
      <div class="tooltip">Browse Files (⌘O)</div>
    `;
  }
}
