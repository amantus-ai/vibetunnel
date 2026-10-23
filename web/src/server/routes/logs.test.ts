import * as fs from 'node:fs';
import * as path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthMiddleware } from '../middleware/auth.js';
import {
  closeLogger,
  flushLogger,
  setLogFilePath,
  setVerbosityLevel,
  VerbosityLevel,
} from '../utils/logger.js';
import { createLogRoutes } from './logs.js';

const fixture = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { home: mkdtempSync(join(tmpdir(), 'vibetunnel-log-auth-')) };
});

// Keep the real middleware, router and filesystem, but never use the user's logs.
vi.mock('os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => fixture.home,
}));

describe('Log route authentication', () => {
  const token = 'synthetic-log-route-token';
  const sentinel = 'synthetic private server log\n';
  const logPath = path.join(fixture.home, '.vibetunnel', 'log.txt');
  let app: express.Express;

  function createApp(noAuth = false) {
    const server = express();
    server.use(express.json());
    // Match the /api middleware and router mount order in server.ts.
    server.use(
      '/api',
      createAuthMiddleware({
        enableSSHKeys: false,
        disallowUserPassword: false,
        noAuth,
        isHQMode: false,
        bearerToken: token,
        allowLocalBypass: false,
        allowTailscaleAuth: false,
      })
    );
    server.use('/api', createLogRoutes());
    return server;
  }

  beforeEach(async () => {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    // Auth denial may legitimately log an error. Keep that output separate so
    // the protected file's contents independently witness reads/clears.
    setLogFilePath(path.join(fixture.home, 'auth-diagnostics.txt'));
    setVerbosityLevel(VerbosityLevel.SILENT);
    await flushLogger();
    fs.writeFileSync(logPath, sentinel);
    app = createApp();
  });

  afterEach(async () => {
    closeLogger();
    await flushLogger();
    setVerbosityLevel(VerbosityLevel.ERROR);
  });

  afterAll(() => fs.rmSync(fixture.home, { recursive: true, force: true }));

  const protectedRoutes = [
    ['get', '/api/logs/raw'],
    ['head', '/api/logs/raw'],
    ['get', '/api/logs/info'],
    ['delete', '/api/logs/clear'],
    ['post', '/api/logs/flush'],
  ] as const;

  describe.each(['missing', 'invalid'])('%s credentials', (credentials) => {
    it.each(protectedRoutes)('denies %s %s without log access', async (method, url) => {
      const operation = request(app)[method](url);
      if (credentials === 'invalid') operation.set('Authorization', 'Bearer invalid-fixture-token');
      const response = await operation;

      expect.soft(response.status).toBe(401);
      expect(response.text ?? '').not.toContain(sentinel.trim());
      expect(response.text ?? '').not.toContain(logPath);
      expect(fs.readFileSync(logPath, 'utf8')).toBe(sentinel);
    });
  });

  it('allows authenticated log reads and metadata', async () => {
    const raw = await request(app).get('/api/logs/raw').auth(token, { type: 'bearer' });
    expect(raw.status).toBe(200);
    expect(raw.text).toBe(sentinel);

    const info = await request(app).get('/api/logs/info').auth(token, { type: 'bearer' });
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({
      exists: true,
      size: Buffer.byteLength(sentinel),
      path: logPath,
    });
  });

  it('allows an authenticated clear and flush', async () => {
    const clear = await request(app).delete('/api/logs/clear').auth(token, { type: 'bearer' });
    expect(clear.status).toBe(204);
    expect(fs.readFileSync(logPath, 'utf8')).toBe('');

    const flush = await request(app).post('/api/logs/flush').auth(token, { type: 'bearer' });
    expect(flush.status).toBe(204);
  });

  it('accepts client logging before login', async () => {
    setLogFilePath(logPath);
    const response = await request(app)
      .post('/api/logs/client')
      .send({ level: 'log', module: 'auth-fixture', args: ['synthetic client message'] });
    expect(response.status).toBe(204);
    await flushLogger();
    expect(fs.readFileSync(logPath, 'utf8')).toContain('synthetic client message');
  });

  it.each([
    ['get', '/api/logs/client'],
    ['post', '/api/logs/client-extra'],
    ['post', '/api/logs/client/'],
    ['post', '/api/logs'],
  ] as const)('does not exempt %s %s', async (method, url) => {
    const response = await request(app)[method](url);
    expect.soft(response.status).toBe(401);
    expect(fs.readFileSync(logPath, 'utf8')).toBe(sentinel);
  });

  it('preserves explicitly configured no-auth mode', async () => {
    const response = await request(createApp(true)).get('/api/logs/raw');
    expect(response.status).toBe(200);
    expect(response.text).toBe(sentinel);
  });
});
