import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import webpush from 'web-push';
import { createLogger } from './logger.js';

const logger = createLogger('vapid-manager');

export interface VapidKeyPair {
  publicKey: string;
  privateKey: string;
}

export interface VapidConfig {
  keyPair: VapidKeyPair;
  contactEmail: string;
  enabled: boolean;
}

/**
 * Manages VAPID (Voluntary Application Server Identification) keys for web push notifications.
 *
 * This class handles the generation, storage, validation, and rotation of VAPID keys
 * used for authenticating push notifications sent from the VibeTunnel server to web clients.
 * It provides a complete lifecycle management system for VAPID credentials with secure
 * file-based persistence.
 *
 * Key features:
 * - Automatic key generation with secure storage (0600 permissions)
 * - Key rotation support for security best practices
 * - Validation of keys and email format
 * - Integration with web-push library for sending notifications
 * - Persistent storage in ~/.vibetunnel/vapid/keys.json
 *
 * @example
 * ```typescript
 * // Initialize VAPID manager with automatic key generation
 * const manager = new VapidManager();
 * const config = await manager.initialize({
 *   contactEmail: 'admin@example.com',
 *   generateIfMissing: true
 * });
 *
 * // Get public key for client registration
 * const publicKey = manager.getPublicKey();
 *
 * // Send a push notification
 * await manager.sendNotification(subscription, JSON.stringify({
 *   title: 'New Terminal Session',
 *   body: 'A new session has been created'
 * }));
 *
 * // Rotate keys for security
 * await manager.rotateKeys('admin@example.com');
 * ```
 */
export class VapidManager {
  private config: VapidConfig | null = null;
  private readonly vapidDir: string;
  private readonly keysFilePath: string;

  constructor(vapidDir?: string) {
    this.vapidDir = vapidDir || path.join(os.homedir(), '.vibetunnel/vapid');
    this.keysFilePath = path.join(this.vapidDir, 'keys.json');
  }

  /**
   * Initialize VAPID configuration
   */
  async initialize(options: {
    contactEmail?: string;
    publicKey?: string;
    privateKey?: string;
    generateIfMissing?: boolean;
  }): Promise<VapidConfig> {
    const { contactEmail, publicKey, privateKey, generateIfMissing = true } = options;

    // If both keys provided, use them
    if (publicKey && privateKey) {
      logger.log('Using provided VAPID keys');
      this.config = {
        keyPair: { publicKey, privateKey },
        contactEmail: contactEmail || 'noreply@vibetunnel.local',
        enabled: true,
      };
      await this.saveKeys(this.config.keyPair);
      this.configureWebPush();
      return this.config;
    }

    // Try to load existing keys
    const existingKeys = await this.loadKeys();
    if (existingKeys) {
      logger.log('Using existing VAPID keys');
      this.config = {
        keyPair: existingKeys,
        contactEmail: contactEmail || 'noreply@vibetunnel.local',
        enabled: true,
      };
      this.configureWebPush();
      return this.config;
    }

    // Generate new keys if requested
    if (generateIfMissing) {
      logger.log('Generating new VAPID keys');
      const newKeys = this.generateKeys();
      this.config = {
        keyPair: newKeys,
        contactEmail: contactEmail || 'noreply@vibetunnel.local',
        enabled: true,
      };
      await this.saveKeys(this.config.keyPair);
      this.configureWebPush();
      return this.config;
    }

    // No keys available and not generating
    logger.warn('No VAPID keys available and generation disabled');
    this.config = {
      keyPair: { publicKey: '', privateKey: '' },
      contactEmail: contactEmail || 'noreply@vibetunnel.local',
      enabled: false,
    };
    return this.config;
  }

  /**
   * Generate new VAPID key pair
   */
  generateKeys(): VapidKeyPair {
    logger.debug('Generating VAPID key pair');
    const keyPair = webpush.generateVAPIDKeys();
    return {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
    };
  }

  /**
   * Rotate VAPID keys (generate new ones and save)
   */
  async rotateKeys(contactEmail?: string): Promise<VapidKeyPair> {
    logger.log('Rotating VAPID keys');
    const newKeys = this.generateKeys();

    // Update config
    this.config = {
      keyPair: newKeys,
      contactEmail: contactEmail || this.config?.contactEmail || 'noreply@vibetunnel.local',
      enabled: true,
    };

    await this.saveKeys(newKeys);
    this.configureWebPush();

    logger.log('VAPID keys rotated successfully');
    return newKeys;
  }

  /**
   * Get current VAPID configuration
   */
  getConfig(): VapidConfig | null {
    return this.config;
  }

  /**
   * Get public key for client registration
   */
  getPublicKey(): string | null {
    return this.config?.keyPair.publicKey || null;
  }

  /**
   * Check if VAPID is properly configured and enabled
   */
  isEnabled(): boolean {
    return (
      this.config?.enabled === true &&
      !!this.config.keyPair.publicKey &&
      !!this.config.keyPair.privateKey
    );
  }

  /**
   * Validate VAPID configuration
   */
  validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.config) {
      errors.push('VAPID manager not initialized');
      return { valid: false, errors };
    }

    if (!this.config.keyPair.publicKey) {
      errors.push('Missing VAPID public key');
    }

    if (!this.config.keyPair.privateKey) {
      errors.push('Missing VAPID private key');
    }

    if (!this.config.contactEmail) {
      errors.push('Missing contact email for VAPID');
    }

    // Validate email format
    if (this.config.contactEmail && !this.isValidEmail(this.config.contactEmail)) {
      errors.push('Invalid contact email format');
    }

    // Validate key format (basic check)
    if (this.config.keyPair.publicKey && !this.isValidVapidKey(this.config.keyPair.publicKey)) {
      errors.push('Invalid VAPID public key format');
    }

    if (this.config.keyPair.privateKey && !this.isValidVapidKey(this.config.keyPair.privateKey)) {
      errors.push('Invalid VAPID private key format');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Save VAPID keys to disk
   */
  private async saveKeys(keyPair: VapidKeyPair): Promise<void> {
    try {
      // Ensure directory exists
      if (!fs.existsSync(this.vapidDir)) {
        fs.mkdirSync(this.vapidDir, { recursive: true });
        logger.debug(`Created VAPID directory: ${this.vapidDir}`);
      }

      const keyData = {
        publicKey: keyPair.publicKey,
        privateKey: keyPair.privateKey,
        generated: new Date().toISOString(),
      };

      fs.writeFileSync(this.keysFilePath, JSON.stringify(keyData, null, 2), {
        mode: 0o600, // Restrict access to owner only
      });

      logger.debug('VAPID keys saved to disk');
    } catch (error) {
      logger.error('Failed to save VAPID keys:', error);
      throw new Error(`Failed to save VAPID keys: ${error}`);
    }
  }

  /**
   * Load VAPID keys from disk
   */
  private async loadKeys(): Promise<VapidKeyPair | null> {
    try {
      if (!fs.existsSync(this.keysFilePath)) {
        logger.debug('No existing VAPID keys file found');
        return null;
      }

      const keyData = JSON.parse(fs.readFileSync(this.keysFilePath, 'utf8'));

      if (!keyData.publicKey || !keyData.privateKey) {
        logger.warn('Invalid VAPID keys file format');
        return null;
      }

      logger.debug('VAPID keys loaded from disk');
      return {
        publicKey: keyData.publicKey,
        privateKey: keyData.privateKey,
      };
    } catch (error) {
      logger.error('Failed to load VAPID keys:', error);
      return null;
    }
  }

  /**
   * Configure web-push library with current VAPID settings
   */
  private configureWebPush(): void {
    if (!this.config || !this.isEnabled()) {
      logger.debug('Skipping web-push configuration - VAPID not enabled');
      return;
    }

    try {
      webpush.setVapidDetails(
        `mailto:${this.config.contactEmail}`,
        this.config.keyPair.publicKey,
        this.config.keyPair.privateKey
      );
      logger.debug('Web-push library configured with VAPID details');
    } catch (error) {
      logger.error('Failed to configure web-push library:', error);
      throw new Error(`Failed to configure web-push: ${error}`);
    }
  }

  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Basic VAPID key format validation
   */
  private isValidVapidKey(key: string): boolean {
    // VAPID keys are base64url encoded and typically 65 characters for public keys
    // and 43 characters for private keys
    return typeof key === 'string' && key.length > 20 && /^[A-Za-z0-9_-]+$/.test(key);
  }

  /**
   * Get keys directory path (for external access)
   */
  getKeysDirectory(): string {
    return this.vapidDir;
  }

  /**
   * Remove saved keys from disk
   */
  async removeKeys(): Promise<void> {
    try {
      if (fs.existsSync(this.keysFilePath)) {
        fs.unlinkSync(this.keysFilePath);
        logger.log('VAPID keys removed from disk');
      }

      this.config = null;
    } catch (error) {
      logger.error('Failed to remove VAPID keys:', error);
      throw new Error(`Failed to remove VAPID keys: ${error}`);
    }
  }

  /**
   * Send push notification using configured VAPID keys
   */
  async sendNotification(
    subscription: webpush.PushSubscription,
    payload: string | Buffer | null,
    options?: webpush.RequestOptions
  ): Promise<webpush.SendResult> {
    if (!this.isEnabled()) {
      throw new Error('VAPID not properly configured');
    }

    try {
      return await webpush.sendNotification(subscription, payload, options);
    } catch (error) {
      logger.error('Failed to send push notification:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const vapidManager = new VapidManager();
