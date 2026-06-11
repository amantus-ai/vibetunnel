/**
 * @vitest-environment happy-dom
 */
import { fixture, html } from '@open-wc/testing';
import { describe, expect, it, vi } from 'vitest';
import type { OverlaysCallbacks, OverlaysContainer } from './overlays-container.js';
import { UIStateManager } from './ui-state-manager.js';
import './overlays-container.js';

const createCallbacks = (): OverlaysCallbacks => ({
  onCtrlKey: vi.fn(),
  onSendCtrlSequence: vi.fn(),
  onClearCtrlSequence: vi.fn(),
  onCtrlAlphaCancel: vi.fn(),
  onQuickKeyPress: vi.fn(),
  onCloseFileBrowser: vi.fn(),
  onInsertPath: vi.fn(),
  onFileSelected: vi.fn(),
  onFileError: vi.fn(),
  onCloseFilePicker: vi.fn(),
  onWidthSelect: vi.fn(),
  onFontSizeChange: vi.fn(),
  onThemeChange: vi.fn(),
  onCloseWidthSelector: vi.fn(),
  onKeyboardButtonClick: vi.fn(),
  handleBack: vi.fn(),
});

describe('OverlaysContainer', () => {
  it('handles the keyboard pointer event without bubbling the follow-up click', async () => {
    const uiStateManager = new UIStateManager();
    uiStateManager.setIsMobile(true);
    const callbacks = createCallbacks();
    const element = await fixture<OverlaysContainer>(html`
      <overlays-container
        .uiState=${uiStateManager.getState()}
        .callbacks=${callbacks}
      ></overlays-container>
    `);
    const keyboardButton = element.querySelector<HTMLElement>('.mobile-keyboard-button');
    const bubbledClick = vi.fn();
    element.addEventListener('click', bubbledClick);

    expect(keyboardButton).toBeTruthy();

    const pointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });
    keyboardButton?.dispatchEvent(pointerDown);
    const click = new Event('click', { bubbles: true, cancelable: true });
    keyboardButton?.dispatchEvent(click);

    expect(callbacks.onKeyboardButtonClick).toHaveBeenCalledOnce();
    expect(pointerDown.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(bubbledClick).not.toHaveBeenCalled();
  });
});
