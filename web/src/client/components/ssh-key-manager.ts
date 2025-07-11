import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { BrowserSSHAgent } from '../services/ssh-agent.js';
import './modal-wrapper.js';

interface SSHKey {
  id: string;
  name: string;
  publicKey: string;
  algorithm: 'Ed25519';
  encrypted: boolean;
  fingerprint: string;
  createdAt: string;
}

@customElement('ssh-key-manager')
export class SSHKeyManager extends LitElement {
  // Disable shadow DOM to use Tailwind
  createRenderRoot() {
    return this;
  }

  @property({ type: Object }) sshAgent!: BrowserSSHAgent;
  @property({ type: Boolean }) visible = false;
  @state() private keys: SSHKey[] = [];
  @state() private loading = false;
  @state() private error = '';
  @state() private success = '';
  @state() private showAddForm = false;
  @state() private newKeyName = '';
  @state() private newKeyPassword = '';
  @state() private importKeyName = '';
  @state() private importKeyContent = '';
  @state() private showInstructions = false;
  @state() private instructionsKeyId = '';

  connectedCallback() {
    super.connectedCallback();
    this.refreshKeys();
  }

  private refreshKeys() {
    this.keys = this.sshAgent.listKeys() as SSHKey[];
  }

  private async handleGenerateKey() {
    if (!this.newKeyName.trim()) {
      this.error = 'Please enter a key name';
      return;
    }

    this.loading = true;
    this.error = '';

    try {
      const result = await this.sshAgent.generateKeyPair(
        this.newKeyName,
        this.newKeyPassword || undefined
      );

      // Automatically download the private key
      this.downloadPrivateKey(result.privateKeyPEM, this.newKeyName);

      this.success = `SSH key "${this.newKeyName}" generated successfully. Private key downloaded.`;
      this.newKeyName = '';
      this.newKeyPassword = '';
      this.showAddForm = false;
      this.showInstructions = true;
      this.instructionsKeyId = result.keyId;
      this.refreshKeys();
      console.log('Generated key ID:', result.keyId);
    } catch (error) {
      this.error = `Failed to generate key: ${error}`;
    } finally {
      this.loading = false;
    }
  }

  private downloadPrivateKey(privateKeyPEM: string, keyName: string) {
    const blob = new Blob([privateKeyPEM], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${keyName.replace(/\s+/g, '_')}_private.pem`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private async handleImportKey() {
    if (!this.importKeyName.trim() || !this.importKeyContent.trim()) {
      this.error = 'Please enter both key name and private key content';
      return;
    }

    this.loading = true;
    this.error = '';

    try {
      const keyId = await this.sshAgent.addKey(this.importKeyName, this.importKeyContent);
      this.success = `SSH key "${this.importKeyName}" imported successfully`;
      this.importKeyName = '';
      this.importKeyContent = '';
      this.showAddForm = false;
      this.refreshKeys();
      console.log('Imported key ID:', keyId);
    } catch (error) {
      this.error = `Failed to import key: ${error}`;
    } finally {
      this.loading = false;
    }
  }

  private handleClose() {
    this.dispatchEvent(new CustomEvent('close'));
  }

  private handleRemoveKey(keyId: string, keyName: string) {
    if (confirm(`Are you sure you want to remove the SSH key "${keyName}"?`)) {
      this.sshAgent.removeKey(keyId);
      this.success = `SSH key "${keyName}" removed successfully`;
      this.refreshKeys();
    }
  }

  private handleDownloadPublicKey(keyId: string, keyName: string) {
    const publicKey = this.sshAgent.getPublicKey(keyId);
    if (publicKey) {
      const blob = new Blob([publicKey], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${keyName.replace(/\s+/g, '_')}_public.pub`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  render() {
    if (!this.visible) return html``;

    return html`
      <modal-wrapper
        .visible=${this.visible}
        modalClass=""
        contentClass="modal-content modal-positioned bg-bg border border-base rounded-lg p-6 w-full max-w-4xl max-h-[80vh] overflow-y-auto"
        ariaLabel="SSH Key Manager"
        @close=${this.handleClose}
        .closeOnBackdrop=${true}
        .closeOnEscape=${true}
      >
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-mono text-primary">SSH Key Manager</h2>
            <button @click=${this.handleClose} class="text-muted hover:text-primary">
              ✕
            </button>
          </div>

          ${
            this.error
              ? html`
                <div class="bg-status-error text-bg px-4 py-2 rounded mb-4 font-mono text-sm">
                  ${this.error}
                  <button
                    @click=${() => {
                      this.error = '';
                    }}
                    class="ml-2 text-bg hover:text-primary"
                  >
                    ✕
                  </button>
                </div>
              `
              : ''
          }
          ${
            this.success
              ? html`
                <div
                  class="bg-status-success text-bg px-4 py-2 rounded mb-4 font-mono text-sm"
                >
                  ${this.success}
                  <button
                    @click=${() => {
                      this.success = '';
                    }}
                    class="ml-2 text-bg hover:text-primary"
                  >
                    ✕
                  </button>
                </div>
              `
              : ''
          }

          <div class="mb-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-mono text-lg text-primary">SSH Keys</h3>
              <button
                @click=${() => {
                  this.showAddForm = !this.showAddForm;
                }}
                class="btn-primary"
                ?disabled=${this.loading}
              >
                ${this.showAddForm ? 'Cancel' : 'Add Key'}
              </button>
            </div>

            ${
              this.showAddForm
                ? html`
                  <div class="space-y-6 mb-4">
                    <!-- Generate New Key Section -->
                    <div class="bg-surface border border-base rounded p-4">
                      <h4 class="text-primary font-mono text-lg mb-4 flex items-center gap-2">
                        🔑 Generate New SSH Key
                      </h4>

                      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label class="form-label"
                            >Key Name <span class="text-accent-red">*</span></label
                          >
                          <input
                            type="text"
                            class="input-field"
                            placeholder="Enter name for new key"
                            .value=${this.newKeyName}
                            @input=${(e: Event) => {
                              this.newKeyName = (e.target as HTMLInputElement).value;
                            }}
                            ?disabled=${this.loading}
                          />
                        </div>
                        <div>
                          <label class="form-label">Algorithm</label>
                          <div
                            class="input-field bg-secondary text-muted cursor-not-allowed"
                          >
                            Ed25519 (recommended)
                          </div>
                        </div>
                      </div>

                      <div class="mb-4">
                        <label class="form-label">Password (Optional)</label>
                        <input
                          type="password"
                          class="input-field"
                          placeholder="Enter password to encrypt private key (optional)"
                          .value=${this.newKeyPassword}
                          @input=${(e: Event) => {
                            this.newKeyPassword = (e.target as HTMLInputElement).value;
                          }}
                          ?disabled=${this.loading}
                        />
                        <p class="text-muted text-xs mt-1">
                          💡 Leave empty for unencrypted key. Password is required when using the
                          key for signing.
                        </p>
                      </div>
                      <button
                        @click=${this.handleGenerateKey}
                        class="btn-primary"
                        ?disabled=${this.loading || !this.newKeyName.trim()}
                      >
                        ${this.loading ? 'Generating...' : 'Generate New Key'}
                      </button>
                    </div>

                    <!-- Import Existing Key Section -->
                    <div class="bg-surface border border-base rounded p-4">
                      <h4 class="text-primary font-mono text-lg mb-4 flex items-center gap-2">
                        📁 Import Existing SSH Key
                      </h4>

                      <div class="mb-4">
                        <label class="form-label"
                          >Key Name <span class="text-accent-red">*</span></label
                        >
                        <input
                          type="text"
                          class="input-field"
                          placeholder="Enter name for imported key"
                          .value=${this.importKeyName}
                          @input=${(e: Event) => {
                            this.importKeyName = (e.target as HTMLInputElement).value;
                          }}
                          ?disabled=${this.loading}
                        />
                      </div>

                      <div class="mb-4">
                        <label class="form-label"
                          >Private Key (PEM format) <span class="text-accent-red">*</span></label
                        >
                        <textarea
                          class="input-field"
                          rows="6"
                          placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                          .value=${this.importKeyContent}
                          @input=${(e: Event) => {
                            this.importKeyContent = (e.target as HTMLTextAreaElement).value;
                          }}
                          ?disabled=${this.loading}
                        ></textarea>
                        <p class="text-muted text-xs mt-1">
                          💡 If the key is password-protected, you'll be prompted for the password
                          when using it for authentication.
                        </p>
                      </div>

                      <button
                        @click=${this.handleImportKey}
                        class="btn-secondary"
                        ?disabled=${
                          this.loading ||
                          !this.importKeyName.trim() ||
                          !this.importKeyContent.trim()
                        }
                      >
                        ${this.loading ? 'Importing...' : 'Import Key'}
                      </button>
                    </div>
                  </div>
                `
                : ''
            }
          </div>

          <!-- Instructions for new key -->
          ${
            this.showInstructions && this.instructionsKeyId
              ? html`
                <div class="bg-surface border border-base rounded p-4 mb-6">
                  <div class="flex items-center justify-between mb-4">
                    <h4 class="text-primary font-mono text-lg">Setup Instructions</h4>
                    <button
                      @click=${() => {
                        this.showInstructions = false;
                      }}
                      class="text-muted hover:text-primary"
                    >
                      ✕
                    </button>
                  </div>
                  <div class="space-y-4">
                    <div class="bg-bg border border-base rounded p-3">
                      <p class="text-muted text-xs mb-2">
                        1. Add the public key to your authorized_keys file:
                      </p>
                      <div class="relative">
                        <pre
                          class="bg-secondary p-2 rounded text-xs overflow-x-auto text-primary pr-20"
                        >
echo "${this.sshAgent.getPublicKey(this.instructionsKeyId)}" >> ~/.ssh/authorized_keys</pre
                        >
                        <button
                          @click=${async () => {
                            const publicKey = this.sshAgent.getPublicKey(this.instructionsKeyId);
                            const command = `echo "${publicKey}" >> ~/.ssh/authorized_keys`;
                            await navigator.clipboard.writeText(command);
                            this.success = 'Command copied to clipboard!';
                          }}
                          class="absolute top-2 right-2 btn-ghost text-xs"
                          title="Copy command"
                        >
                          📋
                        </button>
                      </div>
                    </div>
                    <div class="bg-bg border border-base rounded p-3">
                      <p class="text-muted text-xs mb-2">2. Or copy the public key:</p>
                      <div class="relative">
                        <pre
                          class="bg-secondary p-2 rounded text-xs overflow-x-auto text-primary pr-20"
                        >
${this.sshAgent.getPublicKey(this.instructionsKeyId)}</pre
                        >
                        <button
                          @click=${async () => {
                            const publicKey = this.sshAgent.getPublicKey(this.instructionsKeyId);
                            if (publicKey) {
                              await navigator.clipboard.writeText(publicKey);
                              this.success = 'Public key copied to clipboard!';
                            }
                          }}
                          class="absolute top-2 right-2 btn-ghost text-xs"
                          title="Copy to clipboard"
                        >
                          📋 Copy
                        </button>
                      </div>
                    </div>
                    <p class="text-muted text-xs font-mono">
                      💡 Tip: Make sure ~/.ssh/authorized_keys has correct permissions (600)
                    </p>
                  </div>
                </div>
              `
              : ''
          }

          <!-- Keys List -->
          <div class="space-y-4">
            ${
              this.keys.length === 0
                ? html`
                  <div class="text-center py-8 text-muted">
                    <p class="font-mono text-lg mb-2">No SSH keys found</p>
                    <p class="text-sm">Generate or import a key to get started</p>
                  </div>
                `
                : this.keys.map(
                    (key) => html`
                    <div class="ssh-key-item">
                      <div class="flex items-start justify-between">
                        <div class="flex-1">
                          <div class="flex items-center gap-2 mb-2">
                            <h4 class="font-mono font-semibold text-primary">${key.name}</h4>
                            <span class="badge badge-ed25519">${key.algorithm}</span>
                            ${
                              key.encrypted
                                ? html`<span class="badge badge-encrypted">🔒 Encrypted</span>`
                                : ''
                            }
                          </div>
                          <div class="text-sm text-muted font-mono space-y-1">
                            <div>ID: ${key.id}</div>
                            <div>Fingerprint: ${key.fingerprint}</div>
                            <div>Created: ${new Date(key.createdAt).toLocaleString()}</div>
                          </div>
                        </div>
                        <div class="flex gap-2">
                          <button
                            @click=${() => this.handleDownloadPublicKey(key.id, key.name)}
                            class="btn-ghost text-xs"
                            title="Download Public Key"
                          >
                            📥 Public
                          </button>
                          <button
                            @click=${() => this.handleRemoveKey(key.id, key.name)}
                            class="btn-ghost text-xs text-status-error hover:bg-status-error hover:text-bg"
                            title="Remove Key"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    </div>
                  `
                  )
            }
          </div>
      </modal-wrapper>
    `;
  }
}
