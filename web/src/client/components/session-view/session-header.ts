/**
 * Session Header Component
 *
 * Header bar for session view with navigation, session info, status, and controls.
 * Includes back button, sidebar toggle, session details, and terminal controls.
 */
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Session } from '../session-list.js';
import '../clickable-path.js';
import './width-selector.js';
import '../inline-edit.js';
import '../notification-status.js';
import '../keyboard-capture-indicator.js';
import { authClient } from '../../services/auth-client.js';
import { isAIAssistantSession, sendAIPrompt } from '../../utils/ai-sessions.js';
import { createLogger } from '../../utils/logger.js';
import './mobile-menu.js';
import '../theme-toggle-icon.js';
import './image-upload-menu.js';

const logger = createLogger('session-header');

@customElement('session-header')
export class SessionHeader extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) session: Session | null = null;
  @property({ type: Boolean }) showBackButton = true;
  @property({ type: Boolean }) showSidebarToggle = false;
  @property({ type: Boolean }) sidebarCollapsed = false;
  @property({ type: Number }) terminalMaxCols = 0;
  @property({ type: Number }) terminalFontSize = 14;
  @property({ type: String }) customWidth = '';
  @property({ type: Boolean }) showWidthSelector = false;
  @property({ type: String }) widthLabel = '';
  @property({ type: String }) widthTooltip = '';
  @property({ type: Function }) onBack?: () => void;
  @property({ type: Function }) onSidebarToggle?: () => void;
  @property({ type: Function }) onOpenFileBrowser?: () => void;
  @property({ type: Function }) onCreateSession?: () => void;
  @property({ type: Function }) onOpenImagePicker?: () => void;
  @property({ type: Function }) onMaxWidthToggle?: () => void;
  @property({ type: Function }) onWidthSelect?: (width: number) => void;
  @property({ type: Function }) onFontSizeChange?: (size: number) => void;
  @property({ type: Function }) onOpenSettings?: () => void;
  @property({ type: String }) currentTheme = 'system';
  @property({ type: Boolean }) keyboardCaptureActive = true;
  @property({ type: Boolean }) isMobile = false;
  @property({ type: Boolean }) macAppConnected = false;
  @state() private isHovered = false;

  connectedCallback() {
    super.connectedCallback();
    // Load saved theme preference
    const saved = localStorage.getItem('vibetunnel-theme');
    this.currentTheme = (saved as 'light' | 'dark' | 'system') || 'system';
  }

  private getStatusText(): string {
    if (!this.session) return '';
    if ('active' in this.session && this.session.active === false) {
      return 'waiting';
    }
    return this.session.status;
  }

  private getStatusColor(): string {
    if (!this.session) return 'text-muted';
    if ('active' in this.session && this.session.active === false) {
      return 'text-muted';
    }
    return this.session.status === 'running' ? 'text-status-success' : 'text-status-warning';
  }

  private getStatusDotColor(): string {
    if (!this.session) return 'bg-muted';
    if ('active' in this.session && this.session.active === false) {
      return 'bg-muted';
    }
    return this.session.status === 'running' ? 'bg-status-success' : 'bg-status-warning';
  }

  private handleCloseWidthSelector() {
    this.dispatchEvent(
      new CustomEvent('close-width-selector', {
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    if (!this.session) return null;

    return html`
      <!-- Header with consistent dark theme -->
      <div
        class="flex items-center justify-between border-b border-border text-sm min-w-0 bg-bg-secondary px-4 py-2"
        style="padding-top: max(0.5rem, env(safe-area-inset-top)); padding-left: max(1rem, env(safe-area-inset-left)); padding-right: max(1rem, env(safe-area-inset-right));"
      >
        <div class="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
          <!-- Sidebar Toggle (when sidebar is collapsed) - visible on all screen sizes -->
          ${
            this.showSidebarToggle && this.sidebarCollapsed
              ? html`
                <button
                  class="bg-bg-tertiary border border-border rounded-lg p-2 font-mono text-muted transition-all duration-200 hover:text-primary hover:bg-surface-hover hover:border-primary hover:shadow-sm flex-shrink-0"
                  @click=${() => this.onSidebarToggle?.()}
                  title="Show sidebar (⌘B)"
                  aria-label="Show sidebar"
                  aria-expanded="false"
                  aria-controls="sidebar"
                >
                  <!-- Right chevron icon to expand sidebar -->
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"/>
                  </svg>
                </button>
                
                <!-- Create Session button (desktop only) -->
                <button
                  class="hidden sm:flex bg-bg-tertiary border border-border text-primary rounded-lg p-2 font-mono transition-all duration-200 hover:bg-surface-hover hover:border-primary hover:shadow-glow-primary-sm flex-shrink-0"
                  @click=${() => this.onCreateSession?.()}
                  title="Create New Session (⌘K)"
                  data-testid="create-session-button"
                >
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"/>
                  </svg>
                </button>
              `
              : ''
          }
          
          <!-- Status dot - visible on mobile, after sidebar toggle -->
          <div class="sm:hidden relative flex-shrink-0">
            <div class="w-2.5 h-2.5 rounded-full ${this.getStatusDotColor()}"></div>
            ${
              this.getStatusText() === 'running'
                ? html`<div class="absolute inset-0 w-2.5 h-2.5 rounded-full bg-status-success animate-ping opacity-50"></div>`
                : ''
            }
          </div>
          ${
            this.showBackButton
              ? html`
                <button
                  class="bg-bg-tertiary border border-border rounded-lg px-3 py-1.5 font-mono text-xs text-muted transition-all duration-200 hover:text-primary hover:bg-surface-hover hover:border-primary hover:shadow-sm flex-shrink-0"
                  @click=${() => this.onBack?.()}
                >
                  Back
                </button>
              `
              : ''
          }
          <div class="text-primary min-w-0 flex-1 overflow-hidden">
            <div class="text-bright font-medium text-xs sm:text-sm min-w-0 overflow-hidden">
              <div class="grid grid-cols-[1fr_auto] items-center gap-2 min-w-0" @mouseenter=${this.handleMouseEnter} @mouseleave=${this.handleMouseLeave}>
                <inline-edit
                  class="min-w-0"
                  .value=${
                    this.session.name ||
                    (Array.isArray(this.session.command)
                      ? this.session.command.join(' ')
                      : this.session.command)
                  }
                  .placeholder=${
                    Array.isArray(this.session.command)
                      ? this.session.command.join(' ')
                      : this.session.command
                  }
                  .onSave=${(newName: string) => this.handleRename(newName)}
                ></inline-edit>
                ${
                  isAIAssistantSession(this.session)
                    ? html`
                      <button
                        class="bg-transparent border-0 p-0 cursor-pointer transition-opacity duration-200 text-primary magic-button flex-shrink-0 ${this.isHovered ? 'opacity-50 hover:opacity-100' : 'opacity-0'}"
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          this.handleMagicButton();
                        }}
                        title="Send prompt to update terminal title"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M14.9 0.3a1 1 0 01-.2 1.4l-4 3a1 1 0 01-1.4-.2l-.3-.4a1 1 0 01.2-1.4l4-3a1 1 0 011.4.2l.3.4zM11.5 2.5l-1.5 1-1 1.5L3.5 10.5l-.3.3a2 2 0 00-.5.8l-.7 2.4a.5.5 0 00.6.6l2.4-.7a2 2 0 00.8-.5l.3-.3L11.5 7.5l1.5-1 1-1.5-2.5-2.5zM3 13l-.7.2.2-.7a1 1 0 01.2-.4l.3-.1v.5a.5.5 0 00.5.5h.5l-.1.3a1 1 0 01-.4.2L3 13z"/>
                          <path d="M9 1a1 1 0 100 2 1 1 0 000-2zM5 0a1 1 0 100 2 1 1 0 000-2zM2 3a1 1 0 100 2 1 1 0 000-2zM14 6a1 1 0 100 2 1 1 0 000-2zM15 10a1 1 0 100 2 1 1 0 000-2zM12 13a1 1 0 100 2 1 1 0 000-2z" opacity="0.5"/>
                        </svg>
                      </button>
                      <style>
                        /* Always show magic button on touch devices */
                        @media (hover: none) and (pointer: coarse) {
                          .magic-button {
                            opacity: 0.5 !important;
                          }
                          .magic-button:hover {
                            opacity: 1 !important;
                          }
                        }
                      </style>
                    `
                    : ''
                }
              </div>
            </div>
            <div class="text-xs opacity-75 mt-0.5 truncate">
              <clickable-path 
                .path=${this.session.workingDir} 
                .iconSize=${12}
              ></clickable-path>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 text-xs flex-shrink-0 ml-2">
          <!-- Notification status - desktop only -->
          <div class="hidden sm:block">
            <notification-status
              @open-settings=${() => this.onOpenSettings?.()}
            ></notification-status>
          </div>
          
          <!-- Keyboard capture indicator -->
          <keyboard-capture-indicator
            .active=${this.keyboardCaptureActive}
            .isMobile=${this.isMobile}
            @capture-toggled=${(e: CustomEvent) => {
              this.dispatchEvent(
                new CustomEvent('capture-toggled', {
                  detail: e.detail,
                  bubbles: true,
                  composed: true,
                })
              );
            }}
          ></keyboard-capture-indicator>
          
          <!-- Desktop buttons - hidden on mobile -->
          <div class="hidden sm:flex items-center gap-2">
            <!-- Theme toggle -->
            <theme-toggle-icon
              .theme=${this.currentTheme}
              @theme-changed=${(e: CustomEvent) => {
                this.currentTheme = e.detail.theme;
              }}
            ></theme-toggle-icon>
            
            <!-- Image Upload Menu -->
            <image-upload-menu
              .onPasteImage=${() => this.handlePasteImage()}
              .onSelectImage=${() => this.handleSelectImage()}
              .onOpenCamera=${() => this.handleOpenCamera()}
              .onBrowseFiles=${() => this.onOpenFileBrowser?.()}
              .isMobile=${this.isMobile}
            ></image-upload-menu>
            
            <button
              class="bg-bg-tertiary border border-border rounded-lg px-3 py-2 font-mono text-xs text-muted transition-all duration-200 hover:text-primary hover:bg-surface-hover hover:border-primary hover:shadow-sm flex-shrink-0 width-selector-button"
              @click=${() => this.onMaxWidthToggle?.()}
              title="${this.widthTooltip}"
            >
              ${this.widthLabel}
            </button>
          </div>
          
          <!-- Mobile menu - visible only on mobile -->
          <div class="flex sm:hidden flex-shrink-0">
            <mobile-menu
              .session=${this.session}
              .widthLabel=${this.widthLabel}
              .widthTooltip=${this.widthTooltip}
              .onOpenFileBrowser=${this.onOpenFileBrowser}
              .onUploadImage=${() => this.handleMobileUploadImage()}
              .onMaxWidthToggle=${this.onMaxWidthToggle}
              .onOpenSettings=${this.onOpenSettings}
              .onCreateSession=${this.onCreateSession}
              .currentTheme=${this.currentTheme}
              .macAppConnected=${this.macAppConnected}
            ></mobile-menu>
          </div>
          
          <!-- Status indicator - desktop only (mobile shows it on the left) -->
          <div class="hidden sm:flex flex-col items-end gap-0">
            <span class="text-xs flex items-center gap-2 font-medium ${
              this.getStatusText() === 'running' ? 'text-status-success' : 'text-status-warning'
            }">
              <div class="relative">
                <div class="w-2.5 h-2.5 rounded-full ${this.getStatusDotColor()}"></div>
                ${
                  this.getStatusText() === 'running'
                    ? html`<div class="absolute inset-0 w-2.5 h-2.5 rounded-full bg-status-success animate-ping opacity-50"></div>`
                    : ''
                }
              </div>
              ${this.getStatusText().toUpperCase()}
            </span>
          </div>
        </div>
      </div>
    `;
  }

  private handleRename(newName: string) {
    if (!this.session) return;

    // Dispatch event to parent component to handle the rename
    this.dispatchEvent(
      new CustomEvent('session-rename', {
        detail: {
          sessionId: this.session.id,
          newName: newName,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleMagicButton() {
    if (!this.session) return;

    logger.log('Magic button clicked for session', this.session.id);

    sendAIPrompt(this.session.id, authClient).catch((error) => {
      logger.error('Failed to send AI prompt', error);
    });
  }

  private handleMouseEnter = () => {
    this.isHovered = true;
  };

  private handleMouseLeave = () => {
    this.isHovered = false;
  };

  private handlePasteImage() {
    // Dispatch event to session-view to handle paste
    this.dispatchEvent(
      new CustomEvent('paste-image', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleSelectImage() {
    // Always dispatch select-image event to trigger the OS picker directly
    this.dispatchEvent(
      new CustomEvent('select-image', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleOpenCamera() {
    // Dispatch event to session-view to open camera
    this.dispatchEvent(
      new CustomEvent('open-camera', {
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleMobileUploadImage() {
    // Directly trigger the OS image picker
    this.dispatchEvent(
      new CustomEvent('select-image', {
        bubbles: true,
        composed: true,
      })
    );
  }
}
