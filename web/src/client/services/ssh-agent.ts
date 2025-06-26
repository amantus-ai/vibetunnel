// Use Web Crypto API available in browsers and Node.js (via globalThis)
const { subtle } = globalThis.crypto;

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

  constructor(customStorageKey?: string) {
    this.storageKey = customStorageKey || BrowserSSHAgent.DEFAULT_STORAGE_KEY;
    this.loadKeysFromStorage();
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
      const signature = await subtle.sign({ name: 'Ed25519' }, privateKey, dataBuffer);

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
    console.log(`🔑 SSH Agent: Starting Ed25519 key generation for "${name}"`);

    try {
      const keyPair = await subtle.generateKey(
        {
          name: 'Ed25519',
        } as AlgorithmIdentifier,
        true,
        ['sign', 'verify']
      );

      // Export keys
      const cryptoKeyPair = keyPair as CryptoKeyPair;
      const privateKeyBuffer = await subtle.exportKey('pkcs8', cryptoKeyPair.privateKey);
      const publicKeyBuffer = await subtle.exportKey('raw', cryptoKeyPair.publicKey);

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
    // Remove PEM headers and decode
    const pemContents = privateKeyPEM
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s/g, '');

    const keyData = this.base64ToArrayBuffer(pemContents);

    return subtle.importKey(
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
    const encoder = new TextEncoder();
    const hash = await subtle.digest('SHA-256', encoder.encode(publicKey));
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
    const encoder = new TextEncoder();
    const data = encoder.encode(privateKeyPEM);

    // Derive key from password using PBKDF2
    const passwordKey = await subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    // Generate random salt
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // Derive encryption key
    const encryptionKey = await subtle.deriveKey(
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
    const encryptedData = await subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, data);

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
    const passwordKey = await subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const encryptionKey = await subtle.deriveKey(
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
    const decryptedData = await subtle.decrypt(
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
