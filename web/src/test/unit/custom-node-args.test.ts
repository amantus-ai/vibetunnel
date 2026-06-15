import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { getCustomNodeBuildArgs } = require('../../../scripts/custom-node-args.js');

describe('custom Node build arguments', () => {
  it('preserves explicit and automatic custom Node forms', () => {
    expect(getCustomNodeBuildArgs(['node', 'build.js'])).toBeNull();
    expect(getCustomNodeBuildArgs(['node', 'build.js', '--custom-node'])).toEqual([
      '--custom-node',
    ]);
    expect(getCustomNodeBuildArgs(['node', 'build.js', '--custom-node=/tmp/node'])).toEqual([
      '--custom-node=/tmp/node',
    ]);
    expect(getCustomNodeBuildArgs(['node', 'build.js', '--custom-node', '/tmp/node'])).toEqual([
      '--custom-node',
      '/tmp/node',
    ]);
  });
});
