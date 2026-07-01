import { describe, expect, it } from 'vitest';
import { resolveRemoteUrl } from './server.js';

describe('resolveRemoteUrl', () => {
  const host = () => 'My-Laptop'; // a mixed-case hostname the HQ may not resolve

  it('uses and normalizes an explicit --remote-url, ignoring bind/hostname', () => {
    expect(resolveRemoteUrl('http://100.64.0.5:4020', '0.0.0.0', 4020, host)).toBe(
      'http://100.64.0.5:4020'
    );
    expect(resolveRemoteUrl('http://HQ-KNOWS-ME:9999/', '10.0.0.2', 4020, host)).toBe(
      'http://hq-knows-me:9999'
    );
  });

  it('rejects advertised URLs that are unsafe or cannot be used as a base origin', () => {
    expect(() => resolveRemoteUrl('ssh://remote:4020', '0.0.0.0', 4020, host)).toThrow(
      'must use HTTP or HTTPS'
    );
    expect(() => resolveRemoteUrl('http://user:pass@remote:4020', '0.0.0.0', 4020, host)).toThrow(
      'must not include credentials'
    );
    expect(() => resolveRemoteUrl('http://remote:4020/base', '0.0.0.0', 4020, host)).toThrow(
      'must not include a path, query, or fragment'
    );
    expect(() => resolveRemoteUrl('', '0.0.0.0', 4020, host)).toThrow(
      'must be a valid HTTP or HTTPS URL'
    );
  });

  it('derives from the bind address when no --remote-url is given', () => {
    expect(resolveRemoteUrl(null, '10.0.0.2', 4020, host)).toBe('http://10.0.0.2:4020');
    expect(resolveRemoteUrl(undefined, '192.168.1.50', 4021, host)).toBe(
      'http://192.168.1.50:4021'
    );
  });

  it('falls back to the hostname when bound to 0.0.0.0', () => {
    // This is the problematic default the flag exists to override: the HQ may
    // not be able to resolve "My-Laptop".
    expect(resolveRemoteUrl(null, '0.0.0.0', 4020, host)).toBe('http://My-Laptop:4020');
    expect(resolveRemoteUrl(null, '::', 4020, host)).toBe('http://My-Laptop:4020');
  });

  it('brackets a concrete IPv6 bind address', () => {
    expect(resolveRemoteUrl(null, '2001:db8::5', 4020, host)).toBe('http://[2001:db8::5]:4020');
  });

  it('defaults the hostname resolver to os.hostname() (smoke)', () => {
    // Without an injected resolver it should still produce a well-formed URL.
    const url = resolveRemoteUrl(null, '0.0.0.0', 4020);
    expect(url).toMatch(/^http:\/\/.+:4020$/);
  });
});
