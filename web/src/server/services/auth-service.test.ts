import * as fs from 'fs';
import * as jwt from 'jsonwebtoken';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth-service.js';

// Mock modules
vi.mock('fs');
vi.mock('os');

// Mock logger to avoid path issues
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('AuthService JWT secret persistence', () => {
  const mockHomeDir = '/home/testuser';
  const secretPath = path.join(mockHomeDir, '.vibetunnel', 'jwt-secret');
  let savedJwtSecret: string | undefined;

  const createFsError = (code: string, message: string) => {
    const error = new Error(message) as NodeJS.ErrnoException;
    error.code = code;
    return error;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // The constructor schedules a cleanup interval; fake timers keep it from lingering.
    vi.useFakeTimers();

    savedJwtSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = undefined;
    delete process.env.JWT_SECRET;

    vi.mocked(os.homedir).mockReturnValue(mockHomeDir);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw createFsError('ENOENT', 'file not found');
    });
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.chmodSync).mockImplementation(() => undefined);
    vi.mocked(fs.linkSync).mockImplementation(() => undefined);
    vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (savedJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = savedJwtSecret;
    }
  });

  it('generates and persists a secret (0600) when none exists on disk', () => {
    new AuthService();

    expect(fs.mkdirSync).toHaveBeenCalledWith(path.join(mockHomeDir, '.vibetunnel'), {
      recursive: true,
    });
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [tempPath, writtenSecret, opts] = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(tempPath).toMatch(`${secretPath}.`);
    expect(typeof writtenSecret).toBe('string');
    expect((writtenSecret as string).length).toBeGreaterThan(0);
    expect(opts).toEqual({ flag: 'wx', mode: 0o600 });
    expect(fs.linkSync).toHaveBeenCalledWith(tempPath, secretPath);
    expect(fs.unlinkSync).toHaveBeenCalledWith(tempPath);
  });

  it('loads the existing secret without rewriting, so tokens survive a restart', () => {
    // First "boot": no file → generates + persists. Capture the generated secret.
    const instanceA = new AuthService();
    const persistedSecret = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    const token = instanceA.generateTokenForUser('alice');

    // Second "boot" (server restart): file now present with the same secret.
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue(mockHomeDir);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(persistedSecret);

    const instanceB = new AuthService();

    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.chmodSync).toHaveBeenCalledWith(secretPath, 0o600);
    // The token minted before the restart still verifies after it — the whole point.
    expect(instanceB.verifyToken(token)).toEqual({ valid: true, userId: 'alice' });
  });

  it('regenerates invalid persisted secrets instead of accepting weak signing keys', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('short');

    new AuthService();

    expect(fs.unlinkSync).toHaveBeenCalledWith(secretPath);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const writtenSecret = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(writtenSecret).toMatch(/^[0-9a-f]{128}$/);
  });

  it('uses JWT_SECRET env var and never touches disk when it is set', () => {
    process.env.JWT_SECRET = 'env-provided-secret';

    const service = new AuthService();

    expect(fs.existsSync).not.toHaveBeenCalled();
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    // Token signed with the env secret round-trips.
    const token = service.generateTokenForUser('bob');
    expect(service.verifyToken(token)).toEqual({ valid: true, userId: 'bob' });
  });

  it('falls back to an in-memory secret without throwing when disk access fails', () => {
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error('EROFS: read-only file system');
    });

    let service: AuthService | undefined;
    expect(() => {
      service = new AuthService();
    }).not.toThrow();

    // Auth still works in-process despite the persistence failure.
    const token = (service as AuthService).generateTokenForUser('carol');
    expect((service as AuthService).verifyToken(token)).toEqual({ valid: true, userId: 'carol' });
  });

  it('loads the winner when another process creates the secret concurrently', () => {
    const concurrentSecret = 'ab'.repeat(64);
    vi.mocked(fs.readFileSync)
      .mockImplementationOnce(() => {
        throw createFsError('ENOENT', 'file not found');
      })
      .mockReturnValue(concurrentSecret);
    vi.mocked(fs.linkSync).mockImplementationOnce(() => {
      throw createFsError('EEXIST', 'file already exists');
    });

    const service = new AuthService();
    const token = jwt.sign({ userId: 'race-winner' }, concurrentSecret);

    const tempPath = vi.mocked(fs.writeFileSync).mock.calls[0][0];
    expect(fs.writeFileSync).toHaveBeenCalledWith(tempPath, expect.any(String), {
      flag: 'wx',
      mode: 0o600,
    });
    expect(fs.linkSync).toHaveBeenCalledWith(tempPath, secretPath);
    expect(service.verifyToken(token)).toEqual({ valid: true, userId: 'race-winner' });
  });
});
