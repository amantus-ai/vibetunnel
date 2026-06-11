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
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
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

const decodeOpenSSHKey = (pem: string): Uint8Array =>
  Uint8Array.from(
    atob(
      pem
        .replace('-----BEGIN OPENSSH PRIVATE KEY-----', '')
        .replace('-----END OPENSSH PRIVATE KEY-----', '')
        .replace(/\s/g, '')
    ),
    (character) => character.charCodeAt(0)
  );

const encodeOpenSSHKey = (bytes: Uint8Array): string => {
  const encoded = btoa(String.fromCharCode(...bytes));
  const lines = encoded.match(/.{1,70}/g) ?? [];
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join('\n')}\n-----END OPENSSH PRIVATE KEY-----`;
};

const readString = (
  bytes: Uint8Array,
  offset: number
): { dataOffset: number; length: number; next: number } => {
  const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
  return { dataOffset: offset + 4, length, next: offset + 4 + length };
};

const findOpenSSHOffsets = (bytes: Uint8Array) => {
  let offset = 15;
  offset = readString(bytes, offset).next;
  offset = readString(bytes, offset).next;
  offset = readString(bytes, offset).next;
  const keyCountOffset = offset;
  offset += 4;
  offset = readString(bytes, offset).next;
  const privateSectionLengthOffset = offset;
  const privateSection = readString(bytes, offset);
  const privateSectionOffset = privateSection.dataOffset;

  let privateOffset = privateSectionOffset + 8;
  privateOffset = readString(bytes, privateOffset).next;
  const publicKey = readString(bytes, privateOffset);
  const privateKey = readString(bytes, publicKey.next);
  const commentLengthOffset = privateKey.next;

  return {
    keyCountOffset,
    privateSectionLengthOffset,
    privateSectionOffset,
    publicKeyOffset: publicKey.dataOffset,
    privateKeyOffset: privateKey.dataOffset,
    commentLengthOffset,
  };
};

const mutateOpenSSHKey = (mutate: (bytes: Uint8Array) => void): string => {
  const bytes = decodeOpenSSHKey(TEST_OPENSSH_PEM);
  mutate(bytes);
  return encodeOpenSSHKey(bytes);
};

const setOpenSSHCommentWithoutPadding = (comment: string): string => {
  const bytes = decodeOpenSSHKey(TEST_OPENSSH_PEM);
  const { privateSectionLengthOffset, privateSectionOffset, commentLengthOffset } =
    findOpenSSHOffsets(bytes);
  const commentBytes = new TextEncoder().encode(comment);
  const privateSectionLength = commentLengthOffset - privateSectionOffset + 4 + commentBytes.length;
  if (privateSectionLength % 8 !== 0) {
    throw new Error('Test comment must produce an aligned private section');
  }

  const result = new Uint8Array(commentLengthOffset + 4 + commentBytes.length);
  result.set(bytes.slice(0, commentLengthOffset));
  const view = new DataView(result.buffer);
  view.setUint32(privateSectionLengthOffset, privateSectionLength, false);
  view.setUint32(commentLengthOffset, commentBytes.length, false);
  result.set(commentBytes, commentLengthOffset + 4);
  return encodeOpenSSHKey(result);
};

const decodeSSHPublicKey = (publicKey: string): Uint8Array => {
  const [, encoded] = publicKey.split(' ');
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const keyType = readString(bytes, 0);
  return bytes.slice(keyType.next + 4);
};

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
      const parsed = JSON.parse(stored ?? '[]');
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
      const parsed = JSON.parse(stored ?? '[]');
      expect(parsed[0].publicKey).toBe(EXPECTED_PUBLIC_KEY);
    });

    it('accepts a block-aligned private section with no padding', async () => {
      const keyId = await agent.addKey('openssh-key', setOpenSSHCommentWithoutPadding('align'));
      const key = agent.listKeys().find((candidate) => candidate.id === keyId);

      expect(key?.publicKey).toBe(EXPECTED_PUBLIC_KEY);
    });

    it('rejects mismatched check integers', async () => {
      const pem = mutateOpenSSHKey((bytes) => {
        const { privateSectionOffset } = findOpenSSHOffsets(bytes);
        bytes[privateSectionOffset + 4] ^= 0xff;
      });

      await expect(agent.addKey('invalid', pem)).rejects.toThrow(/check integers/);
    });

    it('rejects keys whose public key does not match the private seed', async () => {
      const pem = mutateOpenSSHKey((bytes) => {
        const { privateKeyOffset } = findOpenSSHOffsets(bytes);
        bytes[privateKeyOffset] ^= 0xff;
      });

      await expect(agent.addKey('invalid', pem)).rejects.toThrow(/seed does not match/);
    });

    it('rejects unsupported key counts', async () => {
      const pem = mutateOpenSSHKey((bytes) => {
        const { keyCountOffset } = findOpenSSHOffsets(bytes);
        new DataView(bytes.buffer, bytes.byteOffset + keyCountOffset, 4).setUint32(0, 2, false);
      });

      await expect(agent.addKey('invalid', pem)).rejects.toThrow(/key count: 2/);
    });

    it('rejects truncated key data with a clear error', async () => {
      const bytes = decodeOpenSSHKey(TEST_OPENSSH_PEM);
      const pem = encodeOpenSSHKey(bytes.slice(0, 24));

      await expect(agent.addKey('invalid', pem)).rejects.toThrow(/truncated/);
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
      const rsaPem = '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----';
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
      const publicKey = await crypto.subtle.importKey(
        'raw',
        decodeSSHPublicKey(EXPECTED_PUBLIC_KEY),
        { name: 'Ed25519' },
        false,
        ['verify']
      );
      const challengeBytes = new TextEncoder().encode('shared-challenge');

      const pkcs8Sig = await agent.sign(pkcs8Id, challenge);
      const opensshSig = await agent.sign(opensshId, challenge);

      const pkcs8Signature = Uint8Array.from(atob(pkcs8Sig.signature), (c) => c.charCodeAt(0));
      const opensshSignature = Uint8Array.from(atob(opensshSig.signature), (c) => c.charCodeAt(0));
      await expect(
        crypto.subtle.verify('Ed25519', publicKey, pkcs8Signature, challengeBytes)
      ).resolves.toBe(true);
      await expect(
        crypto.subtle.verify('Ed25519', publicKey, opensshSignature, challengeBytes)
      ).resolves.toBe(true);
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
