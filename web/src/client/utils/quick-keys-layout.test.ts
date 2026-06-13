// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreLocalStorage, setupLocalStorageMock } from '../../test/utils/component-helpers.js';
import {
  COMPACT_QUICK_KEYS_LAYOUT,
  DEFAULT_QUICK_KEYS_LAYOUT,
  isValidQuickKeysLayout,
  loadQuickKeysLayout,
  QUICK_KEYS_LAYOUT_CHANGED_EVENT,
  QUICK_KEYS_STORAGE_KEY,
  resetQuickKeysLayout,
  saveQuickKeysLayout,
} from './quick-keys-layout.js';

describe('quick keys layout preferences', () => {
  beforeEach(() => {
    setupLocalStorageMock();
  });

  afterEach(() => {
    restoreLocalStorage();
  });

  it('uses the current fixed layout as the default', () => {
    expect(loadQuickKeysLayout()).toEqual(DEFAULT_QUICK_KEYS_LAYOUT);
  });

  it('round-trips a versioned browser-local layout', () => {
    expect(saveQuickKeysLayout(COMPACT_QUICK_KEYS_LAYOUT)).toBe(true);
    expect(loadQuickKeysLayout()).toEqual(COMPACT_QUICK_KEYS_LAYOUT);
    expect(JSON.parse(localStorage.getItem(QUICK_KEYS_STORAGE_KEY) ?? '')).toEqual({
      version: 1,
      rows: COMPACT_QUICK_KEYS_LAYOUT,
    });
  });

  it('rejects unknown, duplicate, empty, oversized, and unsupported row layouts', () => {
    expect(isValidQuickKeysLayout([['Escape'], ['not-a-key']])).toBe(false);
    expect(isValidQuickKeysLayout([['Escape'], ['Escape']])).toBe(false);
    expect(isValidQuickKeysLayout([['Escape'], []])).toBe(false);
    expect(
      isValidQuickKeysLayout([
        [
          'Escape',
          'Control',
          'CtrlExpand',
          'F',
          'Tab',
          'shift_tab',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'PageUp',
          'PageDown',
          'Home',
        ],
        ['Paste'],
      ])
    ).toBe(false);
    expect(isValidQuickKeysLayout([['Escape']])).toBe(false);
    expect(isValidQuickKeysLayout([['Escape'], ['Tab'], ['Home'], ['End']])).toBe(false);
  });

  it('falls back to defaults for malformed or future storage values', () => {
    localStorage.setItem(QUICK_KEYS_STORAGE_KEY, '{');
    expect(loadQuickKeysLayout()).toEqual(DEFAULT_QUICK_KEYS_LAYOUT);

    localStorage.setItem(
      QUICK_KEYS_STORAGE_KEY,
      JSON.stringify({ version: 2, rows: COMPACT_QUICK_KEYS_LAYOUT })
    );
    expect(loadQuickKeysLayout()).toEqual(DEFAULT_QUICK_KEYS_LAYOUT);
  });

  it('removes customization when reset and notifies live components', () => {
    const listener = vi.fn();
    window.addEventListener(QUICK_KEYS_LAYOUT_CHANGED_EVENT, listener);
    saveQuickKeysLayout(COMPACT_QUICK_KEYS_LAYOUT);

    expect(resetQuickKeysLayout()).toBe(true);
    expect(localStorage.getItem(QUICK_KEYS_STORAGE_KEY)).toBeNull();
    expect(loadQuickKeysLayout()).toEqual(DEFAULT_QUICK_KEYS_LAYOUT);
    expect(listener).toHaveBeenCalledTimes(2);

    window.removeEventListener(QUICK_KEYS_LAYOUT_CHANGED_EVENT, listener);
  });
});
