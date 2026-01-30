import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { authenticate as pamAuthenticate } from './authenticate-pam-loader.js';

interface AuthChallenge {
  challengeId: string;
  challenge: Buffer;
  timestamp: number;
  userId: string;
}

interface AuthResult {
  success: boolean;
  userId?: string;
  token?: string;
  error?: string;
}

interface SSHKeyAuth {
  publicKey: string;
  signature: string;
  challengeId: string;
}

export class AuthService {
  private challenges = new Map<string, AuthChallenge>();
  private jwtSecret: string;
  private challengeTimeout = 5 * 60 * 1000; // 5 minutes

  constructor() {
    // Generate or load JWT secret
    this.jwtSecret = process.env.JWT_SECRET || this.generateSecret();

    // Clean up expired challenges every minute
    setInterval(() => this.cleanupExpiredChallenges(), 60000);
  }

  private generateSecret(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  private cleanupExpiredChallenges(): void {
    const now = Date.now();
    for (const [id, challenge] of this.challenges.entries()) {
      if (now - challenge.timestamp > this.challengeTimeout) {
        this.challenges.delete(id);
      }
    }
  }

  /**
   * Authenticate user with SSH key (priority method)
   */
  async authenticateWithSSHKey(sshKeyAuth: SSHKeyAuth): Promise<AuthResult> {
    try {
      const challenge = this.challenges.get(sshKeyAuth.challengeId);
      if (!challenge) {
        return { success: false, error: 'Invalid or expired challenge' };
      }

      // Verify the signature using the original public key string
      const signatureBuffer = Buffer.from(sshKeyAuth.signature, 'base64');
      const isValidSignature = this.verifySSHSignature(
        challenge.challenge,
        signatureBuffer,
        sshKeyAuth.publicKey
      );

      if (!isValidSignature) {
        return { success: false, error: 'Invalid SSH key signature' };
      }

      // Check if this key is authorized for the user
      const isAuthorized = await this.checkSSHKeyAuthorization(
        challenge.userId,
        sshKeyAuth.publicKey
      );
      if (!isAuthorized) {
        return { success: false, error: 'SSH key not authorized for this user' };
      }

      // Clean up challenge
      this.challenges.delete(sshKeyAuth.challengeId);

      // Generate JWT token
      const token = this.generateToken(challenge.userId);

      return {
        success: true,
        userId: challenge.userId,
        token,
      };
    } catch (error) {
      console.error('SSH key authentication error:', error);
      return { success: false, error: 'SSH key authentication failed' };
    }
  }

  /**
   * Authenticate user with PAM (fallback method)
   */
  async authenticateWithPassword(userId: string, password: string): Promise<AuthResult> {
    try {
      // Check environment variables first (for testing and simple deployments)
      const envUsername = process.env.VIBETUNNEL_USERNAME;
      const envPassword = process.env.VIBETUNNEL_PASSWORD;

      if (envUsername && envPassword) {
        // Use environment variable authentication
        if (userId === envUsername && password === envPassword) {
          const token = this.generateToken(userId);
          return {
            success: true,
            userId,
            token,
          };
        } else {
          return { success: false, error: 'Invalid username or password' };
        }
      }

      // Fall back to PAM authentication
      const isValid = await this.verifyPAMCredentials(userId, password);
      if (!isValid) {
        return { success: false, error: 'Invalid username or password' };
      }

      const token = this.generateToken(userId);

      return {
        success: true,
        userId,
        token,
      };
    } catch (error) {
      console.error('PAM authentication error:', error);
      return { success: false, error: 'Authentication failed' };
    }
  }

  /**
   * Create authentication challenge for SSH key auth
   */
  createChallenge(userId: string): { challengeId: string; challenge: string } {
    const challengeId = crypto.randomUUID();
    const challenge = crypto.randomBytes(32);

    this.challenges.set(challengeId, {
      challengeId,
      challenge,
      timestamp: Date.now(),
      userId,
    });

    return {
      challengeId,
      challenge: challenge.toString('base64'),
    };
  }

  /**
   * Verify JWT token
   */
  verifyToken(token: string): { valid: boolean; userId?: string } {
    try {
      const payload = jwt.verify(token, this.jwtSecret) as jwt.JwtPayload & { userId: string };
      return { valid: true, userId: payload.userId };
    } catch (_error) {
      return { valid: false };
    }
  }

  /**
   * Generate JWT token (public wrapper for Tailscale auth)
   */
  generateTokenForUser(userId: string): string {
    return this.generateToken(userId);
  }

  /**
   * Generate JWT token
   */
  private generateToken(userId: string): string {
    return jwt.sign({ userId, iat: Math.floor(Date.now() / 1000) }, this.jwtSecret, {
      expiresIn: '24h',
    });
  }

  /**
   * Verify credentials using PAM
   */
  private async verifyPAMCredentials(username: string, password: string): Promise<boolean> {
    return new Promise((resolve) => {
      pamAuthenticate(username, password, (err: Error | null) => {
        if (err) {
          console.error('PAM authentication failed:', err.message);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  /**
   * Verify SSH signature
   */
  private verifySSHSignature(challenge: Buffer, signature: Buffer, publicKeyStr: string): boolean {
    try {
      // Basic sanity checks
      if (!challenge || !signature || !publicKeyStr) {
        console.error('Missing required parameters for signature verification');
        return false;
      }

      const keyParts = publicKeyStr.trim().split(' ');
      if (keyParts.length < 2) {
        console.error('Invalid SSH public key format');
        return false;
      }

      const keyType = keyParts[0];
      const keyData = keyParts[1];

      if (keyType === 'ssh-ed25519') {
        // Check signature length
        if (signature.length !== 64) {
          console.error(`Invalid Ed25519 signature length: ${signature.length} (expected 64)`);
          return false;
        }

        // Decode the SSH public key
        const sshKeyBuffer = Buffer.from(keyData, 'base64');

        // Parse SSH wire format: length + "ssh-ed25519" + length + 32-byte key
        let offset = 0;

        // Skip algorithm name length and value
        const algLength = sshKeyBuffer.readUInt32BE(offset);
        offset += 4 + algLength;

        // Read public key length and value
        const keyLength = sshKeyBuffer.readUInt32BE(offset);
        offset += 4;

        if (keyLength !== 32) {
          console.error(`Invalid Ed25519 key length: ${keyLength} (expected 32)`);
          return false;
        }

        const rawPublicKey = sshKeyBuffer.subarray(offset, offset + 32);

        // Create a Node.js public key object
        const publicKey = crypto.createPublicKey({
          key: Buffer.concat([
            Buffer.from([0x30, 0x2a]), // DER sequence header
            Buffer.from([0x30, 0x05]), // Algorithm identifier sequence
            Buffer.from([0x06, 0x03, 0x2b, 0x65, 0x70]), // Ed25519 OID
            Buffer.from([0x03, 0x21, 0x00]), // Public key bit string
            rawPublicKey,
          ]),
          format: 'der',
          type: 'spki',
        });

        // Verify the signature
        const isValid = crypto.verify(null, challenge, publicKey, signature);
        console.log(`🔐 Ed25519 signature verification: ${isValid ? 'PASSED' : 'FAILED'}`);
        return isValid;
      }

      console.error(`Unsupported key type: ${keyType}`);
      return false;
    } catch (error) {
      console.error('SSH signature verification failed:', error);
      return false;
    }
  }

  /**
   * Check if SSH key is authorized for user
   */
  private async checkSSHKeyAuthorization(userId: string, publicKey: string): Promise<boolean> {
    try {
      const os = require('os');
      const fs = require('fs');
      const path = require('path');

      // Check user's authorized_keys file
      const homeDir = userId === process.env.USER ? os.homedir() : `/home/${userId}`;
      const authorizedKeysPath = path.join(homeDir, '.ssh', 'authorized_keys');

      if (!fs.existsSync(authorizedKeysPath)) {
        return false;
      }

      const authorizedKeys = fs.readFileSync(authorizedKeysPath, 'utf8');
      const keyParts = publicKey.trim().split(' ');
      const keyData = keyParts.length > 1 ? keyParts[1] : keyParts[0];

      // Check if the key exists in authorized_keys
      return authorizedKeys.includes(keyData);
    } catch (error) {
      console.error('Error checking SSH key authorization:', error);
      return false;
    }
  }

  /**
   * Get current system user
   */
  getCurrentUser(): string {
    return process.env.USER || process.env.USERNAME || 'unknown';
  }

  /**
   * Check if user exists on system
   */
  async userExists(userId: string): Promise<boolean> {
    try {
      const { spawnSync } = require('child_process');
      const result = spawnSync('id', [userId], { stdio: 'ignore' });
      return result.status === 0;
    } catch (_error) {
      return false;
    }
  }
}
