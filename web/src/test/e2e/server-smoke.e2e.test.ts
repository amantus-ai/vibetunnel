import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ServerInstance, startTestServer, stopServer } from '../utils/server-utils';

describe('Server Smoke Test', () => {
  let server: ServerInstance | null = null;

  beforeAll(async () => {
    // Start server with no authentication
    server = await startTestServer({
      args: ['--port', '0', '--no-auth'],
      env: {
        NODE_ENV: 'test',
      },
      waitForHealth: true,
    });
  });

  afterAll(async () => {
    if (server) {
      await stopServer(server.process);
    }
  });

  it('should perform basic operations', async () => {
    expect(server).toBeDefined();
    if (!server) return;

    const baseUrl = `http://localhost:${server.port}`;

    // 1. Health check
    console.log('1. Testing health check...');
    const healthResponse = await fetch(`${baseUrl}/api/health`);
    expect(healthResponse.ok).toBe(true);
    const health = await healthResponse.json();
    expect(health.status).toBe('ok');

    // 2. List sessions (should be empty)
    console.log('2. Listing sessions...');
    const listResponse = await fetch(`${baseUrl}/api/sessions`);
    if (!listResponse.ok) {
      console.error(`List sessions failed: ${listResponse.status} ${listResponse.statusText}`);
      const errorBody = await listResponse.text();
      console.error('Response body:', errorBody);
    }
    expect(listResponse.ok).toBe(true);
    const sessions = await listResponse.json();
    expect(sessions).toEqual([]);

    // 3. Create a session
    console.log('3. Creating session...');
    const createResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: ['sh', '-c', 'echo "hello world"; sleep 2'],
        name: 'test-session',
        cols: 80,
        rows: 24,
      }),
    });
    expect(createResponse.ok).toBe(true);
    const createResult = await createResponse.json();
    expect(createResult.sessionId).toBeDefined();
    const sessionId = createResult.sessionId;
    console.log(`Created session: ${sessionId}`);

    // 4. Send input
    console.log('4. Sending input...');
    const inputResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '\n' }),
    });
    expect(inputResponse.ok).toBe(true);

    // Wait a bit for the command to execute
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    // 5. Get buffer
    console.log('5. Getting buffer...');
    const bufferResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}/buffer`);
    expect(bufferResponse.ok).toBe(true);
    expect(bufferResponse.headers.get('content-type')).toBe('application/octet-stream');
    const buffer = await bufferResponse.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
    console.log(`Buffer size: ${buffer.byteLength} bytes`);

    // 6. List sessions again (should have one)
    console.log('6. Listing sessions again...');
    const listResponse2 = await fetch(`${baseUrl}/api/sessions`);
    expect(listResponse2.ok).toBe(true);
    const sessions2 = await listResponse2.json();
    expect(sessions2.length).toBe(1);
    expect(sessions2[0].id).toBe(sessionId);

    // 7. Kill session
    console.log('7. Killing session...');
    const killResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    expect(killResponse.ok).toBe(true);

    // Wait for session to be cleaned up
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    // 8. Verify session is gone
    console.log('8. Verifying session is gone...');
    const listResponse3 = await fetch(`${baseUrl}/api/sessions`);
    expect(listResponse3.ok).toBe(true);
    const sessions3 = await listResponse3.json();
    // Session might still exist but marked as exited
    const session = sessions3.find((s: { id: string }) => s.id === sessionId);
    if (session) {
      expect(session.status).toBe('exited');
    }

    console.log('All tests passed!');
  });
});
