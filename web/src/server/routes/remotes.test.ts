import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteRegistry } from '../services/remote-registry.js';
import { createRemoteRoutes } from './remotes.js';

describe('Remote Routes', () => {
  let app: Express;
  let remoteRegistry: RemoteRegistry;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    remoteRegistry = {
      getRemotes: vi.fn(() => [
        {
          id: 'remote-1',
          name: 'Studio Mac',
          url: 'https://studio.example.com',
          token: 'callback-secret',
          registeredAt: new Date('2026-07-01T08:00:00.000Z'),
          lastHeartbeat: new Date('2026-07-01T08:01:00.000Z'),
          sessionIds: new Set(['session-1']),
        },
      ]),
      register: vi.fn(() => ({
        created: true,
        remote: {
          id: 'remote-2',
          name: 'Laptop',
          url: 'https://laptop.example.com',
          token: 'new-callback-secret',
          registeredAt: new Date('2026-07-01T09:00:00.000Z'),
          lastHeartbeat: new Date('2026-07-01T09:00:00.000Z'),
          sessionIds: new Set<string>(),
        },
      })),
    } as unknown as RemoteRegistry;

    app.use('/api', createRemoteRoutes({ remoteRegistry, isHQMode: true }));
  });

  it('lists public remote metadata without callback bearer tokens', async () => {
    const response = await request(app).get('/api/remotes');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        id: 'remote-1',
        name: 'Studio Mac',
        url: 'https://studio.example.com',
        registeredAt: '2026-07-01T08:00:00.000Z',
        lastHeartbeat: '2026-07-01T08:01:00.000Z',
        sessionIds: ['session-1'],
      },
    ]);
    expect(response.text).not.toContain('callback-secret');
  });

  it('does not reflect callback bearer tokens after registration', async () => {
    const response = await request(app).post('/api/remotes/register').send({
      id: 'remote-2',
      name: 'Laptop',
      url: 'https://laptop.example.com',
      token: 'new-callback-secret',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      remote: {
        id: 'remote-2',
        name: 'Laptop',
        url: 'https://laptop.example.com',
        registeredAt: '2026-07-01T09:00:00.000Z',
        lastHeartbeat: '2026-07-01T09:00:00.000Z',
        sessionIds: [],
      },
    });
    expect(response.text).not.toContain('new-callback-secret');
  });
});
