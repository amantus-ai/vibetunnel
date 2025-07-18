// Module-level variable to track if crypto is available
let cryptoSubtle: SubtleCrypto | undefined;

// Try to get subtle crypto if available, but don't throw at module load
if (globalThis.crypto?.subtle) {
  cryptoSubtle = globalThis.crypto.subtle;
}

interface SSHKey {
  id: string;
  name: string;
  publicKey: string;
  privateKey: string;
  algorithm: 'Ed25519';
  encrypted: boolean;
  fingerprint: string;
  createdAt: string;
}

interface SignatureResult {
  signature: string;
  algorithm: string;
}

export class BrowserSSHAgent {
  private static readonly DEFAULT_STORAGE_KEY = 'vibetunnel_ssh_keys';
  private keys: Map<string, SSHKey> = new Map();
  private storageKey: string;
  private cryptoErrorShown = false;

  constructor(customStorageKey?: string) {
    this.storageKey = customStorageKey || BrowserSSHAgent.DEFAULT_STORAGE_KEY;
    this.loadKeysFromStorage();
  }

  /**
   * Check if Web Crypto API is available and show error if not
   */
  private ensureCryptoAvailable(): void {
    if (!cryptoSubtle) {
      if (!this.cryptoErrorShown) {
        this.showCryptoError();
        this.cryptoErrorShown = true;
      }
      throw new Error('Web Crypto API is not available');
    }
  }

  /**
   * Show user-friendly error banner for crypto unavailability
   */
  private showCryptoError(): void {
    // Check if DOM is ready
    if (!document.body) {
      console.error('Web Crypto API not available and DOM not ready to show error');
      return;
    }

    // Detect if we're on a local network IP
    const hostname = window.location.hostname;
    const isLocalNetwork = hostname.match(/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/);
    const isNonLocalhost = hostname !== 'localhost' && hostname !== '127.0.0.1';

    let errorMessage =
      'SSH key operations are unavailable because the Web Crypto API is not accessible.\n\n';

    if (isLocalNetwork || (isNonLocalhost && window.location.protocol === 'http:')) {
      // Differentiate between HTTP and HTTPS on local IPs
      if (isLocalNetwork && window.location.protocol === 'https:') {
        errorMessage +=
          "Even though you're using HTTPS, browsers block the Web Crypto API on local network IPs.\n\n";
      } else {
        errorMessage +=
          'This happens when accessing VibeTunnel over HTTP from non-localhost addresses.\n\n';
      }
      errorMessage += 'To fix this, use one of these methods:\n';
      errorMessage += '1. Access via http://localhost:4020 instead\n';
      errorMessage += '   - Use SSH tunnel: ssh -L 4020:localhost:4020 user@server\n';
      errorMessage += '2. Enable HTTPS on the server (recommended for production)\n';
      errorMessage +=
        '3. For Chrome: Enable insecure origins at chrome://flags/#unsafely-treat-insecure-origin-as-secure\n';
      errorMessage += '   - Add your server URL (e.g., http://192.168.1.100:4020)\n';
      errorMessage += '   - Restart Chrome after changing the flag\n';
      errorMessage += '   - Note: Firefox also enforces these restrictions since v75';
    } else {
      errorMessage += 'Your browser may not support the Web Crypto API or it may be disabled.\n';
      errorMessage += 'Please use a modern browser (Chrome 60+, Firefox 75+, Safari 11+).';
    }

    // Create and append style if not already exists
    if (!document.querySelector('#crypto-error-style')) {
      const style = document.createElement('style');
      style.id = 'crypto-error-style';
      style.textContent = `
        .crypto-error-banner {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: #dc2626;
          color: white;
          padding: 16px;
          z-index: 9999;
          font-family: monospace;
          white-space: pre-wrap;
          box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        }
      `;
      document.head.appendChild(style);
    }

    // Create and append banner if not already exists
    if (!document.querySelector('.crypto-error-banner')) {
      const banner = document.createElement('div');
      banner.className = 'crypto-error-banner';
      banner.textContent = errorMessage;
      document.body.appendChild(banner);
    }
  }

  /**
   * Check if agent is ready (always true since no unlock needed)
   */
  isUnlocked(): boolean {
    return true;
  }

  /**
   * Add SSH private key to the agent
   */
  async addKey(name: string, privateKeyPEM: string): Promise<string> {
    this.ensureCryptoAvailable();

    // After ensureCryptoAvailable, we know cryptoSubtle is defined
    if (!cryptoSubtle) {
      throw new Error('Crypto not available');
    }

    try {
      // Parse and validate the private key (detect encryption without decrypting)
      const keyData = await this.parsePrivateKey(privateKeyPEM);

      const keyId = this.generateKeyId();
      const sshKey: SSHKey = {
        id: keyId,
        name,
        publicKey: keyData.publicKey,
        privateKey: privateKeyPEM,
        algorithm: 'Ed25519',
        encrypted: keyData.encrypted,
        fingerprint: keyData.fingerprint,
        createdAt: new Date().toISOString(),
      };

      this.keys.set(keyId, sshKey);
      this.saveKeysToStorage();

      return keyId;
    } catch (error) {
      throw new Error(`Failed to add SSH key: ${error}`);
    }
  }

  /**
   * Remove SSH key from agent
   */
  removeKey(keyId: string): void {
    this.keys.delete(keyId);
    this.saveKeysToStorage();
  }

  /**
   * List all SSH keys
   */
  listKeys(): Array<Omit<SSHKey, 'privateKey'>> {
    return Array.from(this.keys.values()).map((key) => ({
      id: key.id,
      name: key.name,
      publicKey: key.publicKey,
      algorithm: key.algorithm,
      encrypted: key.encrypted,
      fingerprint: key.fingerprint,
      createdAt: key.createdAt,
    }));
  }

  /**
   * Sign data with a specific SSH key
   */
  async sign(keyId: string, data: string): Promise<SignatureResult> {
    this.ensureCryptoAvailable();

    // After ensureCryptoAvailable, we know cryptoSubtle is defined
    if (!cryptoSubtle) {
      throw new Error('Crypto not available');
    }

    const key = this.keys.get(keyId);
    if (!key) {
      throw new Error('SSH key not found');
    }

    if (!key.privateKey) {
      throw new Error('Private key not available for signing');
    }

    try {
      // Decrypt private key if encrypted
      let privateKeyPEM = key.privateKey;
      if (key.encrypted) {
        // Prompt for password if key is encrypted
        const password = await this.promptForPassword(key.name);
        if (!password) {
          throw new Error('Password required for encrypted key');
        }
        privateKeyPEM = await this.decryptPrivateKey(key.privateKey, password);
      }

      // Import the private key for signing
      const privateKey = await this.importPrivateKey(privateKeyPEM, key.algorithm);

      // Convert challenge data to buffer (browser-compatible)
      const dataBuffer = this.base64ToArrayBuffer(data);

      // Sign the data
      const signature = await cryptoSubtle.sign({ name: 'Ed25519' }, privateKey, dataBuffer);

      // Return base64 encoded signature
      return {
        signature: this.arrayBufferToBase64(signature),
        algorithm: key.algorithm,
      };
    } catch (error) {
      throw new Error(`Failed to sign data: ${error}`);
    }
  }

  /**
   * Generate SSH key pair in the browser
   */
  async generateKeyPair(
    name: string,
    password?: string
  ): Promise<{ keyId: string; privateKeyPEM: string }> {
    this.ensureCryptoAvailable();

    // After ensureCryptoAvailable, we know cryptoSubtle is defined
    if (!cryptoSubtle) {
      throw new Error('Crypto not available');
    }

    console.log(`🔑 SSH Agent: Starting Ed25519 key generation for "${name}"`);

    try {
      const keyPair = await cryptoSubtle.generateKey(
        {
          name: 'Ed25519',
        } as AlgorithmIdentifier,
        true,
        ['sign', 'verify']
      );

      // Export keys
      const cryptoKeyPair = keyPair as CryptoKeyPair;
      const privateKeyBuffer = await cryptoSubtle.exportKey('pkcs8', cryptoKeyPair.privateKey);
      const publicKeyBuffer = await cryptoSubtle.exportKey('raw', cryptoKeyPair.publicKey);

      // Convert to proper formats
      let privateKeyPEM = this.arrayBufferToPEM(privateKeyBuffer, 'PRIVATE KEY');
      const publicKeySSH = this.convertEd25519ToSSHPublicKey(publicKeyBuffer);

      // Encrypt private key if password provided
      const isEncrypted = !!password;
      if (password) {
        privateKeyPEM = await this.encryptPrivateKey(privateKeyPEM, password);
      }

      const keyId = this.generateKeyId();
      const sshKey: SSHKey = {
        id: keyId,
        name,
        publicKey: publicKeySSH,
        privateKey: privateKeyPEM,
        algorithm: 'Ed25519',
        encrypted: isEncrypted,
        fingerprint: await this.generateFingerprint(publicKeySSH),
        createdAt: new Date().toISOString(),
      };

      // Store key with private key for browser-based signing
      this.keys.set(keyId, sshKey);
      await this.saveKeysToStorage();

      console.log(`🔑 SSH Agent: Key "${name}" generated successfully with ID: ${keyId}`);
      return { keyId, privateKeyPEM };
    } catch (error) {
      throw new Error(`Failed to generate key pair: ${error}`);
    }
  }

  /**
   * Export public key in SSH format
   */
  getPublicKey(keyId: string): string | null {
    const key = this.keys.get(keyId);
    return key ? key.publicKey : null;
  }

  /**
   * Get private key for a specific key ID
   */
  getPrivateKey(keyId: string): string | null {
    const key = this.keys.get(keyId);
    return key ? key.privateKey : null;
  }

  // Private helper methods

  private async parsePrivateKey(privateKeyPEM: string): Promise<{
    publicKey: string;
    algorithm: 'Ed25519';
    fingerprint: string;
    encrypted: boolean;
  }> {
    // Check if key is encrypted
    const isEncrypted =
      privateKeyPEM.includes('BEGIN ENCRYPTED PRIVATE KEY') ||
      privateKeyPEM.includes('Proc-Type: 4,ENCRYPTED');

    // Only support Ed25519 keys
    if (
      privateKeyPEM.includes('BEGIN PRIVATE KEY') ||
      privateKeyPEM.includes('BEGIN ENCRYPTED PRIVATE KEY')
    ) {
      // For imported keys, we need to extract the public key
      // This is a simplified implementation - in production use proper key parsing
      const mockPublicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIImported...';
      return {
        publicKey: mockPublicKey,
        algorithm: 'Ed25519',
        fingerprint: await this.generateFingerprint(mockPublicKey),
        encrypted: isEncrypted,
      };
    }

    throw new Error('Only Ed25519 private keys are supported');
  }

  private async importPrivateKey(privateKeyPEM: string, _algorithm: 'Ed25519'): Promise<CryptoKey> {
    if (!cryptoSubtle) {
      throw new Error('Crypto not available');
    }

    // Remove PEM headers and decode
    const pemContents = privateKeyPEM
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s/g, '');

    const keyData = this.base64ToArrayBuffer(pemContents);

    return cryptoSubtle.importKey(
      'pkcs8',
      keyData,
      {
        name: 'Ed25519',
      },
      false,
      ['sign']
    );
  }

  private convertEd25519ToSSHPublicKey(publicKeyBuffer: ArrayBuffer): string {
    // Convert raw Ed25519 public key to SSH format
    const publicKeyBytes = new Uint8Array(publicKeyBuffer);

    // SSH Ed25519 public key format:
    // string "ssh-ed25519" + string (32-byte public key)
    const keyType = 'ssh-ed25519';
    const keyTypeBytes = new TextEncoder().encode(keyType);

    // Build the SSH wire format
    const buffer = new ArrayBuffer(4 + keyTypeBytes.length + 4 + publicKeyBytes.length);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let offset = 0;

    // Write key type length and key type
    view.setUint32(offset, keyTypeBytes.length, false);
    offset += 4;
    bytes.set(keyTypeBytes, offset);
    offset += keyTypeBytes.length;

    // Write public key length and public key
    view.setUint32(offset, publicKeyBytes.length, false);
    offset += 4;
    bytes.set(publicKeyBytes, offset);

    // Base64 encode the result
    const base64Key = this.arrayBufferToBase64(buffer);
    return `ssh-ed25519 ${base64Key}`;
  }

  private async generateFingerprint(publicKey: string): Promise<string> {
    if (!cryptoSubtle) {
      throw new Error('Crypto not available');
    }

    const encoder = new TextEncoder();
    const hash = await cryptoSubtle.digest('SHA-256', encoder.encode(publicKey));
    return this.arrayBufferToBase64(hash).substring(0, 16);
  }

  private generateKeyId(): string {
    return window.crypto.randomUUID();
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private arrayBufferToPEM(buffer: ArrayBuffer, type: string): string {
    const base64 = this.arrayBufferToBase64(buffer);
    const lines = base64.match(/.{1,64}/g) || [];
    return `-----BEGIN ${type}-----\n${lines.join('\n')}\n-----END ${type}-----`;
  }

  private async loadKeysFromStorage(): Promise<void> {
    try {
      const keysData = localStorage.getItem(this.storageKey);
      if (keysData) {
        // Load directly without decryption
        const keys: SSHKey[] = JSON.parse(keysData);
        this.keys.clear();
        keys.forEach((key) => this.keys.set(key.id, key));
      }
    } catch (error) {
      console.error('Failed to load SSH keys from storage:', error);
    }
  }

  private async saveKeysToStorage(): Promise<void> {
    try {
      const keysArray = Array.from(this.keys.values());
      // Store directly without encryption
      localStorage.setItem(this.storageKey, JSON.stringify(keysArray));
    } catch (error) {
      console.error('Failed to save SSH keys to storage:', error);
    }
  }

  /**
   * Encrypt private key with password using Web Crypto API
   */
  private async encryptPrivateKey(privateKeyPEM: string, password: string): Promise<string> {
    if (!cryptoSubtle) {
      throw new Error('Crypto not available');
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(privateKeyPEM);

    // Derive key from password using PBKDF2
    const passwordKey = await cryptoSubtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    // Generate random salt
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // Derive encryption key
    const encryptionKey = await cryptoSubtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt the data
    const encryptedData = await cryptoSubtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, data);

    // Combine salt + iv + encrypted data and base64 encode
    const combined = new Uint8Array(salt.length + iv.length + encryptedData.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encryptedData), salt.length + iv.length);

    return `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${this.arrayBufferToBase64(combined.buffer)}\n-----END ENCRYPTED PRIVATE KEY-----`;
  }

  /**
   * Decrypt private key with password
   */
  private async decryptPrivateKey(
    encryptedPrivateKeyPEM: string,
    password: string
  ): Promise<string> {
    if (!cryptoSubtle) {
      throw new Error('Crypto not available');
    }

    // Extract base64 data
    const base64Data = encryptedPrivateKeyPEM
      .replace('-----BEGIN ENCRYPTED PRIVATE KEY-----', '')
      .replace('-----END ENCRYPTED PRIVATE KEY-----', '')
      .replace(/\s/g, '');

    const combinedData = this.base64ToArrayBuffer(base64Data);
    const combined = new Uint8Array(combinedData);

    // Extract salt, iv, and encrypted data
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const encryptedData = combined.slice(28);

    const encoder = new TextEncoder();

    // Derive key from password
    const passwordKey = await cryptoSubtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const encryptionKey = await cryptoSubtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    // Decrypt the data
    const decryptedData = await cryptoSubtle.decrypt(
      { name: 'AES-GCM', iv },
      encryptionKey,
      encryptedData
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedData);
  }

  /**
   * Prompt user for password using browser dialog
   */
  private async promptForPassword(keyName: string): Promise<string | null> {
    return window.prompt(`Enter password for SSH key "${keyName}":`);
  }
}
