/**
 * Quick Keys Settings Section
 *
 * Self-contained component for the quick keys customization UI in settings.
 * Encapsulates the Edit button, modal state, and editor rendering.
 *
 * This file is fork-only (zero conflict risk with upstream).
 */

import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './quick-keys-editor.js';

@customElement('quick-keys-settings-section')
export class QuickKeysSettingsSection extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @state() private showEditor = false;

  render() {
    return html`
      <div class="p-4 bg-bg-tertiary rounded-lg border border-border/50">
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <label class="text-primary font-medium">Customize Quick Keys</label>
            <p class="text-muted text-xs mt-1">
              Reorder or hide keyboard shortcuts
            </p>
          </div>
          <button
            class="btn-secondary text-xs px-3 py-1.5"
            @click=${() => {
              this.showEditor = true;
            }}
          >
            Edit
          </button>
        </div>
      </div>

      <quick-keys-editor
        .isOpen=${this.showEditor}
        @close=${() => {
          this.showEditor = false;
        }}
      ></quick-keys-editor>
    `;
  }
}
