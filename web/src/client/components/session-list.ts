/**
 * Session List Component
 *
 * Displays a grid of session cards and manages the session creation modal.
 * Handles session filtering (hide/show exited) and cleanup operations.
 *
 * @fires navigate-to-session - When a session is selected (detail: { sessionId: string })
 * @fires refresh - When session list needs refreshing
 * @fires error - When an error occurs (detail: string)
 * @fires session-created - When a new session is created (detail: { sessionId: string, message?: string })
 * @fires create-modal-close - When create modal should close
 * @fires hide-exited-change - When hide exited state changes (detail: boolean)
 * @fires kill-all-sessions - When all sessions should be killed
 *
 * @listens session-killed - From session-card when a session is killed
 * @listens session-kill-error - From session-card when kill fails
 * @listens clean-exited-sessions - To trigger cleanup of exited sessions
 */
import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { Session } from '../../shared/types.js';
import { HttpMethod } from '../../shared/types.js';
import type { AuthClient } from '../services/auth-client.js';
import './session-card.js';
import './inline-edit.js';
import './session-list/compact-session-card.js';
import './session-list/repository-header.js';
import { getBaseRepoName } from '../../shared/utils/git.js';
import { Z_INDEX } from '../utils/constants.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('session-list');

@customElement('session-list')
export class SessionList extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Array }) sessions: Session[] = [];
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean }) hideExited = true;
  @property({ type: Object }) authClient!: AuthClient;
  @property({ type: String }) selectedSessionId: string | null = null;
  @property({ type: Boolean }) compactMode = false;

  @state() private cleaningExited = false;
  @state() private repoFollowMode = new Map<string, string | undefined>();
  @state() private loadingFollowMode = new Set<string>();
  @state() private showFollowDropdown = new Map<string, boolean>();
  @state() private repoWorktrees = new Map<
    string,
    Array<{ path: string; branch: string; HEAD: string; detached: boolean }>
  >();
  @state() private loadingWorktrees = new Set<string>();
  @state() private showWorktreeDropdown = new Map<string, boolean>();

  connectedCallback() {
    super.connectedCallback();
    // Make the component focusable
    this.tabIndex = 0;
    // Add keyboard listener only to this component
    this.addEventListener('keydown', this.handleKeyDown);
    // Add click outside listener for dropdowns
    document.addEventListener('click', this.handleClickOutside);
  }

  updated(changedProperties: Map<string | number | symbol, unknown>) {
    super.updated(changedProperties);

    if (changedProperties.has('sessions')) {
      // Load follow mode for all repositories
      this.loadFollowModeForAllRepos();
    }
  }

  private async loadFollowModeForAllRepos() {
    const repoGroups = this.groupSessionsByRepo(this.sessions);
    for (const [repoPath] of repoGroups) {
      if (repoPath && !this.repoFollowMode.has(repoPath)) {
        this.loadFollowModeForRepo(repoPath);
        this.loadWorktreesForRepo(repoPath);
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('click', this.handleClickOutside);
  }

  private handleClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    // Check if click is outside any selector
    const isInsideSelector =
      target.closest('[id^="branch-selector-"]') ||
      target.closest('.branch-dropdown') ||
      target.closest('[id^="worktree-selector-"]') ||
      target.closest('.worktree-dropdown');

    if (!isInsideSelector) {
      if (this.showFollowDropdown.size > 0 || this.showWorktreeDropdown.size > 0) {
        // Create new empty maps to close all dropdowns atomically
        this.showFollowDropdown = new Map<string, boolean>();
        this.showWorktreeDropdown = new Map<string, boolean>();
        this.requestUpdate();
      }
    }
  };

  private getVisibleSessions() {
    const running = this.sessions.filter((s) => s.status === 'running');
    const exited = this.sessions.filter((s) => s.status === 'exited');
    return this.hideExited ? running : running.concat(exited);
  }

  private getGridColumns(): number {
    // Get the grid container element
    const gridContainer = this.querySelector('.session-flex-responsive');
    if (!gridContainer || this.compactMode) return 1; // Compact mode is single column

    // Get the computed style to check the actual grid columns
    const computedStyle = window.getComputedStyle(gridContainer);
    const templateColumns = computedStyle.getPropertyValue('grid-template-columns');

    // Count the number of columns by splitting the template value
    const columns = templateColumns.split(' ').filter((col) => col && col !== '0px').length;

    // Fallback: calculate based on container width and minimum item width
    if (columns === 0 || columns === 1) {
      const containerWidth = gridContainer.clientWidth;
      const minItemWidth = 280; // From CSS: minmax(280px, 1fr)
      const gap = 20; // 1.25rem = 20px
      return Math.max(1, Math.floor((containerWidth + gap) / (minItemWidth + gap)));
    }

    return columns;
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    const { key } = e;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(key)) {
      return;
    }

    // Check if we're inside an input element - since we're now listening on the component
    // itself, we need to stop propagation for child inputs
    const target = e.target as HTMLElement;
    if (
      target !== this &&
      (target.closest('input, textarea, select') || target.isContentEditable)
    ) {
      return;
    }

    const sessions = this.getVisibleSessions();
    if (sessions.length === 0) return;

    e.preventDefault();
    e.stopPropagation(); // Prevent event from bubbling up

    let index = this.selectedSessionId
      ? sessions.findIndex((s) => s.id === this.selectedSessionId)
      : 0;
    if (index < 0) index = 0;

    if (key === 'Enter') {
      this.handleSessionSelect({ detail: sessions[index] } as CustomEvent);
      return;
    }

    const columns = this.getGridColumns();

    if (key === 'ArrowLeft') {
      // Move left, wrap to previous row
      index = (index - 1 + sessions.length) % sessions.length;
    } else if (key === 'ArrowRight') {
      // Move right, wrap to next row
      index = (index + 1) % sessions.length;
    } else if (key === 'ArrowUp') {
      // Move up one row
      index = index - columns;
      if (index < 0) {
        // Wrap to the bottom, trying to maintain column position
        const currentColumn = index + columns; // Original index
        const lastRowStart = Math.floor((sessions.length - 1) / columns) * columns;
        index = Math.min(lastRowStart + currentColumn, sessions.length - 1);
      }
    } else if (key === 'ArrowDown') {
      // Move down one row
      const oldIndex = index;
      index = index + columns;
      if (index >= sessions.length) {
        // Wrap to the top, maintaining column position
        const currentColumn = oldIndex % columns;
        index = currentColumn;
      }
    }

    this.selectedSessionId = sessions[index].id;
    this.requestUpdate();

    // Ensure the selected element is visible by scrolling it into view
    setTimeout(() => {
      const selectedCard =
        this.querySelector(`session-card[selected]`) ||
        this.querySelector(`div[class*="bg-bg-elevated"][class*="border-accent-primary"]`);
      if (selectedCard) {
        selectedCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 0);
  };

  private handleSessionSelect(e: CustomEvent) {
    const session = e.detail as Session;

    // Dispatch a custom event that the app can handle with view transitions
    this.dispatchEvent(
      new CustomEvent('navigate-to-session', {
        detail: { sessionId: session.id },
        bubbles: true,
        composed: true,
      })
    );
  }

  private async handleSessionKilled(e: CustomEvent) {
    const { sessionId } = e.detail;
    logger.debug(`session ${sessionId} killed, updating session list`);

    // Remove the session from the local state
    this.sessions = this.sessions.filter((session) => session.id !== sessionId);

    // Re-dispatch the event for parent components
    this.dispatchEvent(
      new CustomEvent('session-killed', {
        detail: sessionId,
        bubbles: true,
        composed: true,
      })
    );

    // Then trigger a refresh to get the latest server state
    this.dispatchEvent(new CustomEvent('refresh'));
  }

  private handleSessionKillError(e: CustomEvent) {
    const { sessionId, error } = e.detail;
    logger.error(`failed to kill session ${sessionId}:`, error);

    // Dispatch error event to parent for user notification
    this.dispatchEvent(
      new CustomEvent('error', {
        detail: `Failed to kill session: ${error}`,
      })
    );
  }

  private handleSessionRenamed = (e: CustomEvent) => {
    const { sessionId, newName } = e.detail;
    // Update the local session object
    const sessionIndex = this.sessions.findIndex((s) => s.id === sessionId);
    if (sessionIndex >= 0) {
      this.sessions[sessionIndex] = { ...this.sessions[sessionIndex], name: newName };
      this.requestUpdate();
    }
  };

  private handleSessionRenameError = (e: CustomEvent) => {
    const { sessionId, error } = e.detail;
    logger.error(`failed to rename session ${sessionId}:`, error);

    // Dispatch error event to parent for user notification
    this.dispatchEvent(
      new CustomEvent('error', {
        detail: `Failed to rename session: ${error}`,
      })
    );
  };

  public async handleCleanupExited() {
    if (this.cleaningExited) return;

    this.cleaningExited = true;
    this.requestUpdate();

    try {
      const response = await fetch('/api/cleanup-exited', {
        method: HttpMethod.POST,
        headers: {
          ...this.authClient.getAuthHeader(),
        },
      });

      if (response.ok) {
        // Get the list of exited sessions before cleanup
        const exitedSessions = this.sessions.filter((s) => s.status === 'exited');

        // Apply black hole animation to all exited sessions
        if (exitedSessions.length > 0) {
          const sessionCards = this.querySelectorAll('session-card');
          const exitedCards: HTMLElement[] = [];

          sessionCards.forEach((card) => {
            const sessionCard = card as HTMLElement & { session?: { id: string; status: string } };
            if (sessionCard.session?.status === 'exited') {
              exitedCards.push(sessionCard);
            }
          });

          // Apply animation to all exited cards
          exitedCards.forEach((card) => {
            card.classList.add('black-hole-collapsing');
          });

          // Wait for animation to complete
          if (exitedCards.length > 0) {
            await new Promise((resolve) => setTimeout(resolve, 300));
          }

          // Remove all exited sessions at once
          this.sessions = this.sessions.filter((session) => session.status !== 'exited');
        }

        this.dispatchEvent(new CustomEvent('refresh'));
      } else {
        this.dispatchEvent(
          new CustomEvent('error', { detail: 'Failed to cleanup exited sessions' })
        );
      }
    } catch (error) {
      logger.error('error cleaning up exited sessions:', error);
      this.dispatchEvent(new CustomEvent('error', { detail: 'Failed to cleanup exited sessions' }));
    } finally {
      this.cleaningExited = false;
      this.requestUpdate();
    }
  }

  private groupSessionsByRepo(sessions: Session[]): Map<string | null, Session[]> {
    const groups = new Map<string | null, Session[]>();

    sessions.forEach((session) => {
      // Use gitMainRepoPath to group worktrees with their main repository
      const groupKey = session.gitMainRepoPath || session.gitRepoPath || null;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      const group = groups.get(groupKey);
      if (group) {
        group.push(session);
      }
    });

    // Sort groups: non-git sessions first, then git sessions
    const sortedGroups = new Map<string | null, Session[]>();

    // Add non-git sessions first
    if (groups.has(null)) {
      const nullGroup = groups.get(null);
      if (nullGroup) {
        sortedGroups.set(null, nullGroup);
      }
    }

    // Add git sessions sorted by repo name
    const gitRepos = Array.from(groups.keys()).filter((key): key is string => key !== null);
    gitRepos.sort((a, b) => {
      const nameA = this.getRepoName(a);
      const nameB = this.getRepoName(b);
      return nameA.localeCompare(nameB);
    });

    gitRepos.forEach((repo) => {
      const repoGroup = groups.get(repo);
      if (repoGroup) {
        sortedGroups.set(repo, repoGroup);
      }
    });

    return sortedGroups;
  }

  private getRepoName(repoPath: string): string {
    return getBaseRepoName(repoPath);
  }

  private async loadFollowModeForRepo(repoPath: string) {
    if (this.loadingFollowMode.has(repoPath)) {
      return;
    }

    this.loadingFollowMode.add(repoPath);
    this.requestUpdate();

    try {
      const response = await fetch(
        `/api/repositories/follow-mode?${new URLSearchParams({ path: repoPath })}`,
        {
          headers: this.authClient.getAuthHeader(),
        }
      );

      if (response.ok) {
        const { followBranch } = await response.json();
        this.repoFollowMode.set(repoPath, followBranch);
      } else {
        logger.error(`Failed to load follow mode for ${repoPath}`);
      }
    } catch (error) {
      logger.error('Error loading follow mode:', error);
    } finally {
      this.loadingFollowMode.delete(repoPath);
      this.requestUpdate();
    }
  }

  private async handleFollowModeChange(repoPath: string, followBranch: string | undefined) {
    this.repoFollowMode.set(repoPath, followBranch);
    // Create new map without this repo's dropdown
    const newFollowDropdown = new Map(this.showFollowDropdown);
    newFollowDropdown.delete(repoPath);
    this.showFollowDropdown = newFollowDropdown;
    this.requestUpdate();

    try {
      const response = await fetch('/api/repositories/follow-mode', {
        method: HttpMethod.POST,
        headers: {
          'Content-Type': 'application/json',
          ...this.authClient.getAuthHeader(),
        },
        body: JSON.stringify({ repoPath, followBranch }),
      });

      if (!response.ok) {
        throw new Error('Failed to update follow mode');
      }

      const event = new CustomEvent('show-toast', {
        detail: {
          message: followBranch
            ? `Following worktree branch: ${followBranch}`
            : 'Follow mode disabled',
          type: 'success',
        },
        bubbles: true,
        composed: true,
      });
      this.dispatchEvent(event);
    } catch (error) {
      logger.error('Error updating follow mode:', error);
      const event = new CustomEvent('show-toast', {
        detail: { message: 'Failed to update follow mode', type: 'error' },
        bubbles: true,
        composed: true,
      });
      this.dispatchEvent(event);
    }
  }

  private toggleFollowDropdown(dropdownKey: string) {
    const isOpen = this.showFollowDropdown.get(dropdownKey) || false;

    // Create new maps to avoid intermediate states during update
    const newFollowDropdown = new Map<string, boolean>();
    const newWorktreeDropdown = new Map<string, boolean>();

    // Only set the clicked dropdown if it wasn't already open
    if (!isOpen) {
      newFollowDropdown.set(dropdownKey, true);
      // Extract repo path from dropdown key for loading
      const repoPath = dropdownKey.split(':')[0];
      // Load follow mode if not already loaded
      this.loadFollowModeForRepo(repoPath);
    }

    // Update state atomically
    this.showFollowDropdown = newFollowDropdown;
    this.showWorktreeDropdown = newWorktreeDropdown;

    this.requestUpdate();
  }

  private renderFollowModeSelector(repoPath: string, sectionType: string = '') {
    const worktrees = this.repoWorktrees.get(repoPath) || [];
    const followMode = this.repoFollowMode.get(repoPath);
    const isLoading = this.loadingFollowMode.has(repoPath);
    const dropdownKey = `${repoPath}:${sectionType}`;
    const isDropdownOpen = this.showFollowDropdown.get(dropdownKey) || false;

    // Only show if there are worktrees
    if (worktrees.length === 0) {
      return html``;
    }

    const displayText = followMode ? `Following: ${followMode}` : 'Standalone';

    return html`
      <div class="relative">
        <button
          class="flex items-center gap-1 px-2 py-1 text-xs bg-bg-secondary hover:bg-bg-tertiary rounded-md border border-border transition-colors"
          @click=${() => this.toggleFollowDropdown(dropdownKey)}
          id="follow-selector-${dropdownKey.replace(/[^a-zA-Z0-9]/g, '-')}"
        >
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <span class="font-mono text-xs">${displayText}</span>
          ${
            isLoading
              ? html`<span class="animate-spin">⟳</span>`
              : html`
              <svg class="w-3 h-3 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}" 
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            `
          }
        </button>
        
        ${
          isDropdownOpen
            ? html`
          <div class="follow-dropdown absolute right-0 mt-1 w-64 bg-bg-elevated border border-border rounded-md shadow-lg max-h-96 overflow-y-auto" style="z-index: ${Z_INDEX.BRANCH_SELECTOR_DROPDOWN}">
            <div class="py-1">
              <button
                class="w-full text-left px-3 py-2 text-xs hover:bg-bg-elevated transition-colors flex items-center justify-between"
                @click=${() => this.handleFollowModeChange(repoPath, undefined)}
              >
                <span class="font-mono ${!followMode ? 'text-accent-primary font-semibold' : ''}">Standalone</span>
                ${!followMode ? html`<span class="text-accent-primary">✓</span>` : ''}
              </button>
              
              ${worktrees.map(
                (worktree) => html`
                <button
                  class="w-full text-left px-3 py-2 text-xs hover:bg-bg-elevated transition-colors flex items-center justify-between"
                  @click=${() => this.handleFollowModeChange(repoPath, worktree.branch)}
                >
                  <div class="flex items-center gap-2">
                    <span class="font-mono ${followMode === worktree.branch ? 'text-accent-primary font-semibold' : ''}">
                      Follow: ${worktree.branch}
                    </span>
                    <span class="text-[10px] text-text-muted">${worktree.path}</span>
                  </div>
                  ${followMode === worktree.branch ? html`<span class="text-accent-primary">✓</span>` : ''}
                </button>
              `
              )}
            </div>
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  private async loadWorktreesForRepo(repoPath: string) {
    if (this.loadingWorktrees.has(repoPath) || this.repoWorktrees.has(repoPath)) {
      return;
    }

    this.loadingWorktrees.add(repoPath);
    this.requestUpdate();

    try {
      const response = await fetch(`/api/worktrees?${new URLSearchParams({ repoPath })}`, {
        headers: this.authClient.getAuthHeader(),
      });

      if (response.ok) {
        const data = await response.json();
        this.repoWorktrees.set(repoPath, data.worktrees || []);
      } else {
        logger.error(`Failed to load worktrees for ${repoPath}`);
      }
    } catch (error) {
      logger.error('Error loading worktrees:', error);
    } finally {
      this.loadingWorktrees.delete(repoPath);
      this.requestUpdate();
    }
  }

  private toggleWorktreeDropdown(dropdownKey: string) {
    const isOpen = this.showWorktreeDropdown.get(dropdownKey) || false;

    // Create new maps to avoid intermediate states during update
    const newFollowDropdown = new Map<string, boolean>();
    const newWorktreeDropdown = new Map<string, boolean>();

    // Only set the clicked dropdown if it wasn't already open
    if (!isOpen) {
      newWorktreeDropdown.set(dropdownKey, true);
      // Extract repo path from dropdown key for loading
      const repoPath = dropdownKey.split(':')[0];
      // Load worktrees if not already loaded
      this.loadWorktreesForRepo(repoPath);
    }

    // Update state atomically
    this.showFollowDropdown = newFollowDropdown;
    this.showWorktreeDropdown = newWorktreeDropdown;

    this.requestUpdate();
  }

  private createSessionInWorktree(worktreePath: string) {
    // Close all dropdowns atomically
    this.showWorktreeDropdown = new Map<string, boolean>();
    this.requestUpdate();

    // Dispatch event to open create session dialog with pre-filled path
    const event = new CustomEvent('open-create-dialog', {
      detail: { workingDir: worktreePath },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  private renderWorktreeSelector(repoPath: string, sectionType: string = '') {
    const worktrees = this.repoWorktrees.get(repoPath) || [];
    const isLoading = this.loadingWorktrees.has(repoPath);
    const dropdownKey = `${repoPath}:${sectionType}`;
    const isDropdownOpen = this.showWorktreeDropdown.get(dropdownKey) || false;

    return html`
      <div class="relative">
        <button
          class="flex items-center gap-1 px-2 py-1 text-xs bg-bg-secondary hover:bg-bg-tertiary rounded-md border border-border transition-colors"
          @click=${() => this.toggleWorktreeDropdown(dropdownKey)}
          id="worktree-selector-${dropdownKey.replace(/[^a-zA-Z0-9]/g, '-')}"
          title="Worktrees"
        >
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span class="font-mono">${worktrees.length || 0}</span>
          ${
            isLoading
              ? html`<span class="animate-spin">⟳</span>`
              : html`
              <svg class="w-3 h-3 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}" 
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            `
          }
        </button>
        
        ${
          isDropdownOpen
            ? html`
          <div class="worktree-dropdown absolute right-0 mt-1 w-96 bg-bg-elevated border border-border rounded-md shadow-lg max-h-96 overflow-y-auto" style="z-index: ${Z_INDEX.BRANCH_SELECTOR_DROPDOWN}">
            ${
              worktrees.length === 0 && !isLoading
                ? html`<div class="px-3 py-2 text-xs text-text-muted">No worktrees found</div>`
                : html`
                <div class="py-1">
                  ${worktrees.map(
                    (worktree) => html`
                    <div class="border-b border-border last:border-b-0">
                      <div class="px-3 py-2">
                        <div class="flex items-center justify-between gap-2">
                          <div class="flex items-center gap-2 min-w-0 flex-1">
                            <svg class="w-3 h-3 text-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m9.632 4.684C18.114 15.938 18 15.482 18 15c0-.482.114-.938.316-1.342m0 2.684a3 3 0 110-2.684M15 9a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <div class="font-mono text-sm truncate">
                              ${worktree.branch.replace(/^refs\/heads\//, '')}
                            </div>
                            ${
                              worktree.detached
                                ? html`
                              <span class="text-[10px] px-1.5 py-0.5 bg-status-warning/20 text-status-warning rounded flex-shrink-0">
                                detached
                              </span>
                            `
                                : ''
                            }
                          </div>
                          <button
                            class="p-1 hover:bg-bg-elevated rounded transition-colors flex-shrink-0"
                            @click=${() => this.createSessionInWorktree(worktree.path)}
                            title="Create new session in this worktree"
                          >
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                            </svg>
                          </button>
                        </div>
                        <div class="text-[10px] text-text-muted truncate pl-5">${worktree.path}</div>
                      </div>
                    </div>
                  `
                  )}
                </div>
              `
            }
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  render() {
    // Group sessions by status and activity
    const activeSessions = this.sessions.filter(
      (session) => session.status === 'running' && session.activityStatus?.isActive !== false
    );
    const idleSessions = this.sessions.filter(
      (session) => session.status === 'running' && session.activityStatus?.isActive === false
    );
    const exitedSessions = this.sessions.filter((session) => session.status === 'exited');

    const hasActiveSessions = activeSessions.length > 0;
    const hasIdleSessions = idleSessions.length > 0;
    const hasExitedSessions = exitedSessions.length > 0;
    const showExitedSection = !this.hideExited && (hasIdleSessions || hasExitedSessions);

    // Track session index for numbering
    let sessionIndex = 0;

    return html`
      <div class="font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 focus:ring-offset-bg-primary rounded-lg" data-testid="session-list-container">
        <div class="p-4 pt-5">
        ${
          !hasActiveSessions && !hasIdleSessions && (!hasExitedSessions || this.hideExited)
            ? html`
              <div class="text-text-muted text-center py-8">
                ${
                  this.loading
                    ? 'Loading sessions...'
                    : this.hideExited && this.sessions.length > 0
                      ? html`
                        <div class="space-y-4 max-w-2xl mx-auto text-left">
                          <div class="text-lg font-semibold text-text">
                            No running sessions
                          </div>
                          <div class="text-sm text-text-muted">
                            There are exited sessions. Show them by toggling "Hide exited" above.
                          </div>
                        </div>
                      `
                      : html`
                        <div class="space-y-6 max-w-2xl mx-auto text-left">
                          <div class="text-lg font-semibold text-text">
                            No terminal sessions yet!
                          </div>

                          <div class="space-y-3">
                            <div class="text-sm text-text-muted">
                              Get started by using the
                              <code class="bg-bg-secondary px-2 py-1 rounded">vt</code> command
                              in your terminal:
                            </div>

                            <div
                              class="bg-bg-secondary p-4 rounded-lg font-mono text-xs space-y-2"
                            >
                              <div class="text-status-success">vt pnpm run dev</div>
                              <div class="text-text-muted pl-4"># Monitor your dev server</div>

                              <div class="text-status-success">vt claude --dangerously...</div>
                              <div class="text-text-muted pl-4">
                                # Keep an eye on AI agents
                              </div>

                              <div class="text-status-success">vt --shell</div>
                              <div class="text-text-muted pl-4">
                                # Open an interactive shell
                              </div>

                              <div class="text-status-success">vt python train.py</div>
                              <div class="text-text-muted pl-4">
                                # Watch long-running scripts
                              </div>
                            </div>
                          </div>

                          <div class="space-y-3 border-t border-border pt-4">
                            <div class="text-sm font-semibold text-text">
                              Haven't installed the CLI yet?
                            </div>
                            <div class="text-sm text-text-muted space-y-1">
                              <div>→ Click the VibeTunnel menu bar icon</div>
                              <div>→ Go to Settings → Advanced → Install CLI Tools</div>
                            </div>
                          </div>

                          <div class="text-xs text-text-muted mt-4">
                            Once installed, any command prefixed with
                            <code class="bg-bg-secondary px-1 rounded">vt</code> will appear
                            here, accessible from any browser at localhost:4020.
                          </div>
                        </div>
                      `
                }
              </div>
            `
            : html`
              <!-- Active Sessions -->
              ${
                hasActiveSessions
                  ? html`
                    <div class="mb-6 mt-2">
                      <h3 class="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
                        Active <span class="text-text-dim">(${activeSessions.length})</span>
                      </h3>
                      ${Array.from(this.groupSessionsByRepo(activeSessions)).map(
                        ([repoPath, repoSessions]) => html`
                          <div class="${repoPath ? 'mb-6 mt-6' : 'mb-4'}">
                            ${
                              repoPath
                                ? html`
                                  <repository-header
                                    .repoPath=${repoPath}
                                    .followMode=${this.repoFollowMode.get(repoPath)}
                                    .followModeSelector=${this.renderFollowModeSelector(repoPath, 'active')}
                                    .worktreeSelector=${this.renderWorktreeSelector(repoPath, 'active')}
                                  ></repository-header>
                                `
                                : ''
                            }
                            <div class="${this.compactMode ? '' : 'session-flex-responsive'} relative">
                              ${repeat(
                                repoSessions,
                                (session) => session.id,
                                (session) => {
                                  const currentIndex = ++sessionIndex;
                                  return html`
                    ${
                      this.compactMode
                        ? html`
                          <compact-session-card
                            .session=${session}
                            .authClient=${this.authClient}
                            .selected=${session.id === this.selectedSessionId}
                            .sessionType=${'active'}
                            .sessionNumber=${currentIndex}
                            @session-select=${this.handleSessionSelect}
                            @session-rename=${this.handleSessionRenamed}
                            @session-delete=${this.handleSessionKilled}
                          ></compact-session-card>
                        `
                        : html`
                          <!-- Full session card for main view -->
                          <session-card
                            .session=${session}
                            .authClient=${this.authClient}
                            .selected=${session.id === this.selectedSessionId}
                            @session-select=${this.handleSessionSelect}
                            @session-killed=${this.handleSessionKilled}
                            @session-kill-error=${this.handleSessionKillError}
                            @session-renamed=${this.handleSessionRenamed}
                            @session-rename-error=${this.handleSessionRenameError}
                          >
                          </session-card>
                        `
                    }
                  `;
                                }
                              )}
                            </div>
                          </div>
                        `
                      )}
                    </div>
                  `
                  : ''
              }
              
              <!-- Idle Sessions -->
              ${
                hasIdleSessions
                  ? html`
                    <div class="mb-6 ${!hasActiveSessions ? 'mt-2' : ''}">
                      <h3 class="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
                        Idle <span class="text-text-dim">(${idleSessions.length})</span>
                      </h3>
                      ${Array.from(this.groupSessionsByRepo(idleSessions)).map(
                        ([repoPath, repoSessions]) => html`
                          <div class="${repoPath ? 'mb-6 mt-6' : 'mb-4'}">
                            ${
                              repoPath
                                ? html`
                                  <repository-header
                                    .repoPath=${repoPath}
                                    .followMode=${this.repoFollowMode.get(repoPath)}
                                    .followModeSelector=${this.renderFollowModeSelector(repoPath, 'idle')}
                                    .worktreeSelector=${this.renderWorktreeSelector(repoPath, 'idle')}
                                  ></repository-header>
                                `
                                : ''
                            }
                            <div class="${this.compactMode ? '' : 'session-flex-responsive'} relative">
                              ${repeat(
                                repoSessions,
                                (session) => session.id,
                                (session) => {
                                  const currentIndex = ++sessionIndex;
                                  return html`
                            ${
                              this.compactMode
                                ? html`
                                  <compact-session-card
                                    .session=${session}
                                    .authClient=${this.authClient}
                                    .selected=${session.id === this.selectedSessionId}
                                    .sessionType=${'idle'}
                                    .sessionNumber=${currentIndex}
                                    @session-select=${this.handleSessionSelect}
                                    @session-rename=${this.handleSessionRenamed}
                                    @session-delete=${this.handleSessionKilled}
                                  ></compact-session-card>
                                `
                                : html`
                                  <!-- Full session card for main view -->
                                  <session-card
                                    .session=${session}
                                    .authClient=${this.authClient}
                                    .selected=${session.id === this.selectedSessionId}
                                    @session-select=${this.handleSessionSelect}
                                    @session-killed=${this.handleSessionKilled}
                                    @session-kill-error=${this.handleSessionKillError}
                                    @session-renamed=${this.handleSessionRenamed}
                                    @session-rename-error=${this.handleSessionRenameError}
                                          >
                                  </session-card>
                                `
                            }
                          `;
                                }
                              )}
                            </div>
                          </div>
                        `
                      )}
                    </div>
                  `
                  : ''
              }
              
              <!-- Exited Sessions -->
              ${
                showExitedSection && hasExitedSessions
                  ? html`
                    <div class="${!hasActiveSessions && !hasIdleSessions ? 'mt-2' : ''}">
                      <h3 class="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
                        Exited <span class="text-text-dim">(${exitedSessions.length})</span>
                      </h3>
                      ${Array.from(this.groupSessionsByRepo(exitedSessions)).map(
                        ([repoPath, repoSessions]) => html`
                          <div class="${repoPath ? 'mb-6 mt-6' : 'mb-4'}">
                            ${
                              repoPath
                                ? html`
                                  <repository-header
                                    .repoPath=${repoPath}
                                    .followMode=${this.repoFollowMode.get(repoPath)}
                                    .followModeSelector=${this.renderFollowModeSelector(repoPath, 'exited')}
                                    .worktreeSelector=${this.renderWorktreeSelector(repoPath, 'exited')}
                                  ></repository-header>
                                `
                                : ''
                            }
                            <div class="${this.compactMode ? '' : 'session-flex-responsive'} relative">
                              ${repeat(
                                repoSessions,
                                (session) => session.id,
                                (session) => {
                                  const currentIndex = ++sessionIndex;
                                  return html`
                            ${
                              this.compactMode
                                ? html`
                                  <compact-session-card
                                    .session=${session}
                                    .authClient=${this.authClient}
                                    .selected=${session.id === this.selectedSessionId}
                                    .sessionType=${'exited'}
                                    .sessionNumber=${currentIndex}
                                    @session-select=${this.handleSessionSelect}
                                    @session-cleanup=${this.handleSessionKilled}
                                  ></compact-session-card>
                                `
                                : html`
                                  <!-- Full session card for main view -->
                                  <session-card
                                    .session=${session}
                                    .authClient=${this.authClient}
                                    .selected=${session.id === this.selectedSessionId}
                                    @session-select=${this.handleSessionSelect}
                                    @session-killed=${this.handleSessionKilled}
                                    @session-kill-error=${this.handleSessionKillError}
                                    @session-renamed=${this.handleSessionRenamed}
                                    @session-rename-error=${this.handleSessionRenameError}
                                          >
                                  </session-card>
                                `
                            }
                          `;
                                }
                              )}
                            </div>
                          </div>
                        `
                      )}
                    </div>
                  `
                  : ''
              }
            `
        }
        </div>

        ${this.renderExitedControls()}
      </div>
    `;
  }

  private renderExitedControls() {
    const exitedSessions = this.sessions.filter((session) => session.status === 'exited');
    const runningSessions = this.sessions.filter((session) => session.status === 'running');
    const activeSessions = runningSessions.filter((s) => s.activityStatus?.isActive !== false);
    const idleSessions = runningSessions.filter((s) => s.activityStatus?.isActive === false);

    // If no sessions at all, don't show controls
    if (this.sessions.length === 0) return '';

    return html`
      <div class="sticky bottom-0 border-t border-border bg-bg-secondary shadow-lg" style="z-index: ${Z_INDEX.SESSION_LIST_BOTTOM_BAR};">
        <div class="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <!-- Status group (left side) -->
          <div class="flex flex-wrap items-center gap-3 sm:gap-4">
            <!-- Session counts -->
            <div class="flex items-center gap-2 sm:gap-3 font-mono text-xs">
              ${
                activeSessions.length > 0
                  ? html`
                <span class="text-status-success whitespace-nowrap">${activeSessions.length} Active</span>
              `
                  : ''
              }
              ${
                idleSessions.length > 0
                  ? html`
                <span class="text-text-muted whitespace-nowrap">${idleSessions.length} Idle</span>
              `
                  : ''
              }
              ${
                exitedSessions.length > 0
                  ? html`
                <span class="text-text-dim whitespace-nowrap">${exitedSessions.length} Exited</span>
              `
                  : ''
              }
            </div>

            <!-- Show exited toggle (only if there are exited sessions) -->
            ${
              exitedSessions.length > 0
                ? html`
              <label class="flex items-center gap-2 cursor-pointer group whitespace-nowrap">
                <input
                  type="checkbox"
                  class="session-toggle-checkbox"
                  ?checked=${!this.hideExited}
                  @change=${(e: Event) => {
                    const checked = (e.target as HTMLInputElement).checked;
                    this.dispatchEvent(new CustomEvent('hide-exited-change', { detail: !checked }));
                  }}
                  id="show-exited-toggle"
                  data-testid="show-exited-toggle"
                />
                <span class="text-xs text-text-muted group-hover:text-text font-mono select-none">
                  Show
                </span>
              </label>
            `
                : ''
            }
          </div>

          <!-- Actions group (right side) -->
          <div class="flex items-center gap-2 ml-auto">
            <!-- Clean button (only visible when showing exited sessions) -->
            ${
              !this.hideExited && exitedSessions.length > 0
                ? html`
              <button
                class="font-mono text-xs px-3 py-1.5 rounded-md border transition-all duration-200 border-status-warning bg-status-warning bg-opacity-10 text-status-warning hover:bg-opacity-20 hover:shadow-glow-warning-sm active:scale-95 disabled:opacity-50"
                id="clean-exited-button"
                @click=${this.handleCleanupExited}
                ?disabled=${this.cleaningExited}
                data-testid="clean-exited-button"
              >
                ${
                  this.cleaningExited
                    ? html`
                  <span class="flex items-center gap-1">
                    <span class="animate-spin">⟳</span>
                    Cleaning...
                  </span>
                `
                    : 'Clean'
                }
              </button>
            `
                : ''
            }
            
            <!-- Kill All button (always visible if there are running sessions) -->
            ${
              runningSessions.length > 0
                ? html`
              <button
                class="font-mono text-xs px-3 py-1.5 rounded-md border transition-all duration-200 border-status-error bg-status-error bg-opacity-10 text-status-error hover:bg-opacity-20 hover:shadow-glow-error-sm active:scale-95"
                id="kill-all-button"
                @click=${() => this.dispatchEvent(new CustomEvent('kill-all-sessions'))}
                data-testid="kill-all-button"
              >
                Kill All
              </button>
            `
                : ''
            }
          </div>
        </div>
      </div>
    `;
  }
}
