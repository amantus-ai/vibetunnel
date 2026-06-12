import * as os from 'os';
import * as path from 'path';
import {
  type TunnelInfo,
  type TunnelOutputSource,
  TunnelServiceBase,
} from './tunnel-service-base.js';

export class CloudflareService extends TunnelServiceBase {
  constructor(port: number) {
    super('cloudflare-service', port);
  }

  protected getServiceName(): string {
    return 'Cloudflare';
  }

  protected getProcessName(): string {
    return 'cloudflared';
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

  protected getBinaryNotFoundMessage(): string {
    return 'cloudflared binary not found. Please install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/';
  }

  protected getStartupTimeoutMessage(): string {
    return 'Cloudflare tunnel startup timeout - tunnel failed to start';
  }

  protected buildStartArgs(): string[] {
    // Use Quick Tunnel (no auth required)
    return ['tunnel', '--url', `http://localhost:${this.port}`];
  }

  protected parseOutput(output: string, _source: TunnelOutputSource): string | null {
    this.logger.debug('Cloudflare output:', output);

    const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (!urlMatch && output.toLowerCase().includes('error')) {
      this.logger.error('Cloudflare error:', output);
    }
    return urlMatch ? urlMatch[0] : null;
  }

  protected createTunnelInfo(publicUrl: string): TunnelInfo {
    return {
      publicUrl,
      proto: 'https',
      name: 'cloudflare-quick-tunnel',
      uri: `http://localhost:${this.port}`,
    };
  }

  async checkInstallation(): Promise<boolean> {
    return (await this.checkBinary()) !== null;
  }
}
