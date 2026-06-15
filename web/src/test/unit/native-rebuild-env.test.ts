import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createNativeRebuildEnv } = require('../../../scripts/native-rebuild-env.js');

describe('native rebuild environment', () => {
  it('keeps exact Node tools available without inheriting library search paths', () => {
    const env = createNativeRebuildEnv(
      {
        PATH: '/opt/homebrew/bin:/usr/bin',
        VIBETUNNEL_NODE_SHIM_DIR: '/tmp/node-shims',
        LDFLAGS: '-L/opt/homebrew/lib',
        CPATH: '/opt/homebrew/include',
        PKG_CONFIG_PATH: '/opt/homebrew/lib/pkgconfig',
      },
      '/tmp/node/bin/node',
      'v24.16.0',
      'arm64'
    );

    expect(env.PATH.split(path.delimiter)).toEqual([
      '/tmp/node-shims',
      '/tmp/node/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ]);
    expect(env.npm_config_target).toBe('24.16.0');
    expect(env.npm_config_arch).toBe('arm64');
    expect(env.npm_config_target_arch).toBe('arm64');
    expect(env.LDFLAGS).toBeUndefined();
    expect(env.CPATH).toBeUndefined();
    expect(env.PKG_CONFIG_PATH).toBeUndefined();
  });
});
