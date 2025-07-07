import os from 'node:os';

const BonjourLib = require('bonjour-service');

import type { Service } from 'bonjour-service';
import { createLogger } from '../utils/logger.js';

const log = createLogger('mdns-service');

export class MDNSService {
  // biome-ignore lint/suspicious/noExplicitAny: bonjour-service doesn't export proper types
  private bonjour: any = null;
  private service: Service | null = null;
  private isAdvertising = false;

  /**
   * Start advertising the VibeTunnel service via mDNS/Bonjour
   */
  async startAdvertising(port: number, instanceName?: string): Promise<void> {
    if (this.isAdvertising) {
      log.warn('mDNS service already advertising');
      return;
    }

    try {
      this.bonjour = new BonjourLib();

      // Use hostname or custom name as the instance name
      const name = instanceName || os.hostname() || 'VibeTunnel Server';

      // Advertise the service
      if (!this.bonjour) {
        throw new Error('Failed to initialize Bonjour');
      }
      this.service = this.bonjour.publish({
        name,
        type: '_vibetunnel._tcp',
        port,
        txt: {
          version: '1.0',
          platform: process.platform,
        },
      });

      this.isAdvertising = true;
      log.log(`Started mDNS advertisement: ${name} on port ${port}`);

      // Handle service events
      if (this.service) {
        this.service.on('up', () => {
          log.debug('mDNS service is up');
        });

        this.service.on('error', (...args: unknown[]) => {
          log.error('mDNS service error:', args[0]);
        });
      }
    } catch (error) {
      log.error('Failed to start mDNS advertisement:', error);
      throw error;
    }
  }

  /**
   * Stop advertising the service
   */
  async stopAdvertising(): Promise<void> {
    if (!this.isAdvertising) {
      return;
    }

    try {
      if (this.service) {
        await new Promise<void>((resolve) => {
          if (this.service && typeof this.service.stop === 'function') {
            this.service.stop(() => {
              log.debug('mDNS service stopped');
              resolve();
            });
          } else {
            resolve();
          }
        });
        this.service = null;
      }

      if (this.bonjour) {
        this.bonjour.destroy();
        this.bonjour = null;
      }

      this.isAdvertising = false;
      log.log('Stopped mDNS advertisement');
    } catch (error) {
      log.error('Error stopping mDNS advertisement:', error);
    }
  }

  /**
   * Check if the service is currently advertising
   */
  isActive(): boolean {
    return this.isAdvertising;
  }
}

// Singleton instance
export const mdnsService = new MDNSService();
