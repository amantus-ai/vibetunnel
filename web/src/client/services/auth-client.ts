import { HttpMethod } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';
import { BrowserSSHAgent } from './ssh-agent.js';

const logger = createLogger('auth-client');

interface AuthResponse {
  success: boolean;
  token?: string;
  userId?: string;
  authMethod?: 'ssh-key' | 'password' | 'tailscale';
  error?: string;
}

interface Challenge {
  challengeId: string;
  challenge: string;
  expiresAt: number;
}

interface User {
  userId: string;
  token: string;
  authMethod: 'ssh-key' | 'password' | 'tailscale';
  loginTime: number;
}

/**
 * Authentication client for managing user authentication state and operations.
 *
 * Handles multiple authentication methods including SSH key-based authentication
 * (priority) and password-based authentication (fallback). Manages authentication
 * tokens, user sessions, and provides authenticated API request capabilities.
 *
 * Features:
 * - SSH key authentication using browser-based SSH agent
 * - Password authentication fallback
 * - Persistent token storage and validation
 * - User avatar retrieval with platform-specific support
 * - Automatic authentication flow (tries SSH keys first)
 *
 * @example
 * ```typescript
 * const auth = new AuthClient();
 *
 * // Check authentication status
 * if (!auth.isAuthenticated()) {
 *   // Try SSH key auth first, then password
 *   const result = await auth.authenticate(userId);
 * }
 *
 * // Make authenticated API requests
 * const response = await auth.fetch('/api/sessions');
 * ```
 *
 * @see BrowserSSHAgent - Browser-based SSH key management
 * @see web/src/server/routes/auth.ts - Server-side authentication endpoints
 */
export class AuthClient {
  private static readonly TOKEN_KEY = 'vibetunnel_auth_token';
  private static readonly USER_KEY = 'vibetunnel_user_data';

  private currentUser: User | null = null;
  private sshAgent: BrowserSSHAgent;

  constructor() {
    this.sshAgent = new BrowserSSHAgent();
    this.loadCurrentUser();
  }

  /**
   * Get SSH agent instance
   */
  getSSHAgent(): BrowserSSHAgent {
    return this.sshAgent;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.currentUser !== null && this.isTokenValid();
  }

  /**
   * Get current user info
   */
  getCurrentUser(): User | null {
    return this.currentUser;
  }

  /**
   * Set current user from externally-provided token (e.g. Tailscale auth)
   */
  setCurrentUserFromToken(userId: string, token: string, authMethod: User['authMethod']): void {
    this.setCurrentUser({
      userId,
      token,
      authMethod,
      loginTime: Date.now(),
    });
  }

  /**
   * Get current system user from server
   */
  async getCurrentSystemUser(): Promise<string> {
    try {
      const response = await fetch('/api/auth/current-user');
      if (response.ok) {
        const data = await response.json();
        return data.userId;
      }
      throw new Error('Failed to get current user');
    } catch (error) {
      logger.error('Failed to get current system user:', error);
      throw error;
    }
  }

  /**
   * Get user avatar (macOS returns base64, others get generic)
   */
  async getUserAvatar(userId: string): Promise<string> {
    try {
      const response = await fetch(`/api/auth/avatar/${userId}`);
      if (response.ok) {
        const data = await response.json();

        if (data.avatar) {
          // If it's a data URL (base64), return as is
          if (data.avatar.startsWith('data:')) {
            return data.avatar;
          }
          // If it's a file path, we'd need to handle that differently
          // For now, fall back to generic avatar
        }
      }
    } catch (error) {
      logger.error('Failed to get user avatar:', error);
    }

    // Return generic avatar SVG for non-macOS or when no avatar found
    // Get computed theme colors from CSS variables
    const computedStyle = getComputedStyle(document.documentElement);
    const bgColor = computedStyle
      .getPropertyValue('--color-text-dim')
      .trim()
      .split(' ')
      .map((v) => Number.parseInt(v, 10));
    const fgColor = computedStyle
      .getPropertyValue('--color-text-muted')
      .trim()
      .split(' ')
      .map((v) => Number.parseInt(v, 10));
    const bgColorStr = `rgb(${bgColor.join(', ')})`;
    const fgColorStr = `rgb(${fgColor.join(', ')})`;

    return (
      'data:image/svg+xml;base64,' +
      btoa(`
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="24" fill="${bgColorStr}"/>
        <circle cx="24" cy="18" r="8" fill="${fgColorStr}"/>
        <path d="M8 38c0-8.837 7.163-16 16-16s16 7.163 16 16" fill="${fgColorStr}"/>
      </svg>
    `)
    );
  }

  /**
   * Authenticate using SSH key (priority method)
   */
  async authenticateWithSSHKey(userId: string, keyId: string): Promise<AuthResponse> {
    try {
      // Check if SSH agent is unlocked
      if (!this.sshAgent.isUnlocked()) {
        return { success: false, error: 'SSH agent is locked' };
      }

      // Create challenge
      const challenge = await this.createChallenge(userId);

      // Sign challenge with SSH key
      const signatureResult = await this.sshAgent.sign(keyId, challenge.challenge);
      const publicKey = this.sshAgent.getPublicKey(keyId);

      if (!publicKey) {
        return { success: false, error: 'SSH key not found' };
      }

      // Send authentication request
      const response = await fetch('/api/auth/ssh-key', {
        method: HttpMethod.POST,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          publicKey,
          signature: signatureResult.signature,
        }),
      });

      const result = await response.json();
      logger.log('🔐 SSH key auth server response:', result);

      if (result.success) {
        logger.log('✅ SSH key auth successful, setting current user');
        this.setCurrentUser({
          userId: result.userId,
          token: result.token,
          authMethod: 'ssh-key',
          loginTime: Date.now(),
        });
        logger.log('👤 Current user set:', this.getCurrentUser());
      } else {
        logger.log('❌ SSH key auth failed:', result.error);
      }

      return result;
    } catch (error) {
      logger.error('SSH key authentication failed:', error);
      return { success: false, error: 'SSH key authentication failed' };
    }
  }

  /**
   * Authenticate using password (fallback method)
   */
  async authenticateWithPassword(userId: string, password: string): Promise<AuthResponse> {
    try {
      const response = await fetch('/api/auth/password', {
        method: HttpMethod.POST,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, password }),
      });

      const result = await response.json();

      if (result.success) {
        this.setCurrentUser({
          userId: result.userId,
          token: result.token,
          authMethod: 'password',
          loginTime: Date.now(),
        });
      }

      return result;
    } catch (error) {
      logger.error('Password authentication failed:', error);
      return { success: false, error: 'Password authentication failed' };
    }
  }

  /**
   * Automated authentication - tries SSH keys first, then prompts for password
   */
  async authenticate(userId: string): Promise<AuthResponse> {
    logger.log('🚀 Starting SSH authentication for user:', userId);

    // Try SSH key authentication first if agent is unlocked
    if (this.sshAgent.isUnlocked()) {
      const keys = this.sshAgent.listKeys();
      logger.log(
        '🗝️ Found SSH keys:',
        keys.length,
        keys.map((k) => ({ id: k.id, name: k.name }))
      );

      for (const key of keys) {
        try {
          logger.log(`🔑 Trying SSH key: ${key.name} (${key.id})`);
          const result = await this.authenticateWithSSHKey(userId, key.id);
          logger.log(`🎯 SSH key ${key.name} result:`, result);

          if (result.success) {
            logger.log(`✅ Authenticated with SSH key: ${key.name}`);
            return result;
          }
        } catch (error) {
          logger.warn(`❌ SSH key authentication failed for key ${key.name}:`, error);
        }
      }
    } else {
      logger.log('🔒 SSH agent is locked');
    }

    // SSH key auth failed or no keys available
    return {
      success: false,
      error: 'SSH key authentication failed. Password authentication required.',
    };
  }

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    try {
      // Call server logout endpoint
      if (this.currentUser?.token) {
        await fetch('/api/auth/logout', {
          method: HttpMethod.POST,
          headers: {
            Authorization: `Bearer ${this.currentUser.token}`,
            'Content-Type': 'application/json',
          },
        });
      }
    } catch (error) {
      logger.warn('Server logout failed:', error);
    } finally {
      // Clear local state
      this.clearCurrentUser();
    }
  }

  /**
   * Get authorization header for API requests
   */
  getAuthHeader(): Record<string, string> {
    if (this.currentUser?.token) {
      return { Authorization: `Bearer ${this.currentUser.token}` };
    }
    // No warning needed when token is not available
    return {};
  }

  /**
   * Authenticated fetch wrapper that adds authorization header
   */
  async fetch(url: string, options?: RequestInit): Promise<Response> {
    const headers = {
      ...this.getAuthHeader(),
      ...(options?.headers || {}),
    };

    return fetch(url, {
      ...options,
      headers,
    });
  }

  /**
   * Verify current token with server
   */
  async verifyToken(): Promise<boolean> {
    if (!this.currentUser?.token) return false;

    try {
      const response = await fetch('/api/auth/verify', {
        headers: { Authorization: `Bearer ${this.currentUser.token}` },
      });

      const result = await response.json();
      return result.valid;
    } catch (error) {
      logger.error('Token verification failed:', error);
      return false;
    }
  }

  /**
   * Unlock SSH agent (no-op since we don't use encryption)
   */
  async unlockSSHAgent(_passphrase: string): Promise<boolean> {
    return true; // Always unlocked
  }

  /**
   * Lock SSH agent (no-op since we don't use encryption)
   */
  lockSSHAgent(): void {
    // No-op since agent is always unlocked
  }

  /**
   * Check if SSH agent is unlocked
   */
  isSSHAgentUnlocked(): boolean {
    return true; // Always unlocked since we don't use encryption
  }

  // Private methods

  private async createChallenge(userId: string): Promise<Challenge> {
    const response = await fetch('/api/auth/challenge', {
      method: HttpMethod.POST,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      throw new Error('Failed to create authentication challenge');
    }

    return response.json();
  }

  private setCurrentUser(user: User): void {
    this.currentUser = user;
    this.saveCurrentUser();
  }

  private clearCurrentUser(): void {
    this.currentUser = null;
    localStorage.removeItem(AuthClient.TOKEN_KEY);
    localStorage.removeItem(AuthClient.USER_KEY);
  }

  private saveCurrentUser(): void {
    if (this.currentUser) {
      localStorage.setItem(AuthClient.TOKEN_KEY, this.currentUser.token);
      localStorage.setItem(
        AuthClient.USER_KEY,
        JSON.stringify({
          userId: this.currentUser.userId,
          authMethod: this.currentUser.authMethod,
          loginTime: this.currentUser.loginTime,
        })
      );
    }
  }

  private loadCurrentUser(): void {
    try {
      const token = localStorage.getItem(AuthClient.TOKEN_KEY);
      const userData = localStorage.getItem(AuthClient.USER_KEY);

      if (token && userData) {
        const user = JSON.parse(userData);
        this.currentUser = {
          token,
          userId: user.userId,
          authMethod: user.authMethod,
          loginTime: user.loginTime,
        };

        // Verify token is still valid
        this.verifyToken().then((valid) => {
          if (!valid) {
            this.clearCurrentUser();
          }
        });
      }
    } catch (error) {
      logger.error('Failed to load current user:', error);
      this.clearCurrentUser();
    }
  }

  private isTokenValid(): boolean {
    if (!this.currentUser) return false;

    // Check if token is expired (24 hours)
    const tokenAge = Date.now() - this.currentUser.loginTime;
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    return tokenAge < maxAge;
  }
}

// Export singleton instance
export const authClient = new AuthClient();
