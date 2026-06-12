// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { isBrowserShortcut, isCopyPasteShortcut } from './browser-shortcuts.js';

const originalPlatform = navigator.platform;
const originalUserAgent = navigator.userAgent;
const originalMaxTouchPoints = navigator.maxTouchPoints;

afterEach(() => {
  Object.defineProperties(navigator, {
    platform: { value: originalPlatform, configurable: true },
    userAgent: { value: originalUserAgent, configurable: true },
    maxTouchPoints: { value: originalMaxTouchPoints, configurable: true },
  });
});

describe('browser shortcuts', () => {
  it('preserves iPhone Command shortcuts', () => {
    Object.defineProperties(navigator, {
      platform: { value: 'iPhone', configurable: true },
      userAgent: { value: 'Mobile Safari on iPhone', configurable: true },
    });

    expect(
      isBrowserShortcut({
        key: 'l',
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false,
      })
    ).toBe(true);
    expect(
      isCopyPasteShortcut({
        key: 'v',
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false,
      })
    ).toBe(true);
  });

  it('preserves iPadOS Command shortcuts with desktop platform reporting', () => {
    Object.defineProperties(navigator, {
      platform: { value: 'MacIntel', configurable: true },
      userAgent: { value: 'Mobile Safari', configurable: true },
      maxTouchPoints: { value: 5, configurable: true },
    });

    expect(
      isBrowserShortcut({
        key: 'c',
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false,
      })
    ).toBe(true);
  });
});
