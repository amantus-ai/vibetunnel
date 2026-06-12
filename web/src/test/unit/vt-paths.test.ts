import { existsSync } from 'fs';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getVibetunnelBinaryPath } from '../helpers/vt-paths.js';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

describe('getVibetunnelBinaryPath', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReset();
  });

  it('uses the compiled native binary when available', () => {
    vi.mocked(existsSync).mockReturnValue(true);

    expect(getVibetunnelBinaryPath()).toBe(path.join(process.cwd(), 'native', 'vibetunnel'));
  });

  it('uses the test launcher when the native binary is absent', () => {
    vi.mocked(existsSync).mockReturnValueOnce(false).mockReturnValueOnce(true);

    expect(getVibetunnelBinaryPath()).toBe(path.join(process.cwd(), 'native', 'vibetunnel-test'));
  });

  it('falls back to the tracked launcher when no generated binary is available', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(getVibetunnelBinaryPath()).toBe(path.join(process.cwd(), 'bin', 'vibetunnel'));
  });
});
