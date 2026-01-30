/**
 * VibeTunnel V3 Sidebar Component - Expanded Design
 *
 * A 240px wide vertical sidebar with:
 * - Logo row with close/collapse button
 * - NAVIGATION section: Sessions, Endpoints, Settings, SSH Keys
 * - QUICK ACTIONS section: New Session, Add Endpoint
 * - User row at bottom with logout
 */

import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

type NavView = 'sessions' | 'endpoints' | 'settings' | 'ssh-keys';

@customElement('vibetunnel-sidebar')
export class VibeTunnelSidebar extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: String }) activeView: NavView = 'sessions';
  @property({ type: String }) userInitial = 'A';
  @property({ type: String }) userName = 'Admin';
  @property({ type: Boolean }) expanded = true;

  private handleNavClick(view: NavView) {
    this.dispatchEvent(
      new CustomEvent('nav-change', {
        detail: { view },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleQuickAction(action: 'new-session' | 'add-endpoint') {
    this.dispatchEvent(
      new CustomEvent('quick-action', {
        detail: { action },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleLogout() {
    this.dispatchEvent(
      new CustomEvent('logout-click', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleToggleExpand() {
    this.expanded = !this.expanded;
    this.dispatchEvent(
      new CustomEvent('sidebar-toggle', {
        detail: { expanded: this.expanded },
        bubbles: true,
        composed: true,
      })
    );
  }

  private renderNavItem(
    view: NavView,
    label: string,
    icon: ReturnType<typeof html>,
    active: boolean
  ) {
    const activeStyle = active
      ? 'background: var(--color-primary-muted); border: 1px solid var(--color-primary-border);'
      : 'background: transparent; border: 1px solid transparent;';
    const iconColor = active ? 'var(--color-primary)' : '#737373';
    const textColor = active ? '#FFFFFF' : '#A3A3A3';

    return html`
      <button
        @click=${() => this.handleNavClick(view)}
        class="flex items-center gap-3 w-full h-11 px-3 rounded-[10px] transition-all cursor-pointer"
        style="${activeStyle}"
        title="${label}"
      >
        <span style="color: ${iconColor};">${icon}</span>
        <span
          class="font-ui text-[13px] font-medium"
          style="color: ${textColor};"
          >${label}</span
        >
      </button>
    `;
  }

  private renderQuickActionItem(
    action: 'new-session' | 'add-endpoint',
    label: string,
    icon: ReturnType<typeof html>
  ) {
    return html`
      <button
        @click=${() => this.handleQuickAction(action)}
        class="flex items-center gap-3 w-full h-11 px-3 rounded-[10px] transition-all cursor-pointer"
        style="background: rgba(255, 255, 255, 0.04); border: 1px solid transparent;"
        title="${label}"
      >
        <span style="color: #737373;">${icon}</span>
        <span class="font-ui text-[13px] font-medium" style="color: #A3A3A3;"
          >${label}</span
        >
      </button>
    `;
  }

  // Icons as methods for cleaner code
  private get sessionsIcon() {
    return html`<svg
      class="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      stroke-width="2"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="m4 17 2-2-2-2m4 4h4m-8 4h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z"
      />
    </svg>`;
  }

  private get endpointsIcon() {
    return html`<svg
      class="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      stroke-width="2"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7m0 0a3 3 0 0 1-3 3m0 3h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Zm-3 6h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Z"
      />
    </svg>`;
  }

  private get settingsIcon() {
    return html`<svg
      class="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      stroke-width="2"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
      />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
    </svg>`;
  }

  private get sshKeysIcon() {
    return html`<svg
      class="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      stroke-width="2"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
      />
    </svg>`;
  }

  private get newSessionIcon() {
    return html`<svg
      class="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      stroke-width="2"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M12 4.5v15m7.5-7.5h-15"
      />
    </svg>`;
  }

  private get addEndpointIcon() {
    return html`<svg
      class="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      stroke-width="2"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
      />
    </svg>`;
  }

  private get logoutIcon() {
    return html`<svg
      class="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      stroke-width="2"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15m-3 0-3-3m0 0 3-3m-3 3H15"
      />
    </svg>`;
  }

  render() {
    return html`
      <div
        class="vibetunnel-sidebar flex flex-col justify-between h-full"
        style="width: 240px; background: #030303; border-right: 1px solid rgba(255, 255, 255, 0.04); padding: 24px 16px;"
      >
        <!-- Top Section -->
        <div class="flex flex-col gap-6">
          <!-- Logo Row -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div
                class="flex items-center justify-center w-10 h-10 rounded-xl"
                style="background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%); box-shadow: 0 0 20px rgba(0, 210, 255, 0.5), 0 0 40px var(--color-primary-border), inset 0 1px 0 rgba(255, 255, 255, 0.2);"
              >
                <svg
                  class="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#050505"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="4 17 10 11 4 5"></polyline>
                  <line x1="12" y1="19" x2="20" y2="19"></line>
                </svg>
              </div>
              <span
                class="font-ui text-[15px] font-bold tracking-tight"
                style="color: #FFFFFF;"
                >VibeTunnel</span
              >
            </div>
            <button
              @click=${this.handleToggleExpand}
              class="flex items-center justify-center w-8 h-8 rounded-lg transition-all cursor-pointer"
              style="background: rgba(255, 255, 255, 0.04);"
              title="Collapse sidebar"
            >
              <svg
                class="w-4 h-4"
                style="color: #737373;"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M6 18 18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <!-- Navigation Section -->
          <div class="flex flex-col gap-1">
            <span
              class="font-ui text-[10px] font-semibold mb-2 px-3"
              style="color: #525252;"
              >NAVIGATION</span
            >
            ${this.renderNavItem(
              'sessions',
              'Sessions',
              this.sessionsIcon,
              this.activeView === 'sessions'
            )}
            ${this.renderNavItem(
              'endpoints',
              'Endpoints',
              this.endpointsIcon,
              this.activeView === 'endpoints'
            )}
            ${this.renderNavItem(
              'settings',
              'Settings',
              this.settingsIcon,
              this.activeView === 'settings'
            )}
            ${this.renderNavItem(
              'ssh-keys',
              'SSH Keys',
              this.sshKeysIcon,
              this.activeView === 'ssh-keys'
            )}
          </div>

          <!-- Divider -->
          <div
            style="height: 1px; background: rgba(255, 255, 255, 0.06);"
          ></div>

          <!-- Quick Actions Section -->
          <div class="flex flex-col gap-1">
            <span
              class="font-ui text-[10px] font-semibold mb-2 px-3"
              style="color: #525252;"
              >QUICK ACTIONS</span
            >
            ${this.renderQuickActionItem('new-session', 'New Session', this.newSessionIcon)}
            ${this.renderQuickActionItem('add-endpoint', 'Add Endpoint', this.addEndpointIcon)}
          </div>
        </div>

        <!-- Bottom Section: User -->
        <div class="flex flex-col gap-4">
          <!-- Divider -->
          <div
            style="height: 1px; background: rgba(255, 255, 255, 0.06);"
          ></div>

          <!-- User Row -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div
                class="flex items-center justify-center w-9 h-9 rounded-full font-ui text-[13px] font-medium"
                style="background: #1F1F1F; color: var(--color-primary); border: 1px solid var(--color-primary-border);"
              >
                ${this.userInitial}
              </div>
              <div class="flex flex-col">
                <span
                  class="font-ui text-[13px] font-medium"
                  style="color: #FFFFFF;"
                  >${this.userName}</span
                >
                <span class="font-ui text-[11px]" style="color: #525252;"
                  >Local user</span
                >
              </div>
            </div>
            <button
              @click=${this.handleLogout}
              class="flex items-center justify-center w-8 h-8 rounded-lg transition-all cursor-pointer"
              style="background: rgba(239, 68, 68, 0.1);"
              title="Logout"
            >
              <span style="color: #EF4444;">${this.logoutIcon}</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'vibetunnel-sidebar': VibeTunnelSidebar;
  }
}
