import { LitElement, html } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { AuthClient } from '../services/auth-client.js';
import './terminal-icon.js';

@customElement('auth-login')
export class AuthLogin extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) authClient!: AuthClient;
  @state() private loading = false;
  @state() private error = '';
  @state() private success = '';
  @state() private currentUserId = '';
  @state() private loginPassword = '';
  @state() private userAvatar = '';
  @state() private authConfig = {
    enableSSHKeys: false,
    disallowUserPassword: false,
    noAuth: false,
  };

  async connectedCallback() {
    super.connectedCallback();
    console.log('🔌 Auth login component connected');
    await this.loadUserInfo();
  }

  private async loadUserInfo() {
    try {
      // Load auth configuration first
      try {
        const configResponse = await fetch('/api/auth/config');
        if (configResponse.ok) {
          this.authConfig = await configResponse.json();
          console.log('⚙️ Auth config loaded:', this.authConfig);
        } else {
          console.warn('⚠️ Failed to load auth config, using defaults:', configResponse.status);
        }
      } catch (error) {
        console.error('❌ Error loading auth config:', error);
      }

      this.currentUserId = await this.authClient.getCurrentSystemUser();
      console.log('👤 Current user:', this.currentUserId);

      // Load user avatar
      this.userAvatar = await this.authClient.getUserAvatar(this.currentUserId);
      console.log('🖼️ User avatar loaded');

      // If no auth required, auto-login
      if (this.authConfig.noAuth) {
        console.log('🔓 No auth required, auto-logging in');
        this.dispatchEvent(
          new CustomEvent('auth-success', {
            detail: {
              success: true,
              userId: this.currentUserId,
              authMethod: 'no-auth',
            },
          })
        );
      }
    } catch (_error) {
      this.error = 'Failed to load user information';
    }
  }

  private async handlePasswordLogin(e: Event) {
    e.preventDefault();
    if (this.loading) return;

    console.log('🔐 Attempting password authentication...');
    this.loading = true;
    this.error = '';

    try {
      const result = await this.authClient.authenticateWithPassword(
        this.currentUserId,
        this.loginPassword
      );
      console.log('🎫 Password auth result:', result);

      if (result.success) {
        this.loginPassword = '';
        this.dispatchEvent(new CustomEvent('auth-success', { detail: result }));
      } else {
        this.error = result.error || 'Password authentication failed';
      }
    } catch (_error) {
      this.error = 'Password authentication failed';
    } finally {
      this.loading = false;
    }
  }

  private async handleSSHKeyAuth() {
    if (this.loading) return;

    console.log('🔐 Attempting SSH key authentication...');
    this.loading = true;
    this.error = '';

    try {
      const authResult = await this.authClient.authenticate(this.currentUserId);
      console.log('🎯 SSH auth result:', authResult);

      if (authResult.success) {
        this.dispatchEvent(new CustomEvent('auth-success', { detail: authResult }));
      } else {
        this.error =
          authResult.error || 'SSH key authentication failed. Please try password login.';
      }
    } catch (error) {
      console.error('SSH key authentication error:', error);
      this.error = 'SSH key authentication failed';
    } finally {
      this.loading = false;
    }
  }

  private handleShowSSHKeyManager() {
    this.dispatchEvent(new CustomEvent('show-ssh-key-manager'));
  }

  render() {
    console.log(
      '🔍 Rendering auth login',
      'enableSSHKeys:',
      this.authConfig.enableSSHKeys,
      'noAuth:',
      this.authConfig.noAuth
    );

    return html`
      <div class="auth-container">
        <div class="w-full max-w-md">
          <div class="auth-header">
            <div class="flex items-center gap-3 justify-center mb-2">
              <terminal-icon size="48"></terminal-icon>
              <h2 class="auth-title">VibeTunnel</h2>
            </div>
            <p class="auth-subtitle">Please authenticate to continue</p>
          </div>

          ${this.error
            ? html`
                <div class="bg-status-error text-dark-bg px-4 py-2 rounded mb-4 font-mono text-sm">
                  ${this.error}
                  <button
                    @click=${() => (this.error = '')}
                    class="ml-2 text-dark-bg hover:text-dark-text"
                  >
                    ✕
                  </button>
                </div>
              `
            : ''}
          ${this.success
            ? html`
                <div
                  class="bg-status-success text-dark-bg px-4 py-2 rounded mb-4 font-mono text-sm"
                >
                  ${this.success}
                  <button
                    @click=${() => (this.success = '')}
                    class="ml-2 text-dark-bg hover:text-dark-text"
                  >
                    ✕
                  </button>
                </div>
              `
            : ''}

          <div class="auth-form">
            ${!this.authConfig.disallowUserPassword
              ? html`
                  <!-- Password Login Section (Primary) -->
                  <div class="ssh-key-item">
                    ${this.userAvatar
                      ? html`
                          <div class="flex flex-col items-center mb-6">
                            <img
                              src="${this.userAvatar}"
                              alt="User Avatar"
                              class="w-20 h-20 rounded-full border-2 border-dark-border mb-3"
                            />
                            <p class="text-dark-text text-sm">
                              ${this.currentUserId
                                ? `Welcome back, ${this.currentUserId}`
                                : 'Please authenticate to continue'}
                            </p>
                          </div>
                        `
                      : ''}
                    <form @submit=${this.handlePasswordLogin} class="space-y-4">
                      <div>
                        <label class="form-label">Password</label>
                        <input
                          type="password"
                          class="input-field"
                          placeholder="Enter your system password"
                          .value=${this.loginPassword}
                          @input=${(e: Event) =>
                            (this.loginPassword = (e.target as HTMLInputElement).value)}
                          ?disabled=${this.loading}
                          required
                        />
                      </div>
                      <button
                        type="submit"
                        class="btn-primary w-full"
                        ?disabled=${this.loading || !this.loginPassword}
                      >
                        ${this.loading ? 'Authenticating...' : 'Login with Password'}
                      </button>
                    </form>
                  </div>
                `
              : ''}
            ${this.authConfig.disallowUserPassword && this.userAvatar
              ? html`
                  <!-- Avatar for SSH-only mode -->
                  <div class="ssh-key-item">
                    <div class="flex flex-col items-center mb-6">
                      <img
                        src="${this.userAvatar}"
                        alt="User Avatar"
                        class="w-20 h-20 rounded-full border-2 border-dark-border mb-3"
                      />
                      <p class="text-dark-text text-sm">
                        ${this.currentUserId
                          ? `Welcome back, ${this.currentUserId}`
                          : 'Please authenticate to continue'}
                      </p>
                      <p class="text-dark-text-muted text-xs mt-2">
                        SSH key authentication required
                      </p>
                    </div>
                  </div>
                `
              : ''}
            ${this.authConfig.enableSSHKeys === true
              ? html`
                  <!-- Divider (only show if password auth is also available) -->
                  ${!this.authConfig.disallowUserPassword
                    ? html`
                        <div class="auth-divider">
                          <span>or</span>
                        </div>
                      `
                    : ''}

                  <!-- SSH Key Management Section -->
                  <div class="ssh-key-item">
                    <div class="flex items-center justify-between mb-4">
                      <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-full bg-accent-green"></div>
                        <span class="font-mono text-sm">SSH Key Management</span>
                      </div>
                      <button class="btn-ghost text-xs" @click=${this.handleShowSSHKeyManager}>
                        Manage Keys
                      </button>
                    </div>

                    <div class="space-y-3">
                      <div class="bg-dark-bg border border-dark-border rounded p-3">
                        <p class="text-dark-text-muted text-xs mb-2">
                          Generate SSH keys for browser-based authentication
                        </p>
                        <p class="text-dark-text-muted text-xs">
                          💡 SSH keys work in both browser and terminal
                        </p>
                      </div>

                      <button
                        class="btn-secondary w-full"
                        @click=${this.handleSSHKeyAuth}
                        ?disabled=${this.loading}
                      >
                        ${this.loading ? 'Authenticating...' : 'Login with SSH Key'}
                      </button>
                    </div>
                  </div>
                `
              : ''}
          </div>
        </div>
      </div>
    `;
  }
}
