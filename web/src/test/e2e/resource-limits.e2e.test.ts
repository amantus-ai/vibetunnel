import { type ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { SessionData } from '../types/test-types';
import { waitForServerPort } from '../utils/port-detection';
import { testLogger } from '../utils/test-logger';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(port: number, maxRetries = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/api/health`);
      if (response.ok) {
        return;
      }
    } catch (_e) {
      // Server not ready yet
    }
    await sleep(100);
  }
  throw new Error(`Server on port ${port} did not start within ${maxRetries * 100}ms`);
}

async function startServer(
  args: string[] = [],
  env: Record<string, string> = {}
): Promise<{ process: ChildProcess; port: number }> {
  const cliPath = path.join(process.cwd(), 'src', 'cli.ts');

  const serverProcess = spawn('pnpm', ['exec', 'tsx', cliPath, ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stderr?.on('data', (data) => {
    testLogger.error('Server stderr', data.toString());
  });

  const port = await waitForServerPort(serverProcess);
  return { process: serverProcess, port };
}

describe('Resource Limits and Concurrent Sessions', () => {
  let serverProcess: ChildProcess;
  let serverPort: number;
  let testDir: string;
  const username = 'testuser';
  const password = 'testpass';
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  beforeAll(async () => {
    // Create temporary directory for test
    testDir = path.join(os.tmpdir(), 'vibetunnel-limits-test', Date.now().toString());
    fs.mkdirSync(testDir, { recursive: true });

    // Start server with specific limits
    const result = await startServer(['--port', '0'], {
      VIBETUNNEL_CONTROL_DIR: testDir,
      VIBETUNNEL_USERNAME: username,
      VIBETUNNEL_PASSWORD: password,
      // Set reasonable limits for testing
      VIBETUNNEL_MAX_SESSIONS: '20',
      VIBETUNNEL_MAX_WEBSOCKETS: '50',
    });

    serverProcess = result.process;
    serverPort = result.port;

    await waitForServer(serverPort);
  });

  afterAll(async () => {
    // Kill server process
    if (serverProcess) {
      await new Promise<void>((resolve) => {
        serverProcess.on('close', () => resolve());

        // Try graceful shutdown first
        serverProcess.kill('SIGTERM');

        // Force kill after timeout
        setTimeout(() => {
          if (serverProcess.exitCode === null) {
            serverProcess.kill('SIGKILL');
          }
        }, 5000);
      });
    }

    // Clean up test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (_e) {
      testLogger.error('Test cleanup', 'Failed to clean test directory:', _e);
    }
  });

  describe('Concurrent Session Creation', () => {
    it('should handle multiple concurrent sessions', async () => {
      const sessionIds: string[] = [];
      const sessionCount = 10;

      // Create multiple sessions concurrently
      const createPromises = Array.from({ length: sessionCount }, (_, i) =>
        fetch(`http://localhost:${serverPort}/api/sessions`, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            command: ['bash', '-c', `echo "Session ${i}"; sleep 5`],
            workingDir: testDir,
            name: `Concurrent Test ${i}`,
          }),
        })
      );

      const responses = await Promise.all(createPromises);

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toHaveProperty('sessionId');
        sessionIds.push(result.sessionId);
      }

      // Verify all sessions are listed
      const listResponse = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        headers: { Authorization: authHeader },
      });
      const sessions = await listResponse.json();
      expect(sessions.length).toBeGreaterThanOrEqual(sessionCount);

      // Clean up sessions
      await Promise.all(
        sessionIds.map((id) =>
          fetch(`http://localhost:${serverPort}/api/sessions/${id}`, {
            method: 'DELETE',
            headers: { Authorization: authHeader },
          })
        )
      );
    });

    it('should enforce session limits', async () => {
      const sessionIds: string[] = [];
      const maxSessions = 20; // Based on VIBETUNNEL_MAX_SESSIONS

      try {
        // Create sessions up to the limit
        for (let i = 0; i < maxSessions; i++) {
          const response = await fetch(`http://localhost:${serverPort}/api/sessions`, {
            method: 'POST',
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              command: ['sleep', '30'],
              workingDir: testDir,
              name: `Limit Test ${i}`,
            }),
          });

          if (response.status === 200) {
            const result = await response.json();
            sessionIds.push(result.sessionId);
          } else {
            // Hit the limit
            expect(response.status).toBe(503); // Service Unavailable
            const error = await response.json();
            expect(error.error).toContain('limit');
            break;
          }
        }

        // Try to create one more session (should fail or hit limit)
        const extraResponse = await fetch(`http://localhost:${serverPort}/api/sessions`, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            command: ['echo', 'extra'],
            workingDir: testDir,
          }),
        });

        // Should either fail or we didn't hit the limit in the loop
        if (sessionIds.length >= maxSessions) {
          expect(extraResponse.status).toBe(503);
        }
      } finally {
        // Clean up all created sessions
        await Promise.all(
          sessionIds.map((id) =>
            fetch(`http://localhost:${serverPort}/api/sessions/${id}`, {
              method: 'DELETE',
              headers: { Authorization: authHeader },
            })
          )
        );

        // Wait for cleanup
        await sleep(1000);
      }
    });

    it('should handle rapid session creation and deletion', async () => {
      const iterations = 20;
      const results = { created: 0, deleted: 0, errors: 0 };

      for (let i = 0; i < iterations; i++) {
        try {
          // Create session
          const createResponse = await fetch(`http://localhost:${serverPort}/api/sessions`, {
            method: 'POST',
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              command: ['echo', `rapid test ${i}`],
              workingDir: testDir,
            }),
          });

          if (createResponse.status === 200) {
            results.created++;
            const { sessionId } = await createResponse.json();

            // Immediately delete it
            const deleteResponse = await fetch(
              `http://localhost:${serverPort}/api/sessions/${sessionId}`,
              {
                method: 'DELETE',
                headers: { Authorization: authHeader },
              }
            );

            if (deleteResponse.status === 200) {
              results.deleted++;
            }
          } else {
            results.errors++;
          }
        } catch (_e) {
          results.errors++;
        }

        // Small delay to avoid overwhelming
        await sleep(50);
      }

      // Should have successfully created and deleted most sessions
      expect(results.created).toBeGreaterThan(iterations * 0.8);
      expect(results.deleted).toBe(results.created);
      expect(results.errors).toBeLessThan(iterations * 0.2);

      // Server should still be healthy
      const healthResponse = await fetch(`http://localhost:${serverPort}/api/health`);
      expect(healthResponse.ok).toBe(true);
    });
  });

  describe('WebSocket Connection Limits', () => {
    it('should handle multiple WebSocket connections', async () => {
      const connections: WebSocket[] = [];
      const connectionCount = 20;

      try {
        // Create multiple WebSocket connections
        for (let i = 0; i < connectionCount; i++) {
          const ws = new WebSocket(`ws://localhost:${serverPort}/buffers`, {
            headers: { Authorization: authHeader },
          });

          await new Promise<void>((resolve, reject) => {
            ws.on('open', () => {
              connections.push(ws);
              resolve();
            });
            ws.on('error', reject);
          });
        }

        expect(connections.length).toBe(connectionCount);

        // All connections should be open
        for (const ws of connections) {
          expect(ws.readyState).toBe(WebSocket.OPEN);
        }
      } finally {
        // Clean up connections
        for (const ws of connections) {
          ws.close();
        }
      }
    });

    it('should enforce WebSocket connection limits', async () => {
      const connections: WebSocket[] = [];
      const maxWebSockets = 50; // Based on VIBETUNNEL_MAX_WEBSOCKETS

      try {
        // Try to create connections up to and beyond the limit
        for (let i = 0; i < maxWebSockets + 5; i++) {
          try {
            const ws = new WebSocket(`ws://localhost:${serverPort}/buffers`, {
              headers: { Authorization: authHeader },
            });

            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
              }, 1000);

              ws.on('open', () => {
                clearTimeout(timeout);
                connections.push(ws);
                resolve();
              });

              ws.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
              });

              ws.on('unexpected-response', (_req, res) => {
                clearTimeout(timeout);
                if (res.statusCode === 503) {
                  reject(new Error('Connection limit reached'));
                } else {
                  reject(new Error(`Unexpected status: ${res.statusCode}`));
                }
              });
            });
          } catch (_e) {
            // Expected when hitting the limit
            expect(connections.length).toBeLessThanOrEqual(maxWebSockets);
            break;
          }
        }

        // Should have hit the limit at some point
        expect(connections.length).toBeGreaterThan(0);
        expect(connections.length).toBeLessThanOrEqual(maxWebSockets);
      } finally {
        // Clean up all connections
        for (const ws of connections) {
          ws.close();
        }

        // Wait for connections to close
        await sleep(500);
      }
    });

    it('should handle WebSocket connection churn', async () => {
      const iterations = 50;
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < iterations; i++) {
        try {
          const ws = new WebSocket(`ws://localhost:${serverPort}/buffers`, {
            headers: { Authorization: authHeader },
          });

          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              ws.terminate();
              reject(new Error('Connection timeout'));
            }, 1000);

            ws.on('open', () => {
              clearTimeout(timeout);
              successCount++;
              // Close immediately
              ws.close();
              resolve();
            });

            ws.on('error', () => {
              clearTimeout(timeout);
              errorCount++;
              resolve(); // Continue the test
            });
          });
        } catch (_e) {
          errorCount++;
        }

        // Small delay between connections
        await sleep(20);
      }

      // Most connections should succeed
      expect(successCount).toBeGreaterThan(iterations * 0.8);
      expect(errorCount).toBeLessThan(iterations * 0.2);

      // Server should still be healthy
      const healthResponse = await fetch(`http://localhost:${serverPort}/api/health`);
      expect(healthResponse.ok).toBe(true);
    });
  });

  describe('Resource Exhaustion Protection', () => {
    it('should handle memory pressure from large outputs', async () => {
      // Create a session that generates large output
      const createResponse = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: [
            'bash',
            '-c',
            'for i in {1..1000}; do echo "Line $i: This is a test line with some content to fill up the buffer"; done',
          ],
          workingDir: testDir,
          name: 'Large Output Test',
        }),
      });

      expect(createResponse.status).toBe(200);
      const { sessionId } = await createResponse.json();

      // Wait for output to generate
      await sleep(2000);

      // Try to fetch the buffer (should handle large data)
      const bufferResponse = await fetch(
        `http://localhost:${serverPort}/api/sessions/${sessionId}/buffer`,
        {
          headers: { Authorization: authHeader },
        }
      );

      expect(bufferResponse.status).toBe(200);
      const buffer = await bufferResponse.arrayBuffer();
      expect(buffer.byteLength).toBeGreaterThan(0);

      // Clean up
      await fetch(`http://localhost:${serverPort}/api/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: authHeader },
      });
    });

    it('should handle rapid input flooding', async () => {
      // Create a session
      const createResponse = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['cat'], // Echoes input
          workingDir: testDir,
          name: 'Input Flood Test',
        }),
      });

      expect(createResponse.status).toBe(200);
      const { sessionId } = await createResponse.json();

      // Flood with input
      const inputPromises = Array.from({ length: 100 }, (_, i) =>
        fetch(`http://localhost:${serverPort}/api/sessions/${sessionId}/input`, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ data: `Input line ${i}\n` }),
        })
      );

      const results = await Promise.allSettled(inputPromises);
      const successful = results.filter((r) => r.status === 'fulfilled').length;

      // Most should succeed (some may be rate limited)
      expect(successful).toBeGreaterThan(50);

      // Server should still be responsive
      const healthResponse = await fetch(`http://localhost:${serverPort}/api/health`);
      expect(healthResponse.ok).toBe(true);

      // Clean up
      await fetch(`http://localhost:${serverPort}/api/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: authHeader },
      });
    });

    it('should handle multiple WebSocket subscriptions to same session', async () => {
      // Create a session
      const createResponse = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['bash', '-c', 'while true; do echo "test $RANDOM"; sleep 1; done'],
          workingDir: testDir,
          name: 'Multi-subscriber Test',
        }),
      });

      expect(createResponse.status).toBe(200);
      const { sessionId } = await createResponse.json();

      const subscribers: WebSocket[] = [];

      try {
        // Create multiple WebSocket connections subscribing to the same session
        for (let i = 0; i < 10; i++) {
          const ws = new WebSocket(`ws://localhost:${serverPort}/buffers`, {
            headers: { Authorization: authHeader },
          });

          await new Promise<void>((resolve) => {
            ws.on('open', () => {
              subscribers.push(ws);
              // Subscribe to the same session
              ws.send(
                JSON.stringify({
                  type: 'subscribe',
                  sessionId: sessionId,
                })
              );
              resolve();
            });
          });
        }

        // All should be connected
        expect(subscribers.length).toBe(10);

        // Wait and verify all receive data
        const messagePromises = subscribers.map(
          (ws) =>
            new Promise<boolean>((resolve) => {
              const timeout = setTimeout(() => resolve(false), 2000);
              ws.once('message', () => {
                clearTimeout(timeout);
                resolve(true);
              });
            })
        );

        const results = await Promise.all(messagePromises);
        const receivedCount = results.filter((r) => r).length;

        // All subscribers should receive messages
        expect(receivedCount).toBe(10);
      } finally {
        // Clean up
        for (const ws of subscribers) {
          ws.close();
        }

        await fetch(`http://localhost:${serverPort}/api/sessions/${sessionId}`, {
          method: 'DELETE',
          headers: { Authorization: authHeader },
        });
      }
    });

    it('should recover from session crashes', async () => {
      // Create a session that will crash
      const createResponse = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['bash', '-c', 'sleep 1 && exit 1'],
          workingDir: testDir,
          name: 'Crash Test',
        }),
      });

      expect(createResponse.status).toBe(200);
      const { sessionId } = await createResponse.json();

      // Wait for crash
      await sleep(2000);

      // Session should be gone or marked as exited
      const listResponse = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        headers: { Authorization: authHeader },
      });
      const sessions = await listResponse.json();
      const crashedSession = sessions.find((s: SessionData) => s.id === sessionId);

      if (crashedSession) {
        expect(crashedSession.status).not.toBe('running');
      }

      // Should be able to create new sessions
      const newResponse = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['echo', 'recovery test'],
          workingDir: testDir,
        }),
      });

      expect(newResponse.status).toBe(200);
    });

    it('should handle concurrent operations on same session', async () => {
      // Create a session
      const createResponse = await fetch(`http://localhost:${serverPort}/api/sessions`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: ['bash'],
          workingDir: testDir,
          name: 'Concurrent Ops Test',
        }),
      });

      expect(createResponse.status).toBe(200);
      const { sessionId } = await createResponse.json();

      try {
        // Perform multiple operations concurrently
        const operations = [
          // Multiple inputs
          ...Array.from({ length: 5 }, (_, i) =>
            fetch(`http://localhost:${serverPort}/api/sessions/${sessionId}/input`, {
              method: 'POST',
              headers: {
                Authorization: authHeader,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ data: `echo "concurrent ${i}"\n` }),
            })
          ),
          // Multiple resizes
          ...Array.from({ length: 5 }, (_, i) =>
            fetch(`http://localhost:${serverPort}/api/sessions/${sessionId}/resize`, {
              method: 'POST',
              headers: {
                Authorization: authHeader,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ cols: 80 + i, rows: 24 + i }),
            })
          ),
          // Multiple buffer reads
          ...Array.from({ length: 5 }, () =>
            fetch(`http://localhost:${serverPort}/api/sessions/${sessionId}/buffer`, {
              headers: { Authorization: authHeader },
            })
          ),
        ];

        const results = await Promise.allSettled(operations);
        const successful = results.filter(
          (r) => r.status === 'fulfilled' && r.value.status === 200
        ).length;

        // Most operations should succeed
        expect(successful).toBeGreaterThan(operations.length * 0.7);
      } finally {
        // Clean up
        await fetch(`http://localhost:${serverPort}/api/sessions/${sessionId}`, {
          method: 'DELETE',
          headers: { Authorization: authHeader },
        });
      }
    });
  });

  describe('Server Stability Under Load', () => {
    it('should remain stable under mixed load', async () => {
      const duration = 5000; // 5 seconds
      const startTime = Date.now();
      const metrics = {
        sessionsCreated: 0,
        sessionsDeleted: 0,
        wsConnections: 0,
        errors: 0,
      };

      const operations: Promise<void>[] = [];

      // Session creation/deletion loop
      operations.push(
        (async () => {
          while (Date.now() - startTime < duration) {
            try {
              const response = await fetch(`http://localhost:${serverPort}/api/sessions`, {
                method: 'POST',
                headers: {
                  Authorization: authHeader,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  command: ['echo', 'load test'],
                  workingDir: testDir,
                }),
              });

              if (response.status === 200) {
                metrics.sessionsCreated++;
                const { sessionId } = await response.json();

                // Delete after short delay
                setTimeout(async () => {
                  try {
                    await fetch(`http://localhost:${serverPort}/api/sessions/${sessionId}`, {
                      method: 'DELETE',
                      headers: { Authorization: authHeader },
                    });
                    metrics.sessionsDeleted++;
                  } catch (_e) {
                    metrics.errors++;
                  }
                }, 1000);
              }
            } catch (_e) {
              metrics.errors++;
            }
            await sleep(100);
          }
        })()
      );

      // WebSocket connection loop
      operations.push(
        (async () => {
          while (Date.now() - startTime < duration) {
            try {
              const ws = new WebSocket(`ws://localhost:${serverPort}/buffers`, {
                headers: { Authorization: authHeader },
              });

              await new Promise<void>((resolve) => {
                ws.on('open', () => {
                  metrics.wsConnections++;
                  setTimeout(() => {
                    ws.close();
                    resolve();
                  }, 500);
                });
                ws.on('error', resolve);
              });
            } catch (_e) {
              metrics.errors++;
            }
            await sleep(150);
          }
        })()
      );

      // Health check loop
      operations.push(
        (async () => {
          let healthChecksFailed = 0;
          while (Date.now() - startTime < duration) {
            try {
              const response = await fetch(`http://localhost:${serverPort}/api/health`);
              if (!response.ok) {
                healthChecksFailed++;
              }
            } catch (_e) {
              healthChecksFailed++;
            }
            await sleep(500);
          }
          expect(healthChecksFailed).toBe(0);
        })()
      );

      await Promise.all(operations);

      // Verify metrics
      expect(metrics.sessionsCreated).toBeGreaterThan(10);
      expect(metrics.wsConnections).toBeGreaterThan(10);
      expect(metrics.errors).toBeLessThan((metrics.sessionsCreated + metrics.wsConnections) * 0.1);

      // Final health check
      const finalHealth = await fetch(`http://localhost:${serverPort}/api/health`);
      expect(finalHealth.ok).toBe(true);
    });
  });
});
