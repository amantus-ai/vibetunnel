// @vitest-environment happy-dom

import { fixture } from '@open-wc/testing';
import { html } from 'lit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Z_INDEX } from '../../utils/constants.js';
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

  it('should render above the exited-session badge using shared modal layers', async () => {
    await element.updateComplete;

    const backdrop = element.querySelector('[role="dialog"]') as HTMLElement | null;
    const modal = element.querySelector('.width-selector-container') as HTMLElement | null;

    expect(Z_INDEX.SESSION_EXITED_OVERLAY).toBeLessThan(Z_INDEX.MODAL_BACKDROP);
    expect(Z_INDEX.MODAL_BACKDROP).toBeLessThan(Z_INDEX.MODAL);
    expect(backdrop?.style.zIndex).toBe(String(Z_INDEX.MODAL_BACKDROP));
    expect(modal?.style.zIndex).toBe(String(Z_INDEX.MODAL));
  });
});
