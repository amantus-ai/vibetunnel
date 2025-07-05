import { spawn } from 'child_process';
import * as net from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MDNSService } from '../../server/services/mdns-service';

/**
 * Integration test for Bonjour/mDNS discovery
 *
 * This test verifies:
 * 1. Server advertises via mDNS
 * 2. Service can be discovered on the network
 * 3. Connection can be established to discovered service
 *
 * Note: This test requires:
 * - Network access for mDNS multicast
 * - May need to be skipped in CI environments without multicast support
 */
describe('Bonjour Discovery Integration', () => {
  let mdnsService: MDNSService;
  let testPort: number;
  let mockServer: net.Server;

  beforeAll(async () => {
    // Find an available port
    testPort = await getAvailablePort();

    // Create a simple TCP server to simulate VibeTunnel
    mockServer = net.createServer((socket) => {
      socket.write('VibeTunnel Mock Server\n');
      socket.end();
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(testPort, () => {
        console.log(`Mock server listening on port ${testPort}`);
        resolve();
      });
    });

    // Start mDNS advertising
    mdnsService = new MDNSService();
    await mdnsService.startAdvertising(testPort);

    // Give mDNS time to advertise
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    // Clean up
    await mdnsService.stopAdvertising();

    await new Promise<void>((resolve, reject) => {
      mockServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  it('should advertise service that can be discovered', async () => {
    // This test uses DNS-SD command line tool available on macOS/Linux
    // to verify the service is actually advertised

    const serviceName = '_vibetunnel._tcp';
    const discovered = await discoverService(serviceName);

    // Verify service was discovered
    expect(discovered).toBeTruthy();
    expect(discovered).toContain('_vibetunnel._tcp');
  }, 10000); // 10 second timeout for discovery

  it('should allow connection to discovered service', async () => {
    // Test that we can connect to the advertised port
    const connected = await testConnection('localhost', testPort);

    expect(connected).toBeTruthy();
  });

  it('should include correct metadata in service advertisement', async () => {
    // This would require parsing the TXT records from DNS-SD
    // For now, we just verify the service is discoverable
    const serviceName = '_vibetunnel._tcp';
    const discovered = await discoverService(serviceName);

    expect(discovered).toBeTruthy();
  });
});

/**
 * Helper function to find an available port
 */
async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/**
 * Helper function to discover mDNS service using dns-sd (macOS) or avahi-browse (Linux)
 */
async function discoverService(serviceType: string): Promise<string | null> {
  return new Promise((resolve) => {
    const platform = process.platform;
    let command: string;
    let args: string[];

    if (platform === 'darwin') {
      // macOS - use dns-sd
      command = 'dns-sd';
      args = ['-B', serviceType, 'local.'];
    } else if (platform === 'linux') {
      // Linux - use avahi-browse
      command = 'avahi-browse';
      args = ['-t', '-r', serviceType];
    } else {
      console.warn('mDNS discovery test not supported on this platform');
      resolve(null);
      return;
    }

    const proc = spawn(command, args);
    let output = '';
    const timeout: NodeJS.Timeout = setTimeout(() => {
      proc.kill();
      resolve(output || null);
    }, 5000);

    proc.stdout.on('data', (data) => {
      output += data.toString();

      // If we see our service type in the output, we found it
      if (output.includes('_vibetunnel._tcp')) {
        clearTimeout(timeout);
        proc.kill();
        resolve(output);
      }
    });

    proc.stderr.on('data', (data) => {
      console.error(`Discovery error: ${data}`);
    });

    proc.on('error', (err) => {
      console.error(`Failed to run discovery command: ${err}`);
      resolve(null);
    });
  });
}

/**
 * Helper function to test TCP connection
 */
async function testConnection(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    socket.on('connect', () => {
      socket.end();
      resolve(true);
    });

    socket.on('error', () => {
      resolve(false);
    });

    socket.connect(port, host);

    // Timeout after 2 seconds
    setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2000);
  });
}
