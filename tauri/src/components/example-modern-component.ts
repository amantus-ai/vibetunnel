import { html, css, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { repeat } from 'lit/directives/repeat.js';
import { Task } from '@lit/task';
import { TauriBase } from './base/tauri-base';
import { provide } from '@lit/context';
import { appContext, type AppState } from '../contexts/app-context';

interface Session {
  id: string;
  name: string;
  active: boolean;
  createdAt: Date;
  lastUsed: Date;
}

/**
 * A modern Lit component showcasing best practices:
 * - TypeScript with full type safety
 * - Async data handling with @lit/task
 * - Context API for state management
 * - Performance optimizations with directives
 * - Accessibility features
 * - Error boundaries
 * - Loading states
 */
@customElement('session-manager')
export class SessionManager extends TauriBase {
  static override styles = css`
    :host {
      display: block;
      padding: var(--spacing-lg, 24px);
      font-family: var(--font-family, system-ui);
    }

    .container {
      max-width: 800px;
      margin: 0 auto;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--spacing-md, 16px);
    }

    .session-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: var(--spacing-md, 16px);
    }

    .session-card {
      border: 1px solid var(--color-border, #e0e0e0);
      border-radius: var(--radius-md, 8px);
      padding: var(--spacing-md, 16px);
      transition: transform 0.2s, box-shadow 0.2s;
      cursor: pointer;
      background: var(--color-surface, #fff);
    }

    .session-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .session-card.active {
      border-color: var(--color-primary, #1976d2);
      background: var(--color-primary-light, #e3f2fd);
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 200px;
    }

    .error {
      color: var(--color-error, #d32f2f);
      padding: var(--spacing-md, 16px);
      background: var(--color-error-light, #ffebee);
      border-radius: var(--radius-sm, 4px);
    }

    .empty-state {
      text-align: center;
      padding: var(--spacing-xl, 32px);
      color: var(--color-text-secondary, #666);
    }

    /* Dark mode support */
    @media (prefers-color-scheme: dark) {
      .session-card {
        background: var(--color-surface-dark, #1e1e1e);
        border-color: var(--color-border-dark, #333);
      }
    }

    /* Accessibility */
    .session-card:focus-visible {
      outline: 2px solid var(--color-focus, #1976d2);
      outline-offset: 2px;
    }

    /* Animations */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .session-card {
      animation: fadeIn 0.3s ease-out;
    }
  `;

  @provide({ context: appContext })
  @property({ type: Object })
  appState: AppState = {
    sessions: [],
    currentSessionId: null,
    preferences: {
      theme: 'system',
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      terminalWidth: 80,
      enableNotifications: true,
      startupBehavior: 'show',
      autoUpdate: true,
      soundEnabled: false
    },
    serverConfig: {
      host: 'localhost',
      port: 5173,
      connected: false,
      autoReconnect: true,
      reconnectInterval: 5000
    },
    isLoading: false,
    error: null,
    sidebarOpen: true,
    terminalBuffer: [],
    terminalCursorPosition: { x: 0, y: 0 },
    notifications: []
  };

  @state()
  private _selectedSessionId: string | null = null;

  @state()
  private _searchQuery = '';

  @query('#search-input')
  private _searchInput!: HTMLInputElement;

  // Task for async session loading with error handling
  private _sessionsTask = new Task(this, {
    task: async () => {
      const sessions = await this.getSessions();
      return sessions.map(s => ({
        ...s,
        createdAt: s.createdAt ? new Date(s.createdAt) : new Date(),
        lastUsed: s.lastUsed ? new Date(s.lastUsed) : new Date()
      }));
    },
    args: () => [this._searchQuery]
  });

  override render() {
    return html`
      <div class="container">
        <header class="header">
          <h1>Terminal Sessions</h1>
          <button 
            @click=${this._createNewSession}
            ?disabled=${this.loading}
            aria-label="Create new session"
          >
            New Session
          </button>
        </header>

        <input
          id="search-input"
          type="search"
          placeholder="Search sessions..."
          .value=${this._searchQuery}
          @input=${this._handleSearch}
          aria-label="Search sessions"
        />

        ${this._sessionsTask.render({
          pending: () => html`
            <div class="loading" role="status" aria-live="polite">
              <vt-loading></vt-loading>
              <span class="sr-only">Loading sessions...</span>
            </div>
          `,
          complete: (sessions) => this._renderSessions(sessions),
          error: (e) => html`
            <div class="error" role="alert">
              <strong>Error loading sessions:</strong> ${e instanceof Error ? e.message : String(e)}
              <button @click=${() => this._sessionsTask.run()}>
                Retry
              </button>
            </div>
          `
        })}
      </div>
    `;
  }

  private _renderSessions(sessions: Session[]) {
    if (sessions.length === 0) {
      return html`
        <div class="empty-state">
          <p>No sessions found</p>
          <button @click=${this._createNewSession}>
            Create your first session
          </button>
        </div>
      `;
    }

    const filteredSessions = this._filterSessions(sessions);

    return html`
      <div class="session-grid" role="list">
        ${repeat(
          filteredSessions,
          (session) => session.id,
          (session) => this._renderSessionCard(session)
        )}
      </div>
    `;
  }

  private _renderSessionCard(session: Session) {
    const classes = {
      'session-card': true,
      'active': session.active
    };

    return html`
      <article
        class=${classMap(classes)}
        role="listitem"
        tabindex="0"
        @click=${() => this._selectSession(session.id)}
        @keydown=${(e: KeyboardEvent) => this._handleKeydown(e, session.id)}
        aria-label=${`Session ${session.name}, ${session.active ? 'active' : 'inactive'}`}
        aria-pressed=${session.id === this._selectedSessionId}
      >
        <h3>${session.name}</h3>
        <p>Created: ${this._formatDate(session.createdAt)}</p>
        <p>Last used: ${this._formatDate(session.lastUsed)}</p>
        ${session.active ? html`<span class="badge">Active</span>` : nothing}
      </article>
    `;
  }

  private _filterSessions(sessions: Session[]): Session[] {
    if (!this._searchQuery) return sessions;
    
    const query = this._searchQuery.toLowerCase();
    return sessions.filter(s => 
      s.name.toLowerCase().includes(query)
    );
  }

  private async _createNewSession() {
    try {
      const name = prompt('Session name:');
      if (!name) return;

      await this.createSession(name);
      await this.showNotification('Success', `Session "${name}" created`, 'success');
      this._sessionsTask.run();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create session';
      await this.showNotification('Error', message, 'error');
    }
  }

  private async _selectSession(id: string) {
    this._selectedSessionId = id;
    this.dispatchEvent(new CustomEvent('session-selected', {
      detail: { sessionId: id },
      bubbles: true,
      composed: true
    }));
  }

  private _handleSearch(e: Event) {
    const input = e.target as HTMLInputElement;
    this._searchQuery = input.value;
  }

  private _handleKeydown(e: KeyboardEvent, sessionId: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this._selectSession(sessionId);
    }
  }

  private _formatDate(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  // Lifecycle optimization
  override firstUpdated() {
    // Focus search input on load
    this._searchInput?.focus();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    // Cleanup is handled by parent class
  }
}