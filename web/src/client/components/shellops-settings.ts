/**
 * VibeTunnel V3 Settings Component
 *
 * Full-page settings with left navigation panel.
 * Sections: Endpoints, General, Appearance, SSH Keys
 */

import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

export type SettingsSection = 'endpoints' | 'general' | 'appearance' | 'ssh-keys';

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'endpoints', label: 'Endpoints', icon: 'server' },
  { id: 'general', label: 'General', icon: 'sliders' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'ssh-keys', label: 'SSH Keys', icon: 'key' },
];

@customElement('vibetunnel-settings')
export class VibeTunnelSettings extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: String }) activeSection: SettingsSection = 'endpoints';
  @state() private isMobile = false;

  connectedCallback() {
    super.connectedCallback();
    this.checkMobile();
    window.addEventListener('resize', this.handleResize);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.handleResize);
  }

  private handleResize = () => {
    this.checkMobile();
  };

  private checkMobile() {
    this.isMobile = window.innerWidth < 768;
  }

  private handleNavClick(section: SettingsSection) {
    this.activeSection = section;
    this.dispatchEvent(
      new CustomEvent('section-change', {
        detail: { section },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleBack() {
    this.dispatchEvent(
      new CustomEvent('back', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private renderIcon(icon: string, isActive: boolean) {
    const color = isActive ? 'var(--color-primary)' : '#525252';

    switch (icon) {
      case 'server':
        return html`
          <svg class="w-[18px] h-[18px]" style="color: ${color};" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21.75 17.25v-.228a4.5 4.5 0 0 0-.12-1.03l-2.268-9.64a3.375 3.375 0 0 0-3.285-2.602H7.923a3.375 3.375 0 0 0-3.285 2.602l-2.268 9.64a4.5 4.5 0 0 0-.12 1.03v.228m19.5 0a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3m19.5 0a3 3 0 0 0-3-3H5.25a3 3 0 0 0-3 3m16.5 0h.008v.008h-.008v-.008Zm-3 0h.008v.008h-.008v-.008Z" />
          </svg>
        `;
      case 'sliders':
        return html`
          <svg class="w-[18px] h-[18px]" style="color: ${color};" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
          </svg>
        `;
      case 'palette':
        return html`
          <svg class="w-[18px] h-[18px]" style="color: ${color};" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4.098 19.902a3.75 3.75 0 0 0 5.304 0l6.401-6.402M6.75 21A3.75 3.75 0 0 1 3 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 0 0 3.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008Z" />
          </svg>
        `;
      case 'key':
        return html`
          <svg class="w-[18px] h-[18px]" style="color: ${color};" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
          </svg>
        `;
      default:
        return null;
    }
  }

  private renderNavItem(item: NavItem) {
    const isActive = this.activeSection === item.id;

    return html`
      <button
        @click=${() => this.handleNavClick(item.id)}
        class="flex items-center gap-3 w-full px-3.5 py-3 rounded-lg font-ui text-[13px] font-medium transition-all cursor-pointer"
        style="${
          isActive
            ? 'background: var(--color-primary-surface); border: 1px solid var(--color-primary-border); color: var(--color-primary);'
            : 'background: transparent; border: 1px solid transparent; color: #737373;'
        }"
      >
        ${this.renderIcon(item.icon, isActive)}
        ${item.label}
      </button>
    `;
  }

  private renderSectionContent() {
    switch (this.activeSection) {
      case 'endpoints':
        return this.renderEndpointsSection();
      case 'general':
        return this.renderGeneralSection();
      case 'appearance':
        return this.renderAppearanceSection();
      case 'ssh-keys':
        return this.renderSSHKeysSection();
      default:
        return html``;
    }
  }

  private renderEndpointsSection() {
    return html`
      <div class="space-y-8">
        <div>
          <h2 class="text-xl font-bold font-ui mb-2" style="color: var(--color-text);">Endpoints</h2>
          <p class="text-sm font-ui" style="color: #737373;">Manage your SSH endpoints and connections.</p>
        </div>

        <!-- Endpoint List Placeholder -->
        <div class="space-y-4">
          <div
            class="p-4 rounded-xl"
            style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);"
          >
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-3">
                <div class="w-2.5 h-2.5 rounded-full" style="background: var(--color-primary); box-shadow: 0 0 8px rgba(0, 210, 255, 0.6);"></div>
                <span class="font-ui text-sm font-medium" style="color: var(--color-text);">Local Machine</span>
              </div>
              <span class="font-ui text-xs px-2 py-1 rounded" style="background: var(--color-primary-surface); color: var(--color-primary);">Connected</span>
            </div>
            <p class="font-ui text-xs" style="color: #737373;">localhost</p>
          </div>

          <!-- Add Endpoint Button -->
          <button
            class="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-ui text-sm font-medium transition-all"
            style="background: rgba(255,255,255,0.04); border: 1px dashed rgba(255,255,255,0.1); color: #737373;"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Endpoint
          </button>
        </div>
      </div>
    `;
  }

  private renderGeneralSection() {
    return html`
      <div class="space-y-8">
        <div>
          <h2 class="text-xl font-bold font-ui mb-2" style="color: var(--color-text);">General</h2>
          <p class="text-sm font-ui" style="color: #737373;">Configure general application settings.</p>
        </div>

        <!-- Session Defaults -->
        <div class="space-y-4">
          <h3 class="text-xs font-semibold font-ui uppercase tracking-wider" style="color: #A3A3A3;">Session Defaults</h3>
          <div
            class="p-4 rounded-xl space-y-4"
            style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);"
          >
            <div class="flex items-center justify-between">
              <div>
                <label class="font-ui text-sm" style="color: var(--color-text);">Default Shell</label>
                <p class="font-ui text-xs mt-0.5" style="color: #525252;">Shell used for new sessions</p>
              </div>
              <select
                class="px-3 py-2 rounded-lg font-ui text-sm"
                style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: var(--color-text);"
              >
                <option value="zsh">zsh</option>
                <option value="bash">bash</option>
                <option value="fish">fish</option>
              </select>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <label class="font-ui text-sm" style="color: var(--color-text);">Working Directory</label>
                <p class="font-ui text-xs mt-0.5" style="color: #525252;">Default directory for new sessions</p>
              </div>
              <input
                type="text"
                value="~"
                class="px-3 py-2 rounded-lg font-ui text-sm w-32"
                style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: var(--color-text);"
              />
            </div>
          </div>
        </div>

        <!-- Connection -->
        <div class="space-y-4">
          <h3 class="text-xs font-semibold font-ui uppercase tracking-wider" style="color: #A3A3A3;">Connection</h3>
          <div
            class="p-4 rounded-xl space-y-4"
            style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);"
          >
            <div class="flex items-center justify-between">
              <div>
                <label class="font-ui text-sm" style="color: var(--color-text);">Auto-reconnect</label>
                <p class="font-ui text-xs mt-0.5" style="color: #525252;">Automatically reconnect on disconnect</p>
              </div>
              ${this.renderToggle(true)}
            </div>

            <div class="flex items-center justify-between">
              <div>
                <label class="font-ui text-sm" style="color: var(--color-text);">Connection Timeout</label>
                <p class="font-ui text-xs mt-0.5" style="color: #525252;">Timeout in seconds</p>
              </div>
              <input
                type="number"
                value="30"
                class="px-3 py-2 rounded-lg font-ui text-sm w-20 text-center"
                style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: var(--color-text);"
              />
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderAppearanceSection() {
    return html`
      <div class="space-y-8">
        <div>
          <h2 class="text-xl font-bold font-ui mb-2" style="color: var(--color-text);">Appearance</h2>
          <p class="text-sm font-ui" style="color: #737373;">Customize the look and feel of VibeTunnel.</p>
        </div>

        <!-- Theme -->
        <div class="space-y-4">
          <h3 class="text-xs font-semibold font-ui uppercase tracking-wider" style="color: #A3A3A3;">Theme</h3>
          <div class="flex gap-3">
            ${this.renderThemeCard('dark', 'Dark', true)}
            ${this.renderThemeCard('light', 'Light', false)}
            ${this.renderThemeCard('system', 'System', false)}
          </div>
        </div>

        <!-- Font Settings -->
        <div class="space-y-4">
          <h3 class="text-xs font-semibold font-ui uppercase tracking-wider" style="color: #A3A3A3;">Font Settings</h3>
          <div
            class="p-4 rounded-xl space-y-4"
            style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);"
          >
            <div class="flex items-center justify-between">
              <div>
                <label class="font-ui text-sm" style="color: var(--color-text);">Font Size</label>
                <p class="font-ui text-xs mt-0.5" style="color: #525252;">Terminal font size</p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  class="w-8 h-8 rounded-lg flex items-center justify-center"
                  style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: #737373;"
                >-</button>
                <span class="font-ui text-sm w-8 text-center" style="color: var(--color-text);">14</span>
                <button
                  class="w-8 h-8 rounded-lg flex items-center justify-center"
                  style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: #737373;"
                >+</button>
              </div>
            </div>

            <div class="flex items-center justify-between">
              <div>
                <label class="font-ui text-sm" style="color: var(--color-text);">Font Family</label>
                <p class="font-ui text-xs mt-0.5" style="color: #525252;">Terminal font family</p>
              </div>
              <select
                class="px-3 py-2 rounded-lg font-ui text-sm"
                style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: var(--color-text);"
              >
                <option value="jetbrains-mono">JetBrains Mono</option>
                <option value="fira-code">Fira Code</option>
                <option value="sf-mono">SF Mono</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderSSHKeysSection() {
    return html`
      <div class="space-y-8">
        <div>
          <h2 class="text-xl font-bold font-ui mb-2" style="color: var(--color-text);">SSH Keys</h2>
          <p class="text-sm font-ui" style="color: #737373;">Manage your SSH keys for authentication.</p>
        </div>

        <!-- Key List -->
        <div class="space-y-4">
          <div
            class="p-4 rounded-xl"
            style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);"
          >
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-3">
                <svg class="w-5 h-5" style="color: #737373;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
                </svg>
                <span class="font-ui text-sm font-medium" style="color: var(--color-text);">id_ed25519</span>
              </div>
              <button class="font-ui text-xs" style="color: #EF4444;">Remove</button>
            </div>
            <div class="space-y-1">
              <p class="font-ui text-xs" style="color: #525252;">SHA256:abc123...xyz789</p>
              <p class="font-ui text-xs" style="color: #525252;">Added: Jan 15, 2026</p>
            </div>
          </div>

          <!-- Add Key Button -->
          <button
            class="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-ui text-sm font-medium transition-all"
            style="background: rgba(255,255,255,0.04); border: 1px dashed rgba(255,255,255,0.1); color: #737373;"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add SSH Key
          </button>
        </div>
      </div>
    `;
  }

  private renderToggle(checked: boolean) {
    return html`
      <button
        role="switch"
        aria-checked="${checked}"
        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
        style="background: ${checked ? 'var(--color-primary)' : 'rgba(255,255,255,0.1)'};"
      >
        <span
          class="inline-block h-5 w-5 transform rounded-full transition-transform"
          style="background: ${checked ? 'var(--color-bg)' : '#525252'}; transform: translateX(${checked ? '22px' : '2px'});"
        ></span>
      </button>
    `;
  }

  private renderThemeCard(id: string, label: string, isActive: boolean) {
    return html`
      <button
        class="flex-1 p-4 rounded-xl text-center transition-all"
        style="${
          isActive
            ? 'background: var(--color-primary-surface); border: 1px solid var(--color-primary-border);'
            : 'background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);'
        }"
      >
        <div
          class="w-12 h-8 mx-auto mb-2 rounded"
          style="background: ${id === 'dark' ? '#0A0A0A' : id === 'light' ? '#F5F5F5' : 'linear-gradient(135deg, #0A0A0A 50%, #F5F5F5 50%)'}; border: 1px solid rgba(255,255,255,0.1);"
        ></div>
        <span class="font-ui text-xs" style="color: ${isActive ? 'var(--color-primary)' : '#737373'};">${label}</span>
      </button>
    `;
  }

  render() {
    return html`
      <div class="flex h-full font-ui" style="background: var(--color-bg-secondary);">
        <!-- Left Navigation (Desktop) -->
        <div
          class="hidden md:flex flex-col w-60 h-full"
          style="background: #0A0A0A; border-right: 1px solid rgba(255,255,255,0.04);"
        >
          <div class="p-8">
            <h1 class="text-xl font-semibold" style="color: var(--color-text);">Settings</h1>
          </div>
          <nav class="flex-1 px-5 space-y-1">
            ${NAV_ITEMS.map((item) => this.renderNavItem(item))}
          </nav>
        </div>

        <!-- Mobile Header -->
        <div class="md:hidden fixed top-0 left-0 right-0 z-50" style="background: var(--color-bg-secondary); border-bottom: 1px solid rgba(255,255,255,0.06);">
          <div class="flex items-center gap-3 p-4" style="padding-top: max(16px, env(safe-area-inset-top));">
            <button
              @click=${this.handleBack}
              class="flex items-center justify-center w-9 h-9 rounded-lg"
              style="background: rgba(255,255,255,0.06);"
            >
              <svg class="w-[18px] h-[18px]" style="color: var(--color-text);" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
            </button>
            <h1 class="text-lg font-bold" style="color: var(--color-text);">
              ${NAV_ITEMS.find((i) => i.id === this.activeSection)?.label || 'Settings'}
            </h1>
          </div>
        </div>

        <!-- Content Area -->
        <div class="flex-1 overflow-y-auto" style="padding-top: ${this.isMobile ? '72px' : '0'};">
          <div class="max-w-2xl mx-auto p-8">
            ${this.renderSectionContent()}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'vibetunnel-settings': VibeTunnelSettings;
  }
}
