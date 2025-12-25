/**
 * Compact Session Card Component
 *
 * A compact list item representation of a session for sidebar/compact views.
 * Handles different session states (running, exited) with appropriate styling.
 *
 * @fires session-select - When card is clicked (detail: Session)
 * @fires session-rename - When session is renamed (detail: { sessionId: string, newName: string })
 * @fires session-delete - When session delete is requested (detail: { sessionId: string })
 * @fires session-cleanup - When exited session cleanup is requested (detail: { sessionId: string })
 */
import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Session } from '../../../shared/types.js';
import { formatSessionDuration } from '../../../shared/utils/time.js';
import type { AuthClient } from '../../services/auth-client.js';
import { formatPathForDisplay } from '../../utils/path-utils.js';
import '../inline-edit.js';

@customElement('compact-session-card')
export class CompactSessionCard extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) session!: Session;
  @property({ type: Object }) authClient!: AuthClient;
  @property({ type: Boolean }) selected = false;
  @property({ type: String }) sessionType: 'running' | 'exited' = 'running';
  @property({ type: Number }) sessionNumber?: number;

  private handleClick() {
    this.dispatchEvent(
      new CustomEvent('session-select', {
        detail: this.session,
        bubbles: true,
        composed: true,
      })
    );
  }

  private handleRename(newName: string) {
    this.dispatchEvent(
      new CustomEvent('session-rename', {
        detail: { sessionId: this.session.id, newName },
        bubbles: true,
        composed: true,
      })
    );
  }

  private async handleDelete(e: Event) {
    e.stopPropagation();

    const eventType = this.session.status === 'exited' ? 'session-cleanup' : 'session-delete';
    this.dispatchEvent(
      new CustomEvent(eventType, {
        detail: { sessionId: this.session.id },
        bubbles: true,
        composed: true,
      })
    );
  }

  private renderStatusIndicator() {
    const session = this.session;

    if (session.status === 'exited') {
      return html`<div class="w-2.5 h-2.5 rounded-full bg-status-warning"></div>`;
    }

    return html`<div class="w-2.5 h-2.5 rounded-full bg-status-success"></div>`;
  }

  private renderGitChanges() {
    if (!this.session.gitRepoPath) return '';

    const changes = [];

    // Show uncommitted changes indicator first
    if (this.session.gitHasChanges) {
      changes.push(html`<span class="text-status-warning ml-1">●</span>`);
    }

    // Show ahead/behind counts
    if (this.session.gitAheadCount && this.session.gitAheadCount > 0) {
      changes.push(
        html`<span class="text-status-success ml-1">↑${this.session.gitAheadCount}</span>`
      );
    }
    if (this.session.gitBehindCount && this.session.gitBehindCount > 0) {
      changes.push(
        html`<span class="text-status-warning ml-1">↓${this.session.gitBehindCount}</span>`
      );
    }

    if (changes.length === 0) return '';

    return html`${changes}`;
  }

  private renderSessionName() {
    const displayName =
      this.session.name ||
      (Array.isArray(this.session.command) ? this.session.command.join(' ') : this.session.command);

    // Only show inline-edit for running sessions
    if (this.sessionType !== 'exited') {
      return html`
        <inline-edit
          .value=${displayName}
          .placeholder=${Array.isArray(this.session.command) ? this.session.command.join(' ') : this.session.command}
          .onSave=${(newName: string) => this.handleRename(newName)}
        ></inline-edit>
      `;
    }

    // For exited sessions, just show the name
    return html`<span title="${displayName}">${displayName}</span>`;
  }

  private renderDeleteButton() {
    const isExited = this.session.status === 'exited';

    // Unified button styling with proper hover states
    const buttonClass = isExited
      ? 'btn-ghost text-text-muted p-1.5 rounded-md transition-all hover:text-status-warning hover:bg-bg-elevated hover:shadow-sm'
      : 'btn-ghost text-text-muted p-1.5 rounded-md transition-all hover:text-status-error hover:bg-bg-elevated hover:shadow-sm hover:scale-110';

    const buttonTitle = isExited ? 'Clean up session' : 'Kill Session';

    return html`
      <button
        class="${buttonClass}"
        @click=${this.handleDelete}
        title="${buttonTitle}"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    `;
  }

  render() {
    const session = this.session;
    const isExited = session.status === 'exited';
    const isTouchDevice = 'ontouchstart' in window;

    // Base classes for the card
    const cardClasses = [
      'group',
      'flex',
      'items-center',
      'gap-3',
      'p-3',
      'rounded-lg',
      'cursor-pointer',
      this.selected
        ? 'bg-bg-elevated border border-accent-primary shadow-card-hover'
        : isExited
          ? 'bg-bg-secondary border border-border hover:bg-bg-tertiary hover:border-border-light hover:shadow-card opacity-75'
          : 'bg-bg-secondary border border-border hover:bg-bg-tertiary hover:border-border-light hover:shadow-card',
    ].join(' ');

    // Text color classes
    const nameColorClass = this.selected
      ? 'text-accent-primary font-medium'
      : isExited
        ? 'text-text-muted group-hover:text-text transition-colors'
        : 'text-text group-hover:text-accent-primary transition-colors';

    const pathColorClass = isExited ? 'text-text-dim' : 'text-text-muted';

    return html`
      <div class="${cardClasses}" style="margin-bottom: 12px;" @click=${this.handleClick}>
        <!-- Session number and status indicator -->
        <div class="flex items-center gap-2 flex-shrink-0">
          ${
            this.sessionNumber
              ? html`
            <span class="text-xs font-mono ${this.selected ? 'text-accent-primary' : 'text-text-muted'} min-w-[1.5rem] text-center">
              ${this.sessionNumber}
            </span>
          `
              : ''
          }
          <div class="relative">
            ${this.renderStatusIndicator()}
          </div>
        </div>
        
        <!-- Elegant divider line -->
        <div class="w-px h-full self-stretch bg-gradient-to-b from-transparent via-border to-transparent"></div>
        
        <!-- Session content -->
        <div class="flex-1 min-w-0">
          <!-- Row 1: Session name -->
          <div class="text-sm font-mono truncate ${nameColorClass}">
            ${this.renderSessionName()}
          </div>
          
          <!-- Row 2: Path, branch, and git changes -->
          <div class="text-xs ${pathColorClass} truncate flex items-center gap-1 mt-1">
            <span class="truncate">${formatPathForDisplay(session.workingDir)}</span>
            ${
              session.gitBranch
                ? html`
                  <span class="text-text-muted/50">·</span>
                  <span class="text-status-success font-mono">[${session.gitBranch}]</span>
                  ${session.gitIsWorktree ? html`<span class="text-purple-400 ml-0.5">⎇</span>` : ''}
                  <!-- Git changes indicator after branch -->
                  ${this.renderGitChanges()}
                `
                : ''
            }
          </div>
          
          <!-- Row 3: (reserved) -->
        </div>
        
        <!-- Right side: duration and close button -->
        <div class="relative flex items-center flex-shrink-0 gap-1">
          ${
            isTouchDevice
              ? html`
                <!-- Touch devices: Close button left of time -->
                ${this.renderDeleteButton()}
                <div class="text-xs text-text-${isExited ? 'dim' : 'muted'} font-mono">
                  ${session.startedAt ? formatSessionDuration(session.startedAt, session.status === 'exited' ? session.lastModified : undefined) : ''}
                </div>
              `
              : html`
                <!-- Desktop: Time that hides on hover -->
                <div class="text-xs text-text-${isExited ? 'dim' : 'muted'} font-mono transition-opacity group-hover:opacity-0">
                  ${session.startedAt ? formatSessionDuration(session.startedAt, session.status === 'exited' ? session.lastModified : undefined) : ''}
                </div>
                
                <!-- Desktop: Buttons show on hover -->
                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity absolute right-0">
                  ${this.renderDeleteButton()}
                </div>
              `
          }
        </div>
      </div>
    `;
  }
}
