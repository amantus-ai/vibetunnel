import * as os from 'os';
import * as path from 'path';
import { TunnelServiceBase, type TunnelInfo } from './tunnel-service-base.js';

// Re-export for backward compatibility
export type CloudflareTunnel = TunnelInfo;

/**
 * Cloudflare Quick Tunnel service implementation.
 *
 * Extends TunnelServiceBase with cloudflared-specific:
 * - Binary paths for cloudflared installation locations
 * - URL regex parsing for trycloudflare.com tunnel URLs
 * - No authentication required (uses Cloudflare Quick Tunnels)
 */
export class CloudflareService extends TunnelServiceBase {
  // Store binary path after first lookup for checkInstallation()
  private cloudflaredPath: string | null = null;

  constructor(port: number) {
    super('cloudflare-service', port);
  }

  protected getServiceName(): string {
    return 'Cloudflare';
  }

  protected getBinaryPaths(): string[] {
    return [
      'cloudflared', // Global PATH
      '/usr/local/bin/cloudflared',
      '/opt/homebrew/bin/cloudflared',
      '/usr/bin/cloudflared',
      path.join(os.homedir(), '.cloudflared', 'cloudflared'),
      // Windows paths
      'C:\\Program Files\\Cloudflare\\cloudflared\\cloudflared.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'cloudflared', 'cloudflared.exe'),
    ];
  }

  protected getBinaryVersionArgs(): string[] {
    return ['--version'];
  }

  protected buildStartArgs(): string[] {
    // Use Quick Tunnel (no auth required)
    return ['tunnel', '--url', `http://localhost:${this.port}`];
  }

  protected parseOutput(output: string): string | null {
    // Cloudflare outputs URL like: "https://random-words.trycloudflare.com"
    const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    return urlMatch ? urlMatch[0] : null;
  }

  /**
   * Check if cloudflared is installed.
   * Caches the result for subsequent calls.
   */
  async checkInstallation(): Promise<boolean> {
    this.cloudflaredPath = await this.checkBinary();
    return this.cloudflaredPath !== null;
  }
}
