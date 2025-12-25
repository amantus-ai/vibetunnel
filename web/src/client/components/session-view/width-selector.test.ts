// @vitest-environment happy-dom

import { fixture } from '@open-wc/testing';
import { html } from 'lit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import './width-selector.js';
import type { TerminalSettingsModal } from './width-selector.js';

describe('TerminalSettingsModal', () => {
  let element: TerminalSettingsModal;

  beforeEach(async () => {
    localStorage.clear();

    element = await fixture<TerminalSettingsModal>(html`
      <terminal-settings-modal
        .visible=${true}
        .terminalMaxCols=${80}
        .terminalFontSize=${14}
        .terminalTheme=${'auto'}
      ></terminal-settings-modal>
    `);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should render width, font size, and theme controls', async () => {
    await element.updateComplete;

    const widthSelect = document.querySelector('select') as HTMLSelectElement | null;
    expect(widthSelect).toBeTruthy();

    const themeSelect = document.querySelector('#theme-select') as HTMLSelectElement | null;
    expect(themeSelect).toBeTruthy();
  });

  it('should not render legacy binary mode toggle', async () => {
    await element.updateComplete;

    expect(document.querySelector('[role="switch"]')).toBeFalsy();
  });
});
