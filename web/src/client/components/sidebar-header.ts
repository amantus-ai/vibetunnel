/**
 * Sidebar Header Component
 *
 * Compact header for sidebar/split view with vertical layout
 */
import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { HeaderBase } from './header-base.js';
import './terminal-icon.js';
import './notification-status.js';

@customElement('sidebar-header')
export class SidebarHeader extends HeaderBase {
  render() {
    const runningSessions = this.runningSessions;

    return html`
      <div
        class="app-header sidebar-header bg-bg-secondary px-4 py-2"
        style="padding-top: max(0.625rem, env(safe-area-inset-top));"
      >
        <!-- Compact layout for sidebar -->
        <div class="flex items-center gap-2">
          <!-- Toggle button -->
          <button
            class="p-2 text-primary bg-bg-tertiary border border-border hover:bg-surface-hover hover:border-primary rounded-md transition-all duration-200 flex-shrink-0"
            @click=${() => this.dispatchEvent(new CustomEvent('toggle-sidebar'))}
            title="Collapse sidebar (⌘B)"
            aria-label="Collapse sidebar"
            aria-expanded="true"
            aria-controls="sidebar"
            data-button-id="toggle-sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"/>
            </svg>
          </button>
          
          <!-- Go to Root button -->
          <button
            class="p-2 text-primary bg-bg-tertiary border border-border hover:bg-surface-hover hover:border-primary rounded-md transition-all duration-200 flex-shrink-0"
            @click=${() => {
              window.location.href = '/';
            }}
            title="Go to root"
            data-testid="go-to-root-button-sidebar"
            data-button-id="go-to-root"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <!-- Four small rounded rectangles icon -->
              <rect x="3" y="3" width="6" height="6" rx="1.5" ry="1.5"/>
              <rect x="11" y="3" width="6" height="6" rx="1.5" ry="1.5"/>
              <rect x="3" y="11" width="6" height="6" rx="1.5" ry="1.5"/>
              <rect x="11" y="11" width="6" height="6" rx="1.5" ry="1.5"/>
            </svg>
          </button>
          
          <!-- Title and logo with flex-grow for centering -->
          <button
            class="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer group flex-grow"
            title="Go to home"
            @click=${this.handleHomeClick}
          >
            <terminal-icon size="20"></terminal-icon>
            <div class="min-w-0">
              <h1
                class="text-sm font-bold text-primary font-mono group-hover:underline truncate"
              >
                VibeTunnel
              </h1>
              <p class="text-text-muted text-xs font-mono">
                ${runningSessions.length} ${runningSessions.length === 1 ? 'session' : 'sessions'}
              </p>
            </div>
          </button>
          
          <!-- Action buttons group with consistent styling -->
          <div class="flex items-center gap-2 flex-shrink-0">
            <!-- tmux Sessions button -->
            <button
              class="p-2 text-primary bg-bg-tertiary border border-border hover:bg-surface-hover hover:border-primary rounded-md transition-all duration-200 flex-shrink-0"
              @click=${this.handleOpenTmuxSessions}
              title="tmux Sessions"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 2v12h12V2H2zM1 2a1 1 0 011-1h12a1 1 0 011 1v12a1 1 0 01-1 1H2a1 1 0 01-1-1V2zm7 3h5v2H8V5zm0 3h5v2H8V8zm0 3h5v2H8v-2zM3 5h4v2H3V5zm0 3h4v2H3V8zm0 3h4v2H3v-2z"/>
              </svg>
            </button>
            <!-- Create Session button with dark theme styling -->
            <button
              class="p-2 text-primary bg-bg-tertiary border border-border hover:bg-surface-hover hover:border-primary rounded-md transition-all duration-200 flex-shrink-0"
              @click=${this.handleCreateSession}
              title="Create New Session (⌘K)"
              data-testid="create-session-button"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"/>
              </svg>
            </button>
            
            <!-- User menu -->
            ${this.renderCompactUserMenu()}
          </div>
        </div>
      </div>
    `;
  }

  private renderCompactUserMenu() {
    // When no user, don't show anything (settings accessible via notification bell)
    if (!this.currentUser) {
      return html``;
    }

    return html`
      <div class="user-menu-container relative">
        <button
          class="font-mono text-xs px-2 py-1 text-text-muted hover:text-text rounded border border-border hover:bg-bg-tertiary transition-all duration-200"
          @click=${this.toggleUserMenu}
          title="User menu"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path
              d="M10 0C4.48 0 0 4.48 0 10s4.48 10 10 10 10-4.48 10-10S15.52 0 10 0zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"
            />
          </svg>
        </button>
        ${
          this.showUserMenu
            ? html`
              <div
                class="absolute right-0 top-full mt-1 bg-surface border border-border rounded-lg shadow-lg py-1 z-50 min-w-32"
              >
                <div
                  class="px-3 py-1.5 text-xs text-text-muted border-b border-border font-mono"
                >
                  ${this.currentUser}
                </div>
                <button
                  class="w-full text-left px-3 py-1.5 text-xs font-mono text-status-warning hover:bg-bg-secondary hover:text-status-error"
                  @click=${this.handleLogout}
                >
                  Logout
                </button>
              </div>
            `
            : ''
        }
      </div>
    `;
  }
}
