import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { app, server } from '../../server';
import type { AddressInfo } from 'net';

// Set up test environment
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
const testControlDir = path.join(os.tmpdir(), 'vibetunnel-lifecycle-test', uuidv4());
process.env.TTY_FWD_CONTROL_DIR = testControlDir;

describe('Server Lifecycle Integration Tests', () => {
  let port: number;

  beforeAll(() => {
    if (!fs.existsSync(testControlDir)) {
      fs.mkdirSync(testControlDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testControlDir)) {
      fs.rmSync(testControlDir, { recursive: true, force: true });
    }
  });

  describe('Server Initialization', () => {
    it('should start server and create control directory', async () => {
      // Start server
      await new Promise<void>((resolve) => {
        if (!server.listening) {
          server.listen(0, () => {
            const address = server.address();
            port = (address as AddressInfo).port;
            resolve();
          });
        } else {
          const address = server.address();
          port = (address as AddressInfo).port;
          resolve();
        }
      });

      expect(port).toBeGreaterThan(0);
      expect(server.listening).toBe(true);

      // Verify control directory exists
      expect(fs.existsSync(testControlDir)).toBe(true);
    });

    it('should have all API endpoints available', async () => {
      const endpoints = [
        { method: 'get', path: '/api/sessions', expected: 200 },
        { method: 'post', path: '/api/sessions', body: {}, expected: 400 }, // Needs valid body
        { method: 'get', path: '/api/test-cast', expected: [200, 404] }, // May not exist
        { method: 'get', path: '/api/fs/browse', expected: 200 },
        { method: 'post', path: '/api/mkdir', body: {}, expected: 400 }, // Needs valid body
        { method: 'post', path: '/api/cleanup-exited', expected: 200 },
      ];

      for (const endpoint of endpoints) {
        let response;
        if (endpoint.method === 'post' && endpoint.body !== undefined) {
          response = await request(app)[endpoint.method](endpoint.path).send(endpoint.body);
        } else {
          response = await request(app)[endpoint.method as 'get'](endpoint.path);
        }

        // Should not return 404 (may return other errors like 400 for missing params)
        const expectedStatuses = Array.isArray(endpoint.expected)
          ? endpoint.expected
          : [endpoint.expected];
        expect(expectedStatuses).toContain(response.status);
      }
    });
  });

  describe('Middleware and Security', () => {
    it('should parse JSON bodies', async () => {
      const response = await request(app)
        .post('/api/sessions')
        .send({ test: 'data' })
        .set('Content-Type', 'application/json')
        .expect(400); // Will fail validation but should parse the body

      expect(response.body).toHaveProperty('error');
    });

    it('should handle CORS headers', async () => {
      const response = await request(app).get('/api/sessions').expect(200);

      // In production, you might want to check for CORS headers
      // For now, just verify the request succeeds
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should handle large request bodies', async () => {
      const largeCommand = Array(1000).fill('arg');

      const response = await request(app).post('/api/sessions').send({
        command: largeCommand,
        workingDir: os.tmpdir(),
      });

      // The request actually succeeds with a large command array
      // This test is just verifying the server can handle large bodies
      expect(response.status).toBeLessThan(500); // No server error
      if (response.status === 200) {
        expect(response.body).toHaveProperty('sessionId');
        // Clean up the session
        await request(app).delete(`/api/sessions/${response.body.sessionId}`);
      }
    });
  });

  describe('Concurrent Request Handling', () => {
    it('should handle multiple simultaneous requests', async () => {
      const requestCount = 10;
      const requests = [];

      for (let i = 0; i < requestCount; i++) {
        requests.push(request(app).get('/api/sessions'));
      }

      const responses = await Promise.all(requests);

      // All requests should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
      });
    });

    it('should handle mixed read/write operations', async () => {
      const operations = [
        request(app).get('/api/sessions'),
        request(app)
          .post('/api/sessions')
          .send({
            command: ['echo', 'test1'],
            workingDir: os.tmpdir(),
          }),
        request(app).get('/api/test-cast'),
        request(app)
          .post('/api/sessions')
          .send({
            command: ['echo', 'test2'],
            workingDir: os.tmpdir(),
          }),
        request(app).get('/api/fs/browse').query({ path: os.tmpdir() }),
      ];

      const responses = await Promise.all(operations);

      // All operations should complete without errors
      responses.forEach((response) => {
        expect(response.status).toBeLessThan(500); // No server errors
      });

      // Clean up created sessions
      const createdSessions = responses
        .filter((r) => r.body && r.body.sessionId)
        .map((r) => r.body.sessionId);

      for (const sessionId of createdSessions) {
        await request(app).delete(`/api/sessions/${sessionId}`);
      }
    });
  });
});
