// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { restoreLocalStorage, setupLocalStorageMock } from '../../test/utils/component-helpers.js';
import {
  COMPACT_QUICK_KEYS_LAYOUT,
  loadQuickKeysLayout,
  QUICK_KEYS_STORAGE_KEY,
  saveQuickKeysLayout,
} from '../utils/quick-keys-layout.js';
import { QuickKeysEditor } from './quick-keys-editor.js';

interface QuickKeysEditorPrivate extends QuickKeysEditor {
  draftLayout: typeof COMPACT_QUICK_KEYS_LAYOUT;
  selectedKey: 'Escape' | 'Control' | 'Home';
  applyPreset(layout: typeof COMPACT_QUICK_KEYS_LAYOUT): void;
  hideSelected(): void;
  moveSelectedToRow(row: number): void;
  moveSelectedWithinRow(offset: -1 | 1): void;
  handleSave(): void;
}

describe('QuickKeysEditor', () => {
  let component: QuickKeysEditorPrivate;

  beforeEach(async () => {
    setupLocalStorageMock();
    component = new QuickKeysEditor() as QuickKeysEditorPrivate;
    component.visible = true;
    document.body.append(component);
    await component.updateComplete;
  });

  afterEach(() => {
    component.remove();
    restoreLocalStorage();
  });

  it('opens with the persisted layout and keeps Done outside customization', async () => {
    component.remove();
    saveQuickKeysLayout(COMPACT_QUICK_KEYS_LAYOUT);
    component = new QuickKeysEditor() as QuickKeysEditorPrivate;
    component.visible = true;
    document.body.append(component);
    await component.updateComplete;

    expect(component.draftLayout).toEqual(COMPACT_QUICK_KEYS_LAYOUT);
    expect(component.querySelectorAll('[data-key="Done"]')).toHaveLength(0);
    expect(component.textContent).toContain('Done remains fixed');
  });

  it('reorders, moves, and hides a selected key without emptying a row', () => {
    component.applyPreset(COMPACT_QUICK_KEYS_LAYOUT);
    component.selectedKey = 'Control';
    component.moveSelectedWithinRow(-1);
    expect(component.draftLayout[0].slice(0, 2)).toEqual(['Control', 'Escape']);

    component.moveSelectedToRow(1);
    expect(component.draftLayout[0]).not.toContain('Control');
    expect(component.draftLayout[1]).toContain('Control');

    component.hideSelected();
    expect(component.draftLayout.flat()).not.toContain('Control');

    component.selectedKey = 'Home';
    component.draftLayout = [['Escape'], ['Home']];
    component.hideSelected();
    expect(component.draftLayout).toEqual([['Escape'], ['Home']]);
  });

  it('adds a hidden key to a chosen row and persists only on Apply', () => {
    component.applyPreset(COMPACT_QUICK_KEYS_LAYOUT);
    component.selectedKey = 'Control';
    component.hideSelected();
    component.moveSelectedToRow(1);

    expect(localStorage.getItem(QUICK_KEYS_STORAGE_KEY)).toBeNull();
    component.handleSave();

    expect(loadQuickKeysLayout()[1]).toContain('Control');
  });
});
