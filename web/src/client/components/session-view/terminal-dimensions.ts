/**
 * Terminal Dimensions Component
 *
 * Displays terminal dimensions (cols x rows) in a non-reactive way
 * to prevent unnecessary re-renders during terminal resizes.
 */
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('terminal-dimensions')
export class TerminalDimensions extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Number }) cols = 0;
  @property({ type: Number }) rows = 0;

  // Override shouldUpdate to prevent re-renders during rapid dimension changes
  // Only update if dimensions actually changed
  shouldUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has('cols') || changedProperties.has('rows')) {
      const colsChanged =
        changedProperties.has('cols') && changedProperties.get('cols') !== this.cols;
      const rowsChanged =
        changedProperties.has('rows') && changedProperties.get('rows') !== this.rows;
      return colsChanged || rowsChanged;
    }
    return true;
  }

  render() {
    if (this.cols === 0 || this.rows === 0) {
      return null;
    }

    return html`
      <span
        class="hidden sm:inline text-dark-text-muted text-xs opacity-60"
        style="font-size: 10px; line-height: 1;"
      >
        ${this.cols}×${this.rows}
      </span>
    `;
  }
}
