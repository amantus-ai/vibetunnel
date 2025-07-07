/**
 * Polyfill for crypto.randomUUID()
 *
 * Adds support for crypto.randomUUID() in browsers that don't have it.
 * This implementation follows the UUID v4 specification.
 */

export function installCryptoPolyfill(): void {
  // Check if we're in a browser environment
  if (typeof window === 'undefined' || typeof window.crypto === 'undefined') {
    return;
  }

  // Check if randomUUID is already available
  if (typeof window.crypto.randomUUID === 'function') {
    return;
  }

  // Add the polyfill
  window.crypto.randomUUID = (): `${string}-${string}-${string}-${string}-${string}` => {
    // Get cryptographically secure random values
    const getRandomValues = window.crypto.getRandomValues.bind(window.crypto);

    // Generate 16 random bytes
    const bytes = new Uint8Array(16);
    getRandomValues(bytes);

    // Set version (4) and variant bits according to UUID v4 spec
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10

    // Convert to hex string with proper formatting
    const hex: string[] = [];
    for (let i = 0; i < 16; i++) {
      const byte = bytes[i];
      hex.push((byte < 16 ? '0' : '') + byte.toString(16));
    }

    // Insert hyphens to form proper UUID
    return [
      hex
        .slice(0, 4)
        .join(''), // 8 chars
      hex
        .slice(4, 6)
        .join(''), // 4 chars
      hex
        .slice(6, 8)
        .join(''), // 4 chars
      hex
        .slice(8, 10)
        .join(''), // 4 chars
      hex
        .slice(10, 16)
        .join(''), // 12 chars
    ].join('-') as `${string}-${string}-${string}-${string}-${string}`;
  };

  console.log('[crypto-polyfill] Added crypto.randomUUID() polyfill');
}

// Auto-install the polyfill when this module is imported
installCryptoPolyfill();
