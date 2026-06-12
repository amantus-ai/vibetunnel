import { type ChildProcess, spawn } from 'child_process';
import { createLogger } from '../utils/logger.js';

export interface TunnelInfo {
  publicUrl: string;
  proto: string;
  name: string;
  uri: string;
}

export interface TunnelStartupConfig {
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

export type TunnelOutputSource = 'stdout' | 'stderr';

export abstract class TunnelServiceBase {
  protected readonly logger: ReturnType<typeof createLogger>;
  protected readonly startupTimeoutMs: number;
  protected readonly shutdownTimeoutMs: number;

  private process: ChildProcess | null = null;
  private currentTunnel: TunnelInfo | null = null;
  private isRunning = false;

  constructor(
    loggerName: string,
    protected readonly port: number,
    config: TunnelStartupConfig = {}
  ) {
    this.logger = createLogger(loggerName);
    this.startupTimeoutMs = config.startupTimeoutMs ?? 30_000;
    this.shutdownTimeoutMs = config.shutdownTimeoutMs ?? 5_000;
  }

  protected abstract getServiceName(): string;
  protected abstract getProcessName(): string;
  protected abstract getBinaryPaths(): string[];
  protected abstract getBinaryVersionArgs(): string[];
  protected abstract getBinaryNotFoundMessage(): string;
  protected abstract getStartupTimeoutMessage(): string;
  protected abstract buildStartArgs(): string[];
  protected abstract parseOutput(output: string, source: TunnelOutputSource): string | null;
  protected abstract createTunnelInfo(publicUrl: string): TunnelInfo;

  protected async checkBinary(): Promise<string | null> {
    for (const binaryPath of this.getBinaryPaths()) {
      const available = await new Promise<boolean>((resolve) => {
        const process = spawn(binaryPath, this.getBinaryVersionArgs(), { stdio: 'ignore' });
        let settled = false;

        const finish = (result: boolean) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          resolve(result);
        };

        const timeout = setTimeout(() => {
          process.kill();
          finish(false);
        }, 2_000);

        process.once('close', (code) => finish(code === 0));
        process.once('error', () => finish(false));
      });

      if (available) {
        this.logger.debug(`Found ${this.getServiceName()} at: ${binaryPath}`);
        return binaryPath;
      }
    }

    return null;
  }

  async start(): Promise<TunnelInfo> {
    if (this.isRunning && this.currentTunnel) {
      this.logger.warn(`${this.getServiceName()} tunnel is already running`);
      return this.currentTunnel;
    }

    const binaryPath = await this.checkBinary();
    if (!binaryPath) {
      throw new Error(this.getBinaryNotFoundMessage());
    }

    this.logger.log(`Starting ${this.getServiceName()} tunnel on port ${this.port}...`);

    return new Promise((resolve, reject) => {
      const process = spawn(binaryPath, this.buildStartArgs(), {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.process = process;
      let settled = false;

      const finish = (error?: Error, tunnel?: TunnelInfo) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(startupTimeout);

        if (error) {
          reject(error);
        } else if (tunnel) {
          resolve(tunnel);
        }
      };

      const handleOutput = (source: TunnelOutputSource) => (data: Buffer) => {
        const publicUrl = this.parseOutput(data.toString(), source);
        if (!publicUrl || settled) {
          return;
        }

        const tunnel = this.createTunnelInfo(publicUrl);
        this.currentTunnel = tunnel;
        this.isRunning = true;
        this.logger.log(`${this.getServiceName()} tunnel started: ${publicUrl}`);
        finish(undefined, tunnel);
      };

      process.stdout?.on('data', handleOutput('stdout'));
      process.stderr?.on('data', handleOutput('stderr'));

      process.once('error', (error) => {
        this.clearProcessState(process);
        finish(new Error(`Failed to start ${this.getProcessName()}: ${error.message}`));
      });

      process.once('close', (code) => {
        this.clearProcessState(process);
        if (!settled) {
          finish(
            new Error(
              `${this.getProcessName()} process exited before tunnel startup${
                code === null ? '' : ` (code ${code})`
              }`
            )
          );
        } else if (code !== 0 && code !== null) {
          this.logger.error(`${this.getProcessName()} process exited with code ${code}`);
        }
      });

      const startupTimeout = setTimeout(() => {
        if (settled) {
          return;
        }
        finish(new Error(this.getStartupTimeoutMessage()));
        void this.stop();
      }, this.startupTimeoutMs);
    });
  }

  async stop(): Promise<void> {
    const process = this.process;
    if (!process) {
      return;
    }

    this.logger.log(`Stopping ${this.getServiceName()} tunnel...`);

    await new Promise<void>((resolve) => {
      let settled = false;

      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(killTimeout);
        this.clearProcessState(process);
        resolve();
      };

      const killTimeout = setTimeout(() => {
        this.logger.warn(`${this.getProcessName()} process did not exit gracefully, forcing kill`);
        process.kill('SIGKILL');
        finish();
      }, this.shutdownTimeoutMs);

      process.once('close', finish);
      process.kill('SIGTERM');
    });

    this.logger.log(`${this.getServiceName()} tunnel stopped`);
  }

  getTunnel(): TunnelInfo | null {
    return this.currentTunnel;
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getPublicUrl(): string | null {
    return this.currentTunnel?.publicUrl ?? null;
  }

  private clearProcessState(process: ChildProcess): void {
    if (this.process !== process) {
      return;
    }
    this.process = null;
    this.currentTunnel = null;
    this.isRunning = false;
  }
}
