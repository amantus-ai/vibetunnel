import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import './vt-button';
import './vt-card';

export interface ErrorInfo {
  message: string;
  stack?: string;
  componentStack?: string;
  timestamp: number;
}

/**
 * Error boundary component that catches and displays errors gracefully
 */
@customElement('vt-error-boundary')
export class VTErrorBoundary extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    .error-container {
      padding: 40px 20px;
      text-align: center;
      max-width: 600px;
      margin: 0 auto;
    }

    .error-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 24px;
      color: var(--danger);
    }

    .error-title {
      font-size: 24px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 12px;
    }

    .error-message {
      font-size: 16px;
      color: var(--text-secondary);
      margin-bottom: 32px;
      line-height: 1.5;
    }

    .error-details {
      margin-top: 24px;
      text-align: left;
    }

    .error-details-toggle {
      background: none;
      border: none;
      color: var(--accent);
      cursor: pointer;
      font-size: 14px;
      text-decoration: underline;
      padding: 0;
      margin-bottom: 16px;
    }

    .error-details-toggle:hover {
      color: var(--accent-hover);
    }

    .error-stack {
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: var(--radius-md);
      padding: 16px;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.6;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 300px;
      overflow-y: auto;
    }

    .error-actions {
      display: flex;
      gap: 12px;
      justify-content: center;
      flex-wrap: wrap;
    }

    .error-timestamp {
      font-size: 12px;
      color: var(--text-tertiary);
      margin-top: 16px;
    }

    /* Development mode styles */
    :host([development]) .error-details {
      display: block !important;
    }

    /* Inline error styles */
    :host([inline]) .error-container {
      padding: 20px;
      background: var(--bg-card);
      border: 1px solid var(--danger);
      border-radius: var(--radius-md);
    }

    :host([inline]) .error-icon {
      width: 32px;
      height: 32px;
      margin-bottom: 12px;
    }

    :host([inline]) .error-title {
      font-size: 18px;
    }

    :host([inline]) .error-message {
      font-size: 14px;
      margin-bottom: 16px;
    }
  `;

  @property({ type: Object })
  error: ErrorInfo | null = null;

  @property({ type: String })
  fallbackMessage = 'Something went wrong';

  @property({ type: Boolean })
  showDetails = false;

  @property({ type: Boolean, reflect: true })
  development = false;

  @property({ type: Boolean, reflect: true })
  inline = false;

  @property({ type: Function })
  onRetry?: () => void;

  @property({ type: Function })
  onReport?: (error: ErrorInfo) => void;

  @state()
  private _showStack = false;

  private _errorLogKey = 'vt-error-log';
  private _maxErrorLogs = 10;

  override connectedCallback() {
    super.connectedCallback();
    
    // Set up global error handler
    window.addEventListener('error', this._handleGlobalError);
    window.addEventListener('unhandledrejection', this._handleUnhandledRejection);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    
    window.removeEventListener('error', this._handleGlobalError);
    window.removeEventListener('unhandledrejection', this._handleUnhandledRejection);
  }

  private _handleGlobalError = (event: ErrorEvent) => {
    this.captureError(new Error(event.message), {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    });
  };

  private _handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const error = event.reason instanceof Error 
      ? event.reason 
      : new Error(String(event.reason));
    
    this.captureError(error, { 
      type: 'unhandledRejection' 
    });
  };

  captureError(error: Error, context?: Record<string, unknown>) {
    const errorInfo: ErrorInfo = {
      message: error.message || this.fallbackMessage,
      stack: error.stack,
      timestamp: Date.now()
    };

    // Log to console in development
    if (this.development) {
      console.error('Error captured:', error, context);
    }

    // Store in session storage for debugging
    this._storeError(errorInfo);

    // Update component state
    this.error = errorInfo;

    // Call report handler if provided
    if (this.onReport) {
      this.onReport(errorInfo);
    }

    // Dispatch error event
    this.dispatchEvent(new CustomEvent('error-captured', {
      detail: { error: errorInfo, context },
      bubbles: true,
      composed: true
    }));
  }

  private _storeError(error: ErrorInfo) {
    try {
      const stored = sessionStorage.getItem(this._errorLogKey);
      const errors: ErrorInfo[] = stored ? JSON.parse(stored) : [];
      
      errors.push(error);
      
      // Keep only recent errors
      if (errors.length > this._maxErrorLogs) {
        errors.shift();
      }
      
      sessionStorage.setItem(this._errorLogKey, JSON.stringify(errors));
    } catch (e) {
      // Ignore storage errors
    }
  }

  private _handleRetry() {
    this.error = null;
    
    if (this.onRetry) {
      this.onRetry();
    }
    
    this.dispatchEvent(new CustomEvent('retry', {
      bubbles: true,
      composed: true
    }));
  }

  private _handleReload() {
    window.location.reload();
  }

  private _toggleStack() {
    this._showStack = !this._showStack;
  }

  private _formatTimestamp(timestamp: number): string {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'short',
      timeStyle: 'medium'
    }).format(new Date(timestamp));
  }

  override render() {
    if (!this.error) {
      return html`<slot></slot>`;
    }

    return html`
      <vt-card class="error-container" role="alert" aria-live="assertive">
        <svg class="error-icon" viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="32" r="30" stroke="currentColor" stroke-width="4"/>
          <path d="M32 20V36M32 44H32.01" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
        </svg>
        
        <h2 class="error-title">
          ${this.inline ? 'Error' : 'Oops! Something went wrong'}
        </h2>
        
        <p class="error-message">
          ${this.error.message}
        </p>
        
        <div class="error-actions">
          ${this.onRetry ? html`
            <vt-button @click=${this._handleRetry}>
              Try Again
            </vt-button>
          ` : ''}
          
          ${!this.inline ? html`
            <vt-button variant="secondary" @click=${this._handleReload}>
              Reload Page
            </vt-button>
          ` : ''}
        </div>
        
        ${(this.showDetails || this.development) && this.error.stack ? html`
          <div class="error-details">
            <button 
              class="error-details-toggle"
              @click=${this._toggleStack}
              aria-expanded=${this._showStack}
            >
              ${this._showStack ? 'Hide' : 'Show'} Technical Details
            </button>
            
            ${this._showStack ? html`
              <pre class="error-stack">${this.error.stack}</pre>
            ` : ''}
          </div>
        ` : ''}
        
        <div class="error-timestamp">
          Error occurred at ${this._formatTimestamp(this.error.timestamp)}
        </div>
      </vt-card>
    `;
  }
}

/**
 * Higher-order component to wrap any component with error boundary
 */
export function withErrorBoundary<T extends LitElement>(
  Component: new (...args: any[]) => T,
  options?: {
    fallbackMessage?: string;
    onError?: (error: ErrorInfo) => void;
    development?: boolean;
  }
): new (...args: any[]) => T {
  return class extends Component {
    private _errorBoundary?: VTErrorBoundary;

    override connectedCallback() {
      super.connectedCallback();
      
      // Wrap component in error boundary
      const wrapper = document.createElement('vt-error-boundary') as VTErrorBoundary;
      wrapper.fallbackMessage = options?.fallbackMessage || 'Component error';
      wrapper.development = options?.development || false;
      wrapper.onReport = options?.onError;
      
      if (this.parentNode) {
        this.parentNode.insertBefore(wrapper, this);
        wrapper.appendChild(this);
      }
      
      this._errorBoundary = wrapper;
    }

    override disconnectedCallback() {
      super.disconnectedCallback();
      
      // Clean up wrapper
      if (this._errorBoundary && this._errorBoundary.parentNode) {
        this._errorBoundary.parentNode.insertBefore(this, this._errorBoundary);
        this._errorBoundary.remove();
      }
    }

    protected override render(): unknown {
      try {
        return super.render();
      } catch (error) {
        // Capture render errors
        if (this._errorBoundary && error instanceof Error) {
          this._errorBoundary.captureError(error, {
            component: this.constructor.name,
            phase: 'render'
          });
        }
        throw error;
      }
    }
  };
}