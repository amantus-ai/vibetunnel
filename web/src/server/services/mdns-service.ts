import { type ChildProcess, spawn } from 'node:child_process';
import os from 'node:os';
import { Bonjour, type Service } from 'bonjour-service';
import { createLogger } from '../utils/logger.js';

const log = createLogger('mdns-service');

export class MDNSService {
  private bonjour: InstanceType<typeof Bonjour> | null = null;
  private service: InstanceType<typeof Service> | null = null;
  private isAdvertising = false;
  private dnsSdProcess: ChildProcess | null = null;

  /**
   * Start advertising the VibeTunnel service via mDNS/Bonjour
   */
  async startAdvertising(port: number, instanceName?: string): Promise<void> {
    if (this.isAdvertising) {
      log.warn('mDNS service already advertising');
      return;
    }

    const name = instanceName || os.hostname() || 'VibeTunnel Server';

    try {
      this.bonjour = new Bonjour();

      // Advertise the service
      if (!this.bonjour) {
        throw new Error('Failed to initialize Bonjour');
      }
      this.service = this.bonjour.publish({
        name,
        type: 'vibetunnel',
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
          log.warn('mDNS service error:', args[0]);
        });
      }
    } catch (error) {
      log.warn('Failed to start mDNS advertisement:', error);

      if (this.bonjour) {
        try {
          this.bonjour.destroy();
        } catch {
          // Ignore cleanup errors
        }
        this.bonjour = null;
      }
      this.service = null;

      if (process.platform === 'darwin') {
        const startedFallback = await this.startDnsSdFallback(name, port);
        if (startedFallback) {
          this.isAdvertising = true;
          return;
        }
      }

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
      await this.stopDnsSdFallback();

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
      log.warn('Error stopping mDNS advertisement:', error);
    }
  }

  private async startDnsSdFallback(name: string, port: number): Promise<boolean> {
    if (this.dnsSdProcess) {
      return true;
    }

    try {
      const dnsSdProcess = spawn('dns-sd', ['-R', name, '_vibetunnel._tcp', 'local.', `${port}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      dnsSdProcess.on('error', (error) => {
        log.warn('dns-sd process error:', error);
      });

      dnsSdProcess.stdout.on('data', (data) => {
        const message = data.toString().trim();
        if (message.length) {
          log.debug(`dns-sd: ${message}`);
        }
      });

      dnsSdProcess.stderr.on('data', (data) => {
        const message = data.toString().trim();
        if (message.length) {
          log.warn(`dns-sd: ${message}`);
        }
      });

      this.dnsSdProcess = dnsSdProcess;
      log.log(`Started mDNS advertisement via dns-sd: ${name} on port ${port}`);
      return true;
    } catch (error) {
      log.warn('Failed to start dns-sd fallback:', error);
      return false;
    }
  }

  private async stopDnsSdFallback(): Promise<void> {
    const dnsSdProcess = this.dnsSdProcess;
    if (!dnsSdProcess) {
      return;
    }

    this.dnsSdProcess = null;

    await new Promise<void>((resolve) => {
      dnsSdProcess.once('exit', () => resolve());
      dnsSdProcess.kill();
      setTimeout(() => resolve(), 1000);
    });
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
