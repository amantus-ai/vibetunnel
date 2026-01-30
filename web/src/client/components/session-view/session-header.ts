/**
 * Session Header Component
 *
 * Header bar for session view with navigation, session info, status, and controls.
 * Includes back button, sidebar toggle, session details, and terminal controls.
 */
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Session } from '../../../shared/types.js';
import '../clickable-path.js';
import '../inline-edit.js';
import '../notification-status.js';
import '../keyboard-capture-indicator.js';
import '../git-status-badge.js';
import { authClient } from '../../services/auth-client.js';
import { isAIAssistantSession, sendAIPrompt } from '../../utils/ai-sessions.js';
import { createLogger } from '../../utils/logger.js';
import './compact-menu.js';
import '../theme-toggle-icon.js';
import './image-upload-menu.js';
import './session-status-dropdown.js';

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
  @property({ type: Function }) onTerminateSession?: () => void;
  @property({ type: Function }) onClearSession?: () => void;
  @property({ type: Boolean }) hasGitRepo = false;
  @property({ type: String }) viewMode: 'terminal' | 'worktree' = 'terminal';
  @property({ type: Function }) onToggleViewMode?: () => void;
  @property({ type: Boolean }) chatMode = false;
  @property({ type: Function }) onToggleChatMode?: () => void;
  @state() private isHovered = false;
  @state() private useCompactMenu = false;
  private resizeObserver?: ResizeObserver;

  connectedCallback() {
    super.connectedCallback();
    // Load saved theme preference
    const saved = localStorage.getItem('vibetunnel-theme');
    this.currentTheme = (saved as 'light' | 'dark' | 'system') || 'system';

    // Setup resize observer for responsive button switching
    this.setupResizeObserver();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties);
  }

  private setupResizeObserver() {
    // Observe the header container for size changes
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        this.checkButtonSpace(entry.contentRect.width);
      }
    });

    // Start observing after the element is rendered
    this.updateComplete.then(() => {
      // Use requestAnimationFrame to ensure DOM is fully rendered
      requestAnimationFrame(() => {
        const headerContainer = this.querySelector('.session-header-container');
        if (headerContainer) {
          this.resizeObserver?.observe(headerContainer);
          // Trigger initial check
          const width = headerContainer.clientWidth;
          this.checkButtonSpace(width);
        }
      });
    });
  }

  private checkButtonSpace(containerWidth: number) {
    // Calculate the minimum space needed for all individual buttons
    // Button widths (including padding):
    const imageUploadButton = 40;
    const themeToggleButton = 40;
    const settingsButton = 40;
    const widthSelectorButton = 120; // Wider due to text content (increased)
    const statusDropdownButton = 120; // Wider due to text content (increased)
    const buttonGap = 8;

    // Other elements:
    const captureIndicatorWidth = 100; // Keyboard capture indicator (increased)
    const sessionInfoMinWidth = 300; // Minimum space for session name/path (increased)
    const sidebarToggleWidth = this.showSidebarToggle && this.sidebarCollapsed ? 56 : 0; // Including gap
    const padding = 48; // Container padding (increased)

    // Calculate total required width
    const buttonsWidth =
      imageUploadButton +
      themeToggleButton +
      settingsButton +
      widthSelectorButton +
      statusDropdownButton +
      buttonGap * 4;

    const requiredWidth =
      sessionInfoMinWidth + sidebarToggleWidth + captureIndicatorWidth + buttonsWidth + padding;

    // Switch to compact menu more aggressively (larger buffer)
    const buffer = 150; // Increased buffer to account for sidebar
    const shouldUseCompact = containerWidth < requiredWidth + buffer;

    if (shouldUseCompact !== this.useCompactMenu) {
      this.useCompactMenu = shouldUseCompact;
      this.requestUpdate();
    }
  }

  private getStatusText(): string {
    if (!this.session) return '';
    if ('active' in this.session && this.session.active === false) {
      return 'waiting';
    }
    return this.session.status;
  }

  private getSessionDuration(): string {
    if (!this.session?.startedAt) return '--';
    const start = new Date(this.session.startedAt).getTime();
    const now = Date.now();
    const diffMs = now - start;

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  render() {
    if (!this.session) return null;

    // Mobile-specific header layout
    if (this.isMobile) {
      return html`
        <!-- VibeTunnel V3 Mobile Session Header -->
        <div
          class="flex items-center justify-between font-ui text-sm session-header-container"
          style="background: var(--color-bg-secondary); padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-top: calc(16px + env(safe-area-inset-top));"
        >
          <!-- Left: Back + Session Info -->
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <!-- Back Button -->
            <button
              class="flex items-center justify-center w-10 h-10 rounded-xl transition-all flex-shrink-0 header-action-btn"
              style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08);"
              @click=${() => this.onBack?.()}
              title="Back"
              data-testid="session-back-button-mobile"
            >
              <svg class="w-5 h-5" style="color: #A3A3A3;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
            </button>

            <!-- Session Info -->
            <div class="flex flex-col gap-0.5 min-w-0 flex-1 session-info">
              <!-- Session Name -->
              <span class="font-ui text-sm font-semibold truncate" style="color: var(--color-text);">
                ${this.session.name || (Array.isArray(this.session.command) ? this.session.command.join(' ') : this.session.command)}
              </span>
              <!-- Status with Dot -->
              <div class="flex items-center gap-1.5">
                <div
                  class="w-1.5 h-1.5 rounded-full"
                  style="background: ${this.getStatusText() === 'running' ? 'var(--color-primary)' : this.getStatusText() === 'starting' ? '#FBBF24' : '#525252'};"
                ></div>
                <span class="font-ui text-[11px] capitalize" style="color: #737373;">
                  ${this.getStatusText()}
                </span>
                <span class="font-ui text-[11px]" style="color: #525252;">
                  · ${this.getSessionDuration()}
                </span>
              </div>
            </div>
          </div>

          <!-- Right: Minimal Actions -->
          <div class="flex items-center gap-2 flex-shrink-0 header-actions">
            <!-- Chat mode toggle -->
            <button
              class="flex items-center justify-center w-10 h-10 rounded-xl transition-all header-action-btn"
              style="background: ${this.chatMode ? 'var(--color-primary)' : 'rgba(255,255,255,0.06)'}; border: 1px solid ${this.chatMode ? 'var(--color-primary)' : 'rgba(255,255,255,0.08)'}; color: ${this.chatMode ? 'var(--color-bg)' : '#A3A3A3'};"
              @click=${() => this.onToggleChatMode?.()}
              title="${this.chatMode ? 'Terminal' : 'Chat'}"
            >
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 16 16">
                <path d="M2.678 11.894a1 1 0 01.287.801 10.97 10.97 0 01-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 01.71-.074A8.06 8.06 0 008 14c3.996 0 7-2.807 7-6 0-3.192-3.004-6-7-6S1 4.808 1 8c0 1.468.617 2.83 1.678 3.894zm-.493 3.905a21.682 21.682 0 01-.713.129c-.2.032-.352-.176-.273-.362a9.68 9.68 0 00.244-.637l.003-.01c.248-.72.45-1.548.524-2.319C.743 11.37 0 9.76 0 8c0-3.866 3.582-7 8-7s8 3.134 8 7-3.582 7-8 7a9.06 9.06 0 01-2.347-.306c-.52.263-1.639.742-3.468 1.105z"/>
              </svg>
            </button>
            <!-- Menu -->
            <compact-menu
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
              .onTerminateSession=${this.onTerminateSession}
              .onClearSession=${this.onClearSession}
              .hasGitRepo=${this.hasGitRepo}
              .viewMode=${this.viewMode}
              .onToggleViewMode=${() => this.dispatchEvent(new CustomEvent('toggle-view-mode'))}
              .chatMode=${this.chatMode}
              .onToggleChatMode=${this.onToggleChatMode}
              @theme-changed=${(e: CustomEvent) => {
                this.currentTheme = e.detail.theme;
              }}
            ></compact-menu>
          </div>
        </div>
      `;
    }

    return html`
      <!-- VibeTunnel V3 Session Header -->
      <div
        class="flex items-center justify-between font-ui text-sm min-w-0 max-w-[100vw] session-header-container"
        style="background: var(--color-bg-secondary); padding: 20px 28px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-left: max(28px, env(safe-area-inset-left)); padding-right: max(28px, env(safe-area-inset-right));"
      >
        <!-- Left: Back + Session Info -->
        <div class="flex items-center gap-4 min-w-0 flex-1 overflow-hidden flex-shrink">
          <!-- Back Button -->
          ${
            this.showBackButton
              ? html`
                <button
                  class="flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200 hover:bg-white/10 flex-shrink-0"
                  style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);"
                  @click=${() => this.onBack?.()}
                  title="Back"
                  data-testid="session-back-button"
                >
                  <svg class="w-[18px] h-[18px]" style="color: #737373;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                  </svg>
                </button>
              `
              : ''
          }

          <!-- Session Info -->
          <div class="flex items-center gap-3 min-w-0 overflow-hidden" @mouseenter=${this.handleMouseEnter} @mouseleave=${this.handleMouseLeave}>
            <!-- Status Dot with Glow -->
            <div class="relative flex-shrink-0">
              <div
                class="w-2.5 h-2.5 rounded-full"
                style="background: ${this.getStatusText() === 'running' ? 'var(--color-primary)' : this.getStatusText() === 'starting' ? 'var(--color-status-warning)' : 'var(--color-text-dim)'}; box-shadow: ${this.getStatusText() === 'running' ? '0 0 8px rgba(0, 210, 255, 0.6)' : 'none'};"
              ></div>
            </div>

            <!-- Session Name (editable) -->
            <inline-edit
              class="min-w-0 overflow-hidden block max-w-xs sm:max-w-md"
              style="font-size: 16px; font-weight: 600; color: var(--color-text);"
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

            <!-- Magic Button for AI Sessions -->
            ${
              isAIAssistantSession(this.session)
                ? html`
                  <button
                    class="bg-transparent border-0 p-0 cursor-pointer transition-opacity duration-200 magic-button flex-shrink-0 ${this.isHovered ? 'opacity-50 hover:opacity-100' : 'opacity-0'}"
                    style="color: var(--color-primary);"
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this.handleMagicButton();
                    }}
                    title="Send prompt to update terminal title"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9.5 21.5L21.5 9.5a1 1 0 000-1.414l-1.086-1.086a1 1 0 00-1.414 0L7 19l2.5 2.5z" opacity="0.9"/>
                      <path d="M6 18l-1.5 3.5a.5.5 0 00.7.7L8.5 21l-2.5-3z" opacity="0.9"/>
                      <circle cx="8" cy="4" r="1"/><circle cx="4" cy="8" r="1"/>
                      <circle cx="16" cy="4" r="1"/><circle cx="20" cy="8" r="1"/>
                    </svg>
                  </button>
                  <style>
                    @media (hover: none) and (pointer: coarse) {
                      .magic-button { opacity: 0.5 !important; }
                      .magic-button:hover { opacity: 1 !important; }
                    }
                  </style>
                `
                : ''
            }

            <!-- Server Badge (desktop only) -->
            <div
              class="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md"
              style="background: rgba(255,255,255,0.04);"
            >
              <svg class="w-3 h-3" style="color: #525252;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21.75 17.25v-.228a4.5 4.5 0 0 0-.12-1.03l-2.268-9.64a3.375 3.375 0 0 0-3.285-2.602H7.923a3.375 3.375 0 0 0-3.285 2.602l-2.268 9.64a4.5 4.5 0 0 0-.12 1.03v.228m19.5 0a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3m19.5 0a3 3 0 0 0-3-3H5.25a3 3 0 0 0-3 3m16.5 0h.008v.008h-.008v-.008Zm-3 0h.008v.008h-.008v-.008Z" />
              </svg>
              <span class="font-ui text-[11px]" style="color: #737373;">
                ${this.session.remoteName || 'local'}
              </span>
            </div>
          </div>

          <!-- Path info (desktop, secondary line) -->
          <div class="hidden sm:flex items-center gap-2 min-w-0 overflow-hidden ml-auto">
            <clickable-path
              class="min-w-0 flex-1 truncate opacity-75"
              .path=${this.session.workingDir}
              .iconSize=${12}
            ></clickable-path>
            ${
              this.session.gitRepoPath
                ? html`
                  <git-status-badge
                    class="min-w-0 max-w-[30%] sm:max-w-none"
                    .session=${this.session}
                    .detailed=${false}
                  ></git-status-badge>
                `
                : ''
            }
          </div>
        </div>

        <!-- Right: Stats + Actions -->
        <div class="flex items-center gap-3 flex-shrink-0 ml-4">
          <!-- Stats (desktop only) -->
          <div class="hidden lg:flex items-center gap-4">
            <!-- Session Duration -->
            <div class="flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5" style="color: #525252;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <span class="font-ui text-xs" style="color: #737373;">
                ${this.getSessionDuration()}
              </span>
            </div>
            <!-- Status Text -->
            <div class="flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5" style="color: ${this.getStatusText() === 'running' ? 'var(--color-primary)' : '#FBBF24'};" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
              <span class="font-ui text-xs capitalize" style="color: ${this.getStatusText() === 'running' ? 'var(--color-primary)' : '#FBBF24'};">
                ${this.getStatusText()}
              </span>
            </div>
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

          <!-- Action Buttons -->
          ${
            this.useCompactMenu || this.isMobile
              ? html`
              <!-- Compact menu for mobile/tight spaces -->
              <div class="flex items-center gap-2 flex-shrink-0">
                <!-- Chat mode toggle -->
                <button
                  class="flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200 flex-shrink-0"
                  style="background: ${this.chatMode ? 'var(--color-primary)' : 'rgba(255,255,255,0.04)'}; border: 1px solid ${this.chatMode ? 'var(--color-primary)' : 'rgba(255,255,255,0.08)'}; color: ${this.chatMode ? 'var(--color-bg)' : '#737373'};"
                  @click=${() => this.onToggleChatMode?.()}
                  title="${this.chatMode ? 'Switch to Terminal Mode' : 'Switch to Chat Mode'}"
                  data-testid="chat-mode-toggle-button-compact"
                >
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M2.678 11.894a1 1 0 01.287.801 10.97 10.97 0 01-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 01.71-.074A8.06 8.06 0 008 14c3.996 0 7-2.807 7-6 0-3.192-3.004-6-7-6S1 4.808 1 8c0 1.468.617 2.83 1.678 3.894zm-.493 3.905a21.682 21.682 0 01-.713.129c-.2.032-.352-.176-.273-.362a9.68 9.68 0 00.244-.637l.003-.01c.248-.72.45-1.548.524-2.319C.743 11.37 0 9.76 0 8c0-3.866 3.582-7 8-7s8 3.134 8 7-3.582 7-8 7a9.06 9.06 0 01-2.347-.306c-.52.263-1.639.742-3.468 1.105z"/>
                  </svg>
                </button>
                <compact-menu
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
                  .onTerminateSession=${this.onTerminateSession}
                  .onClearSession=${this.onClearSession}
                  .hasGitRepo=${this.hasGitRepo}
                  .viewMode=${this.viewMode}
                  .onToggleViewMode=${() => this.dispatchEvent(new CustomEvent('toggle-view-mode'))}
                  .chatMode=${this.chatMode}
                  .onToggleChatMode=${this.onToggleChatMode}
                  @theme-changed=${(e: CustomEvent) => {
                    this.currentTheme = e.detail.theme;
                  }}
                ></compact-menu>
              </div>
            `
              : html`
              <!-- VibeTunnel V3 Individual buttons for desktop -->
              <div class="flex items-center gap-2">
                <!-- Git worktree toggle -->
                ${
                  this.hasGitRepo
                    ? html`
                      <button
                        class="flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200 hover:bg-white/10 flex-shrink-0"
                        style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: #737373;"
                        @click=${() => this.onToggleViewMode?.()}
                        title="${this.viewMode === 'terminal' ? 'Show Worktrees' : 'Show Terminal'}"
                        data-testid="worktree-toggle-button"
                      >
                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                          <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811V2.828zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492V2.687zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783z"/>
                        </svg>
                      </button>
                    `
                    : ''
                }

                <!-- Chat mode toggle -->
                <button
                  class="flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200 flex-shrink-0"
                  style="background: ${this.chatMode ? 'var(--color-primary)' : 'rgba(255,255,255,0.04)'}; border: 1px solid ${this.chatMode ? 'var(--color-primary)' : 'rgba(255,255,255,0.08)'}; color: ${this.chatMode ? 'var(--color-bg)' : '#737373'};"
                  @click=${() => this.onToggleChatMode?.()}
                  title="${this.chatMode ? 'Switch to Terminal Mode' : 'Switch to Chat Mode'}"
                  data-testid="chat-mode-toggle-button"
                >
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M2.678 11.894a1 1 0 01.287.801 10.97 10.97 0 01-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 01.71-.074A8.06 8.06 0 008 14c3.996 0 7-2.807 7-6 0-3.192-3.004-6-7-6S1 4.808 1 8c0 1.468.617 2.83 1.678 3.894zm-.493 3.905a21.682 21.682 0 01-.713.129c-.2.032-.352-.176-.273-.362a9.68 9.68 0 00.244-.637l.003-.01c.248-.72.45-1.548.524-2.319C.743 11.37 0 9.76 0 8c0-3.866 3.582-7 8-7s8 3.134 8 7-3.582 7-8 7a9.06 9.06 0 01-2.347-.306c-.52.263-1.639.742-3.468 1.105z"/>
                  </svg>
                </button>

                <!-- Copy button -->
                <button
                  class="flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200 hover:bg-white/10 flex-shrink-0"
                  style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: #737373;"
                  @click=${() => this.handlePasteImage()}
                  title="Clipboard"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                  </svg>
                </button>

                <!-- More actions menu -->
                <image-upload-menu
                  .onPasteImage=${() => this.handlePasteImage()}
                  .onSelectImage=${() => this.handleSelectImage()}
                  .onOpenCamera=${() => this.handleOpenCamera()}
                  .onBrowseFiles=${() => this.onOpenFileBrowser?.()}
                  .isMobile=${this.isMobile}
                ></image-upload-menu>

                <!-- Settings -->
                <notification-status
                  @open-settings=${() => this.onOpenSettings?.()}
                ></notification-status>

                <!-- Disconnect/Terminate Button -->
                <button
                  class="flex items-center gap-1.5 px-4 py-2 rounded-lg font-ui text-xs font-medium transition-all duration-200 hover:bg-red-500/20 flex-shrink-0"
                  style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #EF4444;"
                  @click=${() => this.onTerminateSession?.()}
                  title="Terminate Session"
                  data-testid="session-terminate-button"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5.636 5.636a9 9 0 1 0 12.728 0M12 3v9" />
                  </svg>
                  <span class="hidden xl:inline">Disconnect</span>
                </button>
              </div>
            `
          }
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
