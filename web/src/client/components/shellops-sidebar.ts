/**
 * ShellOps V3 Sidebar Component
 *
 * A 72px wide vertical icon sidebar with:
 * - Logo at top
 * - Navigation icons (sessions, settings)
 * - User avatar at bottom
 */

import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('shellops-sidebar')
export class ShellOpsSidebar extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: String }) activeView: 'sessions' | 'settings' = 'sessions';
  @property({ type: String }) userInitial = 'A';

  private handleNavClick(view: 'sessions' | 'settings') {
    this.dispatchEvent(
      new CustomEvent('nav-change', {
        detail: { view },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleAvatarClick() {
    this.dispatchEvent(
      new CustomEvent('avatar-click', {
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    return html`
      <div
        class="shellops-sidebar flex flex-col items-center justify-between h-full py-6"
        style="width: 72px; background: var(--color-sidebar); border-right: 1px solid rgba(255, 255, 255, 0.04);"
      >
        <!-- Top Section: Logo + Nav -->
        <div class="flex flex-col items-center gap-8">
          <!-- Logo -->
          <div
            class="flex items-center justify-center w-10 h-10 rounded-[10px] font-mono text-sm font-semibold"
            style="background: var(--color-primary); color: var(--color-bg); box-shadow: 0 0 12px rgba(34, 197, 94, 0.4);"
          >
            &gt;_
          </div>

          <!-- Navigation Icons -->
          <div class="flex flex-col gap-2">
            <!-- Sessions Nav -->
            <button
              @click=${() => this.handleNavClick('sessions')}
              class="flex items-center justify-center w-11 h-11 rounded-xl transition-all cursor-pointer"
              style="${
                this.activeView === 'sessions'
                  ? 'background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.3);'
                  : 'background: rgba(255, 255, 255, 0.04); border: 1px solid transparent;'
              }"
              title="Sessions"
            >
              <svg
                class="w-5 h-5"
                style="color: ${this.activeView === 'sessions' ? 'var(--color-primary)' : '#737373'};"
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
              </svg>
            </button>

            <!-- Settings Nav -->
            <button
              @click=${() => this.handleNavClick('settings')}
              class="flex items-center justify-center w-11 h-11 rounded-xl transition-all cursor-pointer"
              style="${
                this.activeView === 'settings'
                  ? 'background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.3);'
                  : 'background: rgba(255, 255, 255, 0.04); border: 1px solid transparent;'
              }"
              title="Settings"
            >
              <svg
                class="w-5 h-5"
                style="color: ${this.activeView === 'settings' ? 'var(--color-primary)' : '#737373'};"
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
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Bottom Section: Avatar -->
        <div class="flex flex-col items-center gap-6">
          <button
            @click=${this.handleAvatarClick}
            class="flex items-center justify-center w-9 h-9 rounded-full font-mono text-[13px] font-medium transition-all cursor-pointer"
            style="background: #1F1F1F; color: var(--color-primary); border: 1px solid rgba(34, 197, 94, 0.3);"
            title="Account"
          >
            ${this.userInitial}
          </button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'shellops-sidebar': ShellOpsSidebar;
  }
}
