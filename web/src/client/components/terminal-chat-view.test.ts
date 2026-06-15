// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalChatView } from './terminal-chat-view.js';

describe('TerminalChatView', () => {
  let component: TerminalChatView;

  beforeEach(async () => {
    component = new TerminalChatView();
    document.body.append(component);
    await component.updateComplete;
  });

  afterEach(() => {
    component.remove();
  });

  it('enables native autocorrect for its delta-reconciling input', () => {
    const input = component.shadowRoot?.querySelector<HTMLInputElement>('#chat-input-field');

    expect(input?.getAttribute('autocorrect')).toBe('on');
    expect(input?.getAttribute('spellcheck')).toBe('false');
    expect(input?.getAttribute('autocapitalize')).toBe('off');
  });

  it('reconciles a corrected word with terminal backspaces', () => {
    const onSend = vi.fn();
    component.onSend = onSend;
    const input = component.shadowRoot?.querySelector<HTMLInputElement>('#chat-input-field');
    expect(input).not.toBeNull();

    if (!input) return;
    input.value = 'git chek';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.value = 'git check';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));

    expect(onSend).toHaveBeenNthCalledWith(1, 'git chek');
    expect(onSend).toHaveBeenNthCalledWith(2, '\x7fck');
  });
});
