/**
 * Base functionality for header components
 */
import { LitElement } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { Session } from '../../shared/types.js';
import { TIMING } from '../utils/constants.js';

export abstract class HeaderBase extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: Array }) sessions: Session[] = [];
  @property({ type: Boolean }) hideExited = true;
  @property({ type: String }) currentUser: string | null = null;
  @property({ type: String }) authMethod: string | null = null;
  @property({ type: String }) currentTheme = 'system';
  @state() protected killingAll = false;
  @state() protected showUserMenu = false;

  protected get runningSessions(): Session[] {
    return this.sessions.filter((session) => session.status === 'running');
  }

  protected get exitedSessions(): Session[] {
    return this.sessions.filter((session) => session.status === 'exited');
  }

  protected handleCreateSession(e: MouseEvent) {
    // Capture button position for view transition
    const button = e.currentTarget as HTMLButtonElement;
    const rect = button.getBoundingClientRect();

    // Store position in CSS custom properties for the transition
    document.documentElement.style.setProperty('--vt-button-x', `${rect.left + rect.width / 2}px`);
    document.documentElement.style.setProperty('--vt-button-y', `${rect.top + rect.height / 2}px`);
    document.documentElement.style.setProperty('--vt-button-width', `${rect.width}px`);
    document.documentElement.style.setProperty('--vt-button-height', `${rect.height}px`);

    this.dispatchEvent(new CustomEvent('create-session'));
  }

  protected handleKillAll() {
    if (this.killingAll) return;

    this.killingAll = true;
    this.requestUpdate();

    this.dispatchEvent(new CustomEvent('kill-all-sessions'));

    // Reset after a delay to prevent multiple clicks
    window.setTimeout(() => {
      this.killingAll = false;
    }, TIMING.KILL_ALL_BUTTON_DISABLE_DURATION);
  }

  protected handleCleanExited() {
    this.dispatchEvent(new CustomEvent('clean-exited-sessions'));
  }

  protected handleHideExitedToggle() {
    this.dispatchEvent(
      new CustomEvent('hide-exited-change', {
        detail: !this.hideExited,
      })
    );
  }

  protected handleOpenFileBrowser() {
    this.dispatchEvent(new CustomEvent('open-file-browser'));
  }

  protected handleOpenTmuxSessions() {
    this.dispatchEvent(new CustomEvent('open-tmux-sessions'));
  }

  protected handleOpenSettings() {
    this.showUserMenu = false;
    this.dispatchEvent(new CustomEvent('open-settings'));
  }

  protected handleLogout() {
    this.showUserMenu = false;
    this.dispatchEvent(new CustomEvent('logout'));
  }

  protected toggleUserMenu() {
    this.showUserMenu = !this.showUserMenu;
  }

  protected handleHomeClick() {
    this.dispatchEvent(new CustomEvent('navigate-to-list'));
  }

  protected handleClickOutside = (e: Event) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.user-menu-container')) {
      this.showUserMenu = false;
    }
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this.handleClickOutside);
    // Load saved theme preference
    const saved = localStorage.getItem('vibetunnel-theme');
    this.currentTheme = (saved as 'light' | 'dark' | 'system') || 'system';
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this.handleClickOutside);
  }
}
