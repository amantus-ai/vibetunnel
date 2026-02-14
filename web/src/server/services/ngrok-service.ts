import * as os from 'os';
import * as path from 'path';
import { TunnelServiceBase, type TunnelInfo } from './tunnel-service-base.js';

export interface NgrokConfig {
  authToken?: string;
  domain?: string;
  port: number;
  region?: string;
}

// Re-export for backward compatibility
export type NgrokTunnel = TunnelInfo;

/**
 * Ngrok tunnel service implementation.
 *
 * Extends TunnelServiceBase with ngrok-specific:
 * - Binary paths for ngrok installation locations
 * - JSON log parsing for tunnel URL extraction
 * - Support for authToken, domain, and region configuration
 */
export class NgrokService extends TunnelServiceBase {
  private authToken?: string;
  private domain?: string;
  private region?: string;

  constructor(config: NgrokConfig) {
    super('ngrok-service', config.port);
    this.authToken = config.authToken;
    this.domain = config.domain;
    this.region = config.region;
  }

  protected getServiceName(): string {
    return 'ngrok';
  }

  protected getBinaryPaths(): string[] {
    return [
      'ngrok', // Global PATH
      '/usr/local/bin/ngrok',
      '/opt/homebrew/bin/ngrok',
      path.join(os.homedir(), '.local', 'bin', 'ngrok'),
      // Windows paths
      'C:\\Program Files\\ngrok\\ngrok.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'ngrok', 'ngrok.exe'),
    ];
  }

  protected getBinaryVersionArgs(): string[] {
    return ['version'];
  }

  protected buildStartArgs(): string[] {
    const args = ['http', String(this.port), '--log=stdout', '--log-format=json'];

    if (this.authToken) {
      args.push('--authtoken', this.authToken);
    }

    if (this.domain) {
      args.push('--domain', this.domain);
    }

    if (this.region) {
      args.push('--region', this.region);
    }

    return args;
  }

  protected parseOutput(output: string): string | null {
    // Ngrok outputs JSON logs, parse each line
    const lines = output.split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const log = JSON.parse(line);

        // Look for tunnel started message
        if (log.msg === 'started tunnel' && log.url) {
          return log.url;
        }

        // Log errors for debugging
        if (log.lvl === 'error' || log.err) {
          this.logger.error('Ngrok error:', log.err || log.msg);
        }
      } catch {
        // Not JSON, skip (already logged by base class)
      }
    }

    return null;
  }
}
