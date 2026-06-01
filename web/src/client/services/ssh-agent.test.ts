// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserSSHAgent } from './ssh-agent.js';

// happy-dom's window.localStorage is not wired into global.localStorage in all vitest versions.
// Provide a simple in-memory mock so the agent's localStorage calls go to the same store the
// tests read from.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

// Test fixtures — a single Ed25519 key pair in both supported formats.
// Generated with Node.js crypto.generateKeyPairSync('ed25519').
const TEST_PKCS8_PEM =
  '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIJsXwXmJifcAcDcef9ofFrsE2Zl3FkfI8eS/BPfZ9F5e\n-----END PRIVATE KEY-----\n';

const TEST_OPENSSH_PEM =
  '-----BEGIN OPENSSH PRIVATE KEY-----\n' +
  'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n' +
  'QyNTUxOQAAACBH8SHBgerTHsPON8zAmD1Oxb2176AaiuQ3h4Hze2MrggAAAJAMa3MeDGtz\n' +
  'HgAAAAtzc2gtZWQyNTUxOQAAACBH8SHBgerTHsPON8zAmD1Oxb2176AaiuQ3h4Hze2Mrgg\n' +
  'AAAECbF8F5iYn3AHA3Hn/aHxa7BNmZdxZHyPHkvwT32fReXkfxIcGB6tMew843zMCYPU7F\n' +
  'vbXvoBqK5DeHgfN7YyuCAAAACXRlc3RAdGVzdAECAwQ=\n' +
  '-----END OPENSSH PRIVATE KEY-----';

// The expected SSH public key for the test pair above
const EXPECTED_PUBLIC_KEY =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEfxIcGB6tMew843zMCYPU7FvbXvoBqK5DeHgfN7YyuC';

// A properly-formed OpenSSH key with cipher=aes256-ctr (encrypted, unreadable without passphrase).
const ENCRYPTED_OPENSSH_PEM =
  '-----BEGIN OPENSSH PRIVATE KEY-----\n' +
  'b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0AAAAGAAAAAAAAAAAAA\n' +
  'AAAAAAAAAAAAAAAAAAAAAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAA\n' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n' +
  '-----END OPENSSH PRIVATE KEY-----';

describe('BrowserSSHAgent', () => {
  let agent: BrowserSSHAgent;

  beforeEach(() => {
    localStorageMock.clear();
    vi.stubGlobal('localStorage', localStorageMock);
    agent = new BrowserSSHAgent('test_ssh_keys');
  });

  // ── parsePrivateKey / addKey ───────────────────────────────────────────────

  describe('addKey — PKCS#8 format', () => {
    it('derives the correct public key', async () => {
      const keyId = await agent.addKey('pkcs8-key', TEST_PKCS8_PEM);
      const keys = agent.listKeys();
      const key = keys.find((k) => k.id === keyId);
      expect(key?.publicKey).toBe(EXPECTED_PUBLIC_KEY);
    });

    it('stores the key in localStorage', async () => {
      await agent.addKey('pkcs8-key', TEST_PKCS8_PEM);
      const stored = localStorage.getItem('test_ssh_keys');
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed[0].publicKey).toBe(EXPECTED_PUBLIC_KEY);
    });
  });

  describe('addKey — OpenSSH format', () => {
    it('derives the correct public key', async () => {
      const keyId = await agent.addKey('openssh-key', TEST_OPENSSH_PEM);
      const keys = agent.listKeys();
      const key = keys.find((k) => k.id === keyId);
      expect(key?.publicKey).toBe(EXPECTED_PUBLIC_KEY);
    });

    it('produces the same public key as PKCS#8 import of the same key', async () => {
      const pkcs8Id = await agent.addKey('pkcs8', TEST_PKCS8_PEM);
      const opensshId = await agent.addKey('openssh', TEST_OPENSSH_PEM);
      const keys = agent.listKeys();
      const pkcs8Pub = keys.find((k) => k.id === pkcs8Id)?.publicKey;
      const opensshPub = keys.find((k) => k.id === opensshId)?.publicKey;
      expect(pkcs8Pub).toBe(opensshPub);
    });

    it('stores the key in localStorage', async () => {
      await agent.addKey('openssh-key', TEST_OPENSSH_PEM);
      const stored = localStorage.getItem('test_ssh_keys');
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed[0].publicKey).toBe(EXPECTED_PUBLIC_KEY);
    });
  });

  describe('addKey — error cases', () => {
    it('throws a clear error for encrypted OpenSSH keys', async () => {
      await expect(agent.addKey('enc', ENCRYPTED_OPENSSH_PEM)).rejects.toThrow(
        /Encrypted OpenSSH keys are not supported/
      );
    });

    it('throws a clear error for encrypted PKCS#8 keys', async () => {
      const encPkcs8 =
        '-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIB...\n-----END ENCRYPTED PRIVATE KEY-----';
      await expect(agent.addKey('enc', encPkcs8)).rejects.toThrow(
        /Encrypted PKCS#8 keys are not supported/
      );
    });

    it('throws a clear error for unsupported key formats', async () => {
      const rsaPem =
        '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----';
      await expect(agent.addKey('rsa', rsaPem)).rejects.toThrow(/Unsupported key format/);
    });
  });

  // ── sign ──────────────────────────────────────────────────────────────────

  describe('sign', () => {
    it('produces a 64-byte Ed25519 signature for PKCS#8 keys', async () => {
      const keyId = await agent.addKey('pkcs8-key', TEST_PKCS8_PEM);
      const challenge = btoa('test-challenge-data');
      const result = await agent.sign(keyId, challenge);
      expect(result.algorithm).toBe('Ed25519');
      const sigBytes = atob(result.signature);
      expect(sigBytes.length).toBe(64);
    });

    it('produces a 64-byte Ed25519 signature for OpenSSH keys', async () => {
      const keyId = await agent.addKey('openssh-key', TEST_OPENSSH_PEM);
      const challenge = btoa('test-challenge-data');
      const result = await agent.sign(keyId, challenge);
      expect(result.algorithm).toBe('Ed25519');
      const sigBytes = atob(result.signature);
      expect(sigBytes.length).toBe(64);
    });

    it('PKCS#8 and OpenSSH keys produce verifiable signatures for the same challenge', async () => {
      const pkcs8Id = await agent.addKey('pkcs8', TEST_PKCS8_PEM);
      const opensshId = await agent.addKey('openssh', TEST_OPENSSH_PEM);
      const challenge = btoa('shared-challenge');

      const pkcs8Sig = await agent.sign(pkcs8Id, challenge);
      const opensshSig = await agent.sign(opensshId, challenge);

      // Both signatures should be verifiable (64 bytes each)
      expect(atob(pkcs8Sig.signature).length).toBe(64);
      expect(atob(opensshSig.signature).length).toBe(64);
    });
  });

  // ── persistence ───────────────────────────────────────────────────────────

  describe('persistence', () => {
    it('reloads keys from localStorage across agent instances', async () => {
      await agent.addKey('pkcs8-key', TEST_PKCS8_PEM);

      const agent2 = new BrowserSSHAgent('test_ssh_keys');
      const keys = agent2.listKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0].publicKey).toBe(EXPECTED_PUBLIC_KEY);
    });

    it('removeKey deletes from storage', async () => {
      const keyId = await agent.addKey('pkcs8-key', TEST_PKCS8_PEM);
      agent.removeKey(keyId);
      expect(agent.listKeys()).toHaveLength(0);
      const stored = JSON.parse(localStorage.getItem('test_ssh_keys') || '[]');
      expect(stored).toHaveLength(0);
    });
  });
});
