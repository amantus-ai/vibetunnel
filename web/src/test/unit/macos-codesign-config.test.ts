import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

function repoRoot(): string {
  return path.resolve(process.cwd(), '..');
}

describe('macOS codesign config', () => {
  it('embedded binary entitlements include JIT + disable library validation', () => {
    const entitlementsPath = path.join(
      repoRoot(),
      'mac',
      'ShellOps',
      'shellops-binary.entitlements'
    );

    expect(existsSync(entitlementsPath)).toBe(true);
    const entitlements = readFileSync(entitlementsPath, 'utf-8');

    expect(entitlements).toContain('com.apple.security.cs.allow-jit');
    expect(entitlements).toContain('com.apple.security.cs.disable-library-validation');
  });

  it('codesign script applies shellops-binary.entitlements to embedded binaries', () => {
    const scriptPath = path.join(repoRoot(), 'mac', 'scripts', 'codesign-app.sh');

    expect(existsSync(scriptPath)).toBe(true);
    const script = readFileSync(scriptPath, 'utf-8');

    expect(script).toContain('shellops-binary.entitlements');
    expect(script).toContain('/Contents/Resources/shellops"');
    expect(script).toContain('/Contents/Resources/shellops-fwd"');
    expect(script).toContain('--entitlements "$SHELLOPS_ENTITLEMENTS"');
  });
});
