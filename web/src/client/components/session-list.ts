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
import type { AuthClient } from '../services/auth-client.js';
import './session-card.js';
import './inline-edit.js';
import { getBaseRepoName } from '../../shared/utils/git.js';
import { formatSessionDuration } from '../../shared/utils/time.js';
import { sessionActionService } from '../services/session-action-service.js';
import { sendAIPrompt } from '../utils/ai-sessions.js';
import { Z_INDEX } from '../utils/constants.js';
import { createLogger } from '../utils/logger.js';
import { formatPathForDisplay } from '../utils/path-utils.js';

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

  private previousRunningCount = 0;

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
        this.showFollowDropdown.clear();
        this.showWorktreeDropdown.clear();
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
  private handleRefresh() {
    this.dispatchEvent(new CustomEvent('refresh'));
  }

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

  private async handleRename(sessionId: string, newName: string) {
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...this.authClient.getAuthHeader(),
        },
        body: JSON.stringify({ name: newName }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        logger.error('Failed to rename session', { errorData, sessionId });
        throw new Error(`Rename failed: ${response.status}`);
      }

      // Update the local session object
      const sessionIndex = this.sessions.findIndex((s) => s.id === sessionId);
      if (sessionIndex >= 0) {
        this.sessions[sessionIndex] = { ...this.sessions[sessionIndex], name: newName };
        this.requestUpdate();
      }

      logger.debug(`Session ${sessionId} renamed to: ${newName}`);
    } catch (error) {
      logger.error('Error renaming session', { error, sessionId });

      // Show error to user
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: `Failed to rename session: ${error instanceof Error ? error.message : 'Unknown error'}`,
        })
      );
    }
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

  private async handleDeleteSession(sessionId: string) {
    await sessionActionService.deleteSessionById(sessionId, {
      authClient: this.authClient,
      callbacks: {
        onError: (errorMessage) => {
          this.handleSessionKillError({
            detail: {
              sessionId,
              error: errorMessage,
            },
          } as CustomEvent);
        },
        onSuccess: () => {
          // Session killed successfully - update local state and trigger refresh
          this.handleSessionKilled({ detail: { sessionId } } as CustomEvent);
        },
      },
    });
  }

  private async handleSendAIPrompt(sessionId: string) {
    try {
      await sendAIPrompt(sessionId, this.authClient);
    } catch (error) {
      logger.error('Failed to send AI prompt', error);
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: `Failed to send AI prompt: ${error instanceof Error ? error.message : 'Unknown error'}`,
        })
      );
    }
  }

  public async handleCleanupExited() {
    if (this.cleaningExited) return;

    this.cleaningExited = true;
    this.requestUpdate();

    try {
      const response = await fetch('/api/cleanup-exited', {
        method: 'POST',
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

  private renderFollowModeIndicator(repoPath: string) {
    const followMode = this.repoFollowMode.get(repoPath);
    if (!followMode) return '';

    return html`
      <span class="text-[10px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded flex items-center gap-1" 
            title="Following worktree: ${followMode}">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
        ${followMode}
      </span>
    `;
  }

  private renderGitChanges(session: Session) {
    if (!session.gitRepoPath) return '';

    const changes = [];

    // Show ahead/behind counts
    if (session.gitAheadCount && session.gitAheadCount > 0) {
      changes.push(html`<span class="text-status-success">↑${session.gitAheadCount}</span>`);
    }
    if (session.gitBehindCount && session.gitBehindCount > 0) {
      changes.push(html`<span class="text-status-warning">↓${session.gitBehindCount}</span>`);
    }

    // Show uncommitted changes indicator
    if (session.gitHasChanges) {
      changes.push(html`<span class="text-status-warning">●</span>`);
    }

    if (changes.length === 0) return '';

    return html`
      <div class="flex items-center gap-1 text-xs font-mono flex-shrink-0">
        ${changes}
      </div>
    `;
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
    this.showFollowDropdown.delete(repoPath);
    this.requestUpdate();

    try {
      const response = await fetch('/api/repositories/follow-mode', {
        method: 'POST',
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

  private toggleFollowDropdown(repoPath: string) {
    const isOpen = this.showFollowDropdown.get(repoPath) || false;

    // Close all dropdowns
    this.showFollowDropdown.clear();
    this.showWorktreeDropdown.clear();

    if (!isOpen) {
      this.showFollowDropdown.set(repoPath, true);
      // Load follow mode if not already loaded
      this.loadFollowModeForRepo(repoPath);
    }

    this.requestUpdate();
  }

  private renderFollowModeSelector(repoPath: string) {
    const worktrees = this.repoWorktrees.get(repoPath) || [];
    const followMode = this.repoFollowMode.get(repoPath);
    const isLoading = this.loadingFollowMode.has(repoPath);
    const isDropdownOpen = this.showFollowDropdown.get(repoPath) || false;

    // Only show if there are worktrees
    if (worktrees.length === 0) {
      return html``;
    }

    const displayText = followMode ? `Following: ${followMode}` : 'Standalone';

    return html`
      <div class="relative">
        <button
          class="flex items-center gap-1 px-2 py-1 text-xs bg-bg-secondary hover:bg-bg-tertiary rounded-md border border-border transition-colors"
          @click=${() => this.toggleFollowDropdown(repoPath)}
          id="follow-selector-${repoPath.replace(/[^a-zA-Z0-9]/g, '-')}"
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
                class="w-full text-left px-3 py-2 text-xs hover:bg-bg-secondary transition-colors flex items-center justify-between"
                @click=${() => this.handleFollowModeChange(repoPath, undefined)}
              >
                <span class="font-mono ${!followMode ? 'text-accent-primary font-semibold' : ''}">Standalone</span>
                ${!followMode ? html`<span class="text-accent-primary">✓</span>` : ''}
              </button>
              
              ${worktrees.map(
                (worktree) => html`
                <button
                  class="w-full text-left px-3 py-2 text-xs hover:bg-bg-secondary transition-colors flex items-center justify-between"
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

  private toggleWorktreeDropdown(repoPath: string) {
    const isOpen = this.showWorktreeDropdown.get(repoPath) || false;

    // Close all dropdowns
    this.showFollowDropdown.clear();
    this.showWorktreeDropdown.clear();

    if (!isOpen) {
      this.showWorktreeDropdown.set(repoPath, true);
      // Load worktrees if not already loaded
      this.loadWorktreesForRepo(repoPath);
    }

    this.requestUpdate();
  }

  private async createSessionInWorktree(worktreePath: string) {
    this.showWorktreeDropdown.clear();
    this.requestUpdate();

    try {
      // Create a new session in the worktree
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authClient.getAuthHeader(),
        },
        body: JSON.stringify({
          workingDir: worktreePath,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create session');
      }

      const event = new CustomEvent('show-toast', {
        detail: { message: 'Created new session in worktree', type: 'success' },
        bubbles: true,
        composed: true,
      });
      this.dispatchEvent(event);

      // Refresh sessions
      this.dispatchEvent(new CustomEvent('refresh'));
    } catch (error) {
      logger.error('Error creating session in worktree:', error);
      const event = new CustomEvent('show-toast', {
        detail: { message: 'Failed to create session', type: 'error' },
        bubbles: true,
        composed: true,
      });
      this.dispatchEvent(event);
    }
  }

  private renderWorktreeSelector(repoPath: string) {
    const worktrees = this.repoWorktrees.get(repoPath) || [];
    const isLoading = this.loadingWorktrees.has(repoPath);
    const isDropdownOpen = this.showWorktreeDropdown.get(repoPath) || false;

    return html`
      <div class="relative">
        <button
          class="flex items-center gap-1 px-2 py-1 text-xs bg-bg-secondary hover:bg-bg-tertiary rounded-md border border-border transition-colors"
          @click=${() => this.toggleWorktreeDropdown(repoPath)}
          id="worktree-selector-${repoPath.replace(/[^a-zA-Z0-9]/g, '-')}"
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
                        <div class="flex items-center justify-between mb-1">
                          <div class="font-mono text-text">${worktree.branch}</div>
                          ${
                            worktree.detached
                              ? html`
                            <span class="text-[10px] px-1.5 py-0.5 bg-status-warning/20 text-status-warning rounded">
                              detached
                            </span>
                          `
                              : ''
                          }
                        </div>
                        <div class="text-[10px] text-text-muted truncate mb-2">${worktree.path}</div>
                        <div class="flex gap-2">
                          <button
                            class="flex-1 px-2 py-1 text-[10px] bg-bg-secondary hover:bg-bg-tertiary border border-border rounded transition-colors"
                            @click=${() => this.createSessionInWorktree(worktree.path)}
                            title="Create new session in this worktree"
                          >
                            <svg class="w-3 h-3 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                            </svg>
                            New Session
                          </button>
                        </div>
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
                          <div class="${repoPath ? 'mb-6 mt-6' : ''}">
                            ${
                              repoPath
                                ? html`
                                  <div class="flex items-center justify-between mb-3">
                                    <div class="flex items-center gap-2">
                                      <svg class="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                                          d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m9.632 4.684C18.114 15.938 18 15.482 18 15c0-.482.114-.938.316-1.342m0 2.684a3 3 0 110-2.684M15 9a3 3 0 11-6 0 3 3 0 016 0z" />
                                      </svg>
                                      <h4 class="text-sm font-medium text-text-muted flex items-center gap-2">
                                        ${this.getRepoName(repoPath)}
                                        ${this.renderFollowModeIndicator(repoPath)}
                                      </h4>
                                    </div>
                                    <div class="flex items-center gap-2">
                                      ${this.renderFollowModeSelector(repoPath)}
                                      ${this.renderWorktreeSelector(repoPath)}
                                    </div>
                                  </div>
                                `
                                : ''
                            }
                            <div class="${this.compactMode ? 'space-y-2' : 'session-flex-responsive'} relative">
                              ${repeat(
                                repoSessions,
                                (session) => session.id,
                                (session) => html`
                    ${
                      this.compactMode
                        ? html`
                          <!-- Enhanced compact list item for sidebar -->
                          <div
                            class="group flex items-center gap-3 p-3 rounded-lg cursor-pointer ${
                              session.id === this.selectedSessionId
                                ? 'bg-bg-elevated border border-accent-primary shadow-card-hover'
                                : 'bg-bg-secondary border border-border hover:bg-bg-tertiary hover:border-border-light hover:shadow-card'
                            }"
                            @click=${() =>
                              this.handleSessionSelect({ detail: session } as CustomEvent)}
                          >
                            <!-- Enhanced activity indicator with pulse animation -->
                            <div class="relative flex-shrink-0">
                              <div
                                class="w-2.5 h-2.5 rounded-full ${
                                  session.status === 'running'
                                    ? session.activityStatus?.specificStatus
                                      ? 'bg-status-warning animate-pulse-primary' // Claude active - amber with pulse
                                      : session.activityStatus?.isActive
                                        ? 'bg-status-success' // Generic active
                                        : 'bg-status-success ring-1 ring-status-success ring-opacity-50' // Idle (subtle outline)
                                    : 'bg-status-error'
                                }"
                                title="${
                                  session.status === 'running' && session.activityStatus
                                    ? session.activityStatus.specificStatus
                                      ? `Active: ${session.activityStatus.specificStatus.app}`
                                      : session.activityStatus.isActive
                                        ? 'Active'
                                        : 'Idle'
                                    : session.status
                                }"
                              ></div>
                              <!-- Pulse ring for active sessions -->
                              ${
                                session.status === 'running' && session.activityStatus?.isActive
                                  ? html`<div class="absolute inset-0 w-2.5 h-2.5 rounded-full bg-status-success opacity-30 animate-ping"></div>`
                                  : ''
                              }
                            </div>
                            
                            <!-- Elegant divider line -->
                            <div class="w-px h-8 bg-gradient-to-b from-transparent via-border to-transparent"></div>
                            
                            <!-- Session content -->
                            <div class="flex-1 min-w-0">
                              <div class="flex items-center gap-2 min-w-0">
                                <div
                                  class="text-sm font-mono truncate ${
                                    session.id === this.selectedSessionId
                                      ? 'text-accent-primary font-medium'
                                      : 'text-text group-hover:text-accent-primary transition-colors'
                                  }"
                                >
                                  <inline-edit
                                    .value=${
                                      session.name ||
                                      (Array.isArray(session.command)
                                        ? session.command.join(' ')
                                        : session.command)
                                    }
                                    .placeholder=${
                                      Array.isArray(session.command)
                                        ? session.command.join(' ')
                                        : session.command
                                    }
                                    .onSave=${(newName: string) => this.handleRename(session.id, newName)}
                                  ></inline-edit>
                                </div>
                                <!-- Git changes indicator -->
                                ${this.renderGitChanges(session)}
                              </div>
                              <div class="text-xs text-text-muted truncate flex items-center gap-1">
                                ${(() => {
                                  // Build the path line with Git info
                                  const parts = [];

                                  // Add activity status if present
                                  if (session.activityStatus?.specificStatus) {
                                    parts.push(
                                      html`<span class="text-status-warning flex-shrink-0">${session.activityStatus.specificStatus.status}</span>`
                                    );
                                  }

                                  // Add path
                                  parts.push(
                                    html`<span class="truncate">${formatPathForDisplay(session.workingDir)}</span>`
                                  );

                                  // Add Git branch if present
                                  if (session.gitBranch) {
                                    parts.push(
                                      html`<span class="text-status-success font-mono">${session.gitBranch}</span>`
                                    );
                                    if (session.gitIsWorktree) {
                                      parts.push(html`<span class="text-purple-400">⎇</span>`);
                                    }
                                  }

                                  // Join parts with separator
                                  return parts.map((part, index) => {
                                    if (index === 0) return part;
                                    return html`<span class="text-text-muted/50">·</span>${part}`;
                                  });
                                })()}
                              </div>
                            </div>
                            
                            <!-- Right side: duration and close button -->
                            <div class="relative flex items-center flex-shrink-0 gap-1">
                              ${
                                'ontouchstart' in window
                                  ? html`
                                    <!-- Touch devices: Close button left of time -->
                                    ${
                                      session.status === 'running' || session.status === 'exited'
                                        ? html`
                                          <button
                                            class="btn-ghost text-status-error p-1.5 rounded-md transition-all hover:bg-elevated hover:shadow-sm hover:scale-110"
                                            @click=${async (e: Event) => {
                                              e.stopPropagation();
                                              // Kill the session
                                              try {
                                                await this.handleDeleteSession(session.id);
                                              } catch (error) {
                                                logger.error('Failed to kill session', error);
                                              }
                                            }}
                                            title="Kill Session"
                                          >
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                            </svg>
                                          </button>
                                        `
                                        : ''
                                    }
                                    <div class="text-xs text-text-muted font-mono">
                                      ${session.startedAt ? formatSessionDuration(session.startedAt, session.status === 'exited' ? session.lastModified : undefined) : ''}
                                    </div>
                                  `
                                  : html`
                                    <!-- Desktop: Time that hides on hover -->
                                    <div class="text-xs text-text-muted font-mono transition-opacity group-hover:opacity-0">
                                      ${session.startedAt ? formatSessionDuration(session.startedAt, session.status === 'exited' ? session.lastModified : undefined) : ''}
                                    </div>
                                    
                                    <!-- Desktop: Buttons show on hover -->
                                    <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity absolute right-0">
                                      <!-- Close button -->
                                      ${
                                        session.status === 'running' || session.status === 'exited'
                                          ? html`
                                            <button
                                              class="btn-ghost text-status-error p-1.5 rounded-md transition-all hover:bg-elevated hover:shadow-sm hover:scale-110"
                                              @click=${async (e: Event) => {
                                                e.stopPropagation();
                                                // Kill the session
                                                try {
                                                  await this.handleDeleteSession(session.id);
                                                } catch (error) {
                                                  logger.error('Failed to kill session', error);
                                                }
                                              }}
                                              title="Kill Session"
                                            >
                                              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                              </svg>
                                            </button>
                                          `
                                          : ''
                                      }
                                    </div>
                                  `
                              }
                            </div>
                          </div>
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
                  `
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
                          <div class="${repoPath ? 'mb-6 mt-6' : ''}">
                            ${
                              repoPath
                                ? html`
                                  <div class="flex items-center justify-between mb-3">
                                    <div class="flex items-center gap-2">
                                      <svg class="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                                          d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m9.632 4.684C18.114 15.938 18 15.482 18 15c0-.482.114-.938.316-1.342m0 2.684a3 3 0 110-2.684M15 9a3 3 0 11-6 0 3 3 0 016 0z" />
                                      </svg>
                                      <h4 class="text-sm font-medium text-text-muted flex items-center gap-2">
                                        ${this.getRepoName(repoPath)}
                                        ${this.renderFollowModeIndicator(repoPath)}
                                      </h4>
                                    </div>
                                    <div class="flex items-center gap-2">
                                      ${this.renderFollowModeSelector(repoPath)}
                                      ${this.renderWorktreeSelector(repoPath)}
                                    </div>
                                  </div>
                                `
                                : ''
                            }
                            <div class="${this.compactMode ? 'space-y-2' : 'session-flex-responsive'} relative">
                              ${repeat(
                                repoSessions,
                                (session) => session.id,
                                (session) => html`
                            ${
                              this.compactMode
                                ? html`
                                  <!-- Enhanced compact list item for sidebar -->
                                  <div
                                    class="group flex items-center gap-3 p-3 rounded-lg cursor-pointer ${
                                      session.id === this.selectedSessionId
                                        ? 'bg-bg-elevated border border-accent-primary shadow-card-hover'
                                        : 'bg-bg-secondary border border-border hover:bg-bg-tertiary hover:border-border-light hover:shadow-card'
                                    }"
                                    @click=${() =>
                                      this.handleSessionSelect({ detail: session } as CustomEvent)}
                                  >
                                    <!-- Status indicator for idle sessions -->
                                    <div class="relative flex-shrink-0">
                                      <div class="w-2.5 h-2.5 rounded-full bg-status-success ring-1 ring-status-success ring-opacity-50"
                                           title="Idle"></div>
                                    </div>
                                    
                                    <!-- Elegant divider line -->
                                    <div class="w-px h-8 bg-gradient-to-b from-transparent via-border to-transparent"></div>
                                    
                                    <!-- Session content -->
                                    <div class="flex-1 min-w-0">
                                      <div class="flex items-center gap-2 min-w-0">
                                        <div
                                          class="text-sm font-mono truncate ${
                                            session.id === this.selectedSessionId
                                              ? 'text-accent-primary font-medium'
                                              : 'text-text group-hover:text-accent-primary transition-colors'
                                          }"
                                          title="${
                                            session.name ||
                                            (Array.isArray(session.command)
                                              ? session.command.join(' ')
                                              : session.command)
                                          }"
                                        >
                                          ${
                                            session.name ||
                                            (Array.isArray(session.command)
                                              ? session.command.join(' ')
                                              : session.command)
                                          }
                                        </div>
                                        <!-- Git changes indicator -->
                                        ${this.renderGitChanges(session)}
                                      </div>
                                      <div class="text-xs text-text-dim truncate flex items-center gap-1">
                                        <span class="truncate">${formatPathForDisplay(session.workingDir)}</span>
                                        ${
                                          session.gitBranch
                                            ? html`
                                            <span class="text-text-muted/50">·</span>
                                            <span class="text-status-success font-mono">${session.gitBranch}</span>
                                            ${session.gitIsWorktree ? html`<span class="text-purple-400">⎇</span>` : ''}
                                          `
                                            : ''
                                        }
                                      </div>
                                    </div>
                                    
                                    <!-- Right side: duration and close button -->
                                    <div class="relative flex items-center flex-shrink-0 gap-1">
                                      ${
                                        'ontouchstart' in window
                                          ? html`
                                            <!-- Touch devices: Close button left of time -->
                                            <button
                                              class="btn-ghost text-status-error p-1.5 rounded-md transition-all hover:bg-elevated hover:shadow-sm hover:scale-110"
                                              @click=${async (e: Event) => {
                                                e.stopPropagation();
                                                // Kill the session
                                                try {
                                                  await this.handleDeleteSession(session.id);
                                                } catch (error) {
                                                  logger.error('Failed to kill session', error);
                                                }
                                              }}
                                              title="Kill Session"
                                            >
                                              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                              </svg>
                                            </button>
                                            <div class="text-xs text-text-dim font-mono">
                                              ${session.startedAt ? formatSessionDuration(session.startedAt, session.status === 'exited' ? session.lastModified : undefined) : ''}
                                            </div>
                                          `
                                          : html`
                                            <!-- Desktop: Time that hides on hover -->
                                            <div class="text-xs text-text-dim font-mono transition-opacity group-hover:opacity-0">
                                              ${session.startedAt ? formatSessionDuration(session.startedAt, session.status === 'exited' ? session.lastModified : undefined) : ''}
                                            </div>
                                            
                                            <!-- Desktop: Buttons show on hover -->
                                            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity absolute right-0">
                                              <!-- Kill button -->
                                              <button
                                                class="btn-ghost text-status-error p-1.5 rounded-md transition-all hover:bg-elevated hover:shadow-sm hover:scale-110"
                                                @click=${async (e: Event) => {
                                                  e.stopPropagation();
                                                  // Kill the session
                                                  try {
                                                    await this.handleDeleteSession(session.id);
                                                  } catch (error) {
                                                    logger.error('Failed to kill session', error);
                                                  }
                                                }}
                                                title="Kill Session"
                                              >
                                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                                </svg>
                                              </button>
                                            </div>
                                          `
                                      }
                                    </div>
                                  </div>
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
                          `
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
                          <div class="${repoPath ? 'mb-6 mt-6' : ''}">
                            ${
                              repoPath
                                ? html`
                                  <div class="flex items-center justify-between mb-3">
                                    <div class="flex items-center gap-2">
                                      <svg class="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                                          d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m9.632 4.684C18.114 15.938 18 15.482 18 15c0-.482.114-.938.316-1.342m0 2.684a3 3 0 110-2.684M15 9a3 3 0 11-6 0 3 3 0 016 0z" />
                                      </svg>
                                      <h4 class="text-sm font-medium text-text-muted flex items-center gap-2">
                                        ${this.getRepoName(repoPath)}
                                        ${this.renderFollowModeIndicator(repoPath)}
                                      </h4>
                                    </div>
                                    <div class="flex items-center gap-2">
                                      ${this.renderFollowModeSelector(repoPath)}
                                      ${this.renderWorktreeSelector(repoPath)}
                                    </div>
                                  </div>
                                `
                                : ''
                            }
                            <div class="${this.compactMode ? 'space-y-2' : 'session-flex-responsive'} relative">
                              ${repeat(
                                repoSessions,
                                (session) => session.id,
                                (session) => html`
                            ${
                              this.compactMode
                                ? html`
                                  <!-- Enhanced compact list item for sidebar -->
                                  <div
                                    class="group flex items-center gap-3 p-3 rounded-lg cursor-pointer ${
                                      session.id === this.selectedSessionId
                                        ? 'bg-bg-elevated border border-accent-primary shadow-card-hover'
                                        : 'bg-bg-secondary border border-border hover:bg-bg-tertiary hover:border-border-light hover:shadow-card opacity-75'
                                    }"
                                    @click=${() =>
                                      this.handleSessionSelect({ detail: session } as CustomEvent)}
                                  >
                                    <!-- Status indicator -->
                                    <div class="relative flex-shrink-0">
                                      <div class="w-2.5 h-2.5 rounded-full bg-status-warning"></div>
                                    </div>
                                    
                                    <!-- Elegant divider line -->
                                    <div class="w-px h-8 bg-gradient-to-b from-transparent via-border to-transparent"></div>
                                    
                                    <!-- Session content -->
                                    <div class="flex-1 min-w-0">
                                      <div class="flex items-center gap-2 min-w-0">
                                        <div
                                          class="text-sm font-mono truncate ${
                                            session.id === this.selectedSessionId
                                              ? 'text-accent-primary font-medium'
                                              : 'text-text-muted group-hover:text-text transition-colors'
                                          }"
                                          title="${
                                            session.name ||
                                            (Array.isArray(session.command)
                                              ? session.command.join(' ')
                                              : session.command)
                                          }"
                                        >
                                          ${
                                            session.name ||
                                            (Array.isArray(session.command)
                                              ? session.command.join(' ')
                                              : session.command)
                                          }
                                        </div>
                                        <!-- Git changes indicator -->
                                        ${this.renderGitChanges(session)}
                                      </div>
                                      <div class="text-xs text-text-dim truncate flex items-center gap-1">
                                        <span class="truncate">${formatPathForDisplay(session.workingDir)}</span>
                                        ${
                                          session.gitBranch
                                            ? html`
                                            <span class="text-text-muted/50">·</span>
                                            <span class="text-status-success font-mono">${session.gitBranch}</span>
                                            ${session.gitIsWorktree ? html`<span class="text-purple-400">⎇</span>` : ''}
                                          `
                                            : ''
                                        }
                                      </div>
                                    </div>
                                    
                                    <!-- Right side: duration and close button -->
                                    <div class="relative flex items-center flex-shrink-0 gap-1">
                                      ${
                                        'ontouchstart' in window
                                          ? html`
                                            <!-- Touch devices: Close button left of time -->
                                            <button
                                              class="btn-ghost text-text-muted p-1.5 rounded-md transition-all hover:text-status-warning hover:bg-bg-elevated hover:shadow-sm"
                                              @click=${async (e: Event) => {
                                                e.stopPropagation();
                                                try {
                                                  const response = await fetch(
                                                    `/api/sessions/${session.id}/cleanup`,
                                                    {
                                                      method: 'DELETE',
                                                      headers: this.authClient.getAuthHeader(),
                                                    }
                                                  );
                                                  if (response.ok) {
                                                    this.handleSessionKilled({
                                                      detail: { sessionId: session.id },
                                                    } as CustomEvent);
                                                  }
                                                } catch (error) {
                                                  logger.error('Failed to clean up session', error);
                                                }
                                              }}
                                              title="Clean up session"
                                            >
                                              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                              </svg>
                                            </button>
                                            <div class="text-xs text-text-dim font-mono">
                                              ${session.startedAt ? formatSessionDuration(session.startedAt, session.status === 'exited' ? session.lastModified : undefined) : ''}
                                            </div>
                                          `
                                          : html`
                                            <!-- Desktop: Time that hides on hover -->
                                            <div class="text-xs text-text-dim font-mono transition-opacity group-hover:opacity-0">
                                              ${session.startedAt ? formatSessionDuration(session.startedAt, session.status === 'exited' ? session.lastModified : undefined) : ''}
                                            </div>
                                            
                                            <!-- Desktop: Buttons show on hover -->
                                            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity absolute right-0">
                                              <!-- Clean up button -->
                                              <button
                                                class="btn-ghost text-text-muted p-1.5 rounded-md transition-all hover:text-status-warning hover:bg-bg-elevated hover:shadow-sm"
                                                @click=${async (e: Event) => {
                                                  e.stopPropagation();
                                                  try {
                                                    const response = await fetch(
                                                      `/api/sessions/${session.id}/cleanup`,
                                                      {
                                                        method: 'DELETE',
                                                        headers: this.authClient.getAuthHeader(),
                                                      }
                                                    );
                                                    if (response.ok) {
                                                      this.handleSessionKilled({
                                                        detail: { sessionId: session.id },
                                                      } as CustomEvent);
                                                    }
                                                  } catch (error) {
                                                    logger.error(
                                                      'Failed to clean up session',
                                                      error
                                                    );
                                                  }
                                                }}
                                                title="Clean up session"
                                              >
                                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                                </svg>
                                              </button>
                                            </div>
                                          `
                                      }
                                    </div>
                                  </div>
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
                          `
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

    // If no exited sessions and no running sessions, don't show controls
    if (exitedSessions.length === 0 && runningSessions.length === 0) return '';

    return html`
      <div class="sticky bottom-0 border-t border-border bg-bg-secondary p-3 flex flex-wrap gap-2 shadow-lg" style="z-index: ${Z_INDEX.SESSION_LIST_BOTTOM_BAR};">
        <!-- Control buttons with consistent styling -->
        ${
          exitedSessions.length > 0
            ? html`
                <!-- Show/Hide Exited button -->
                <button
                  class="font-mono text-xs px-4 py-2 rounded-lg border transition-all duration-200 ${
                    this.hideExited
                      ? 'border-border bg-bg-elevated text-text-muted hover:bg-surface-hover hover:text-accent-primary hover:border-accent-primary hover:shadow-sm active:scale-95'
                      : 'border-accent-primary bg-accent-primary bg-opacity-10 text-accent-primary hover:bg-opacity-20 hover:shadow-glow-primary-sm active:scale-95'
                  }"
                  id="${this.hideExited ? 'show-exited-button' : 'hide-exited-button'}"
                  @click=${() =>
                    this.dispatchEvent(
                      new CustomEvent('hide-exited-change', { detail: !this.hideExited })
                    )}
                  data-testid="${this.hideExited ? 'show-exited-button' : 'hide-exited-button'}"
                >
                  ${this.hideExited ? 'Show' : 'Hide'} Exited
                  <span class="text-text-dim">(${exitedSessions.length})</span>
                </button>
                
                <!-- Clean Exited button (only when Show Exited is active) -->
                ${
                  !this.hideExited
                    ? html`
                      <button
                        class="font-mono text-xs px-4 py-2 rounded-lg border transition-all duration-200 border-status-warning bg-status-warning bg-opacity-10 text-status-warning hover:bg-opacity-20 hover:shadow-glow-warning-sm active:scale-95 disabled:opacity-50"
                        id="clean-exited-button"
                        @click=${this.handleCleanupExited}
                        ?disabled=${this.cleaningExited}
                        data-testid="clean-exited-button"
                      >
                        ${this.cleaningExited ? 'Cleaning...' : 'Clean Exited'}
                      </button>
                    `
                    : ''
                }
            `
            : ''
        }
        
        <!-- Kill All button -->
        ${
          runningSessions.length > 0
            ? html`
              <button
                class="font-mono text-xs px-4 py-2 rounded-lg border transition-all duration-200 border-status-error bg-status-error bg-opacity-10 text-status-error hover:bg-opacity-20 hover:shadow-glow-error-sm active:scale-95"
                id="kill-all-button"
                @click=${() => this.dispatchEvent(new CustomEvent('kill-all-sessions'))}
                data-testid="kill-all-button"
              >
                Kill All <span class="text-text-dim">(${runningSessions.length})</span>
              </button>
            `
            : ''
        }
      </div>
    `;
  }
}
