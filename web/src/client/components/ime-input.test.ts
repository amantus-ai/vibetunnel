// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IME_VERTICAL_OFFSET_PX } from '../utils/terminal-constants.js';
import { DesktopIMEInput } from './ime-input.js';

describe('DesktopIMEInput', () => {
  let container: HTMLDivElement;
  let imeInput: DesktopIMEInput;
  let onTextInput: ReturnType<typeof vi.fn>;
  let onSpecialKey: ReturnType<typeof vi.fn>;

  const createCompositionEvent = (type: string, data = ''): CompositionEvent => {
    const event = new Event(type, { bubbles: true }) as CompositionEvent;
    Object.defineProperty(event, 'data', { value: data });
    return event;
  };

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'session-terminal';
    document.body.appendChild(container);

    onTextInput = vi.fn();
    onSpecialKey = vi.fn();
    imeInput = new DesktopIMEInput({
      container,
      onTextInput,
      onSpecialKey,
      getCursorInfo: () => ({ x: 48, y: 72 }),
      getFontSize: () => 16,
    });
  });

  afterEach(() => {
    imeInput.cleanup();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('anchors the native input at the terminal cursor when focused', () => {
    container.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input?.style.left).toBe('48px');
    expect(input?.style.top).toBe(`${72 - IME_VERTICAL_OFFSET_PX}px`);
    expect(input?.style.width).toBe('200px');
    expect(input?.style.opacity).toBe('1');
    expect(document.body.getAttribute('data-ime-input-focused')).toBe('true');
  });

  it('commits composed text exactly once', () => {
    const input = container.querySelector('input');
    expect(input).not.toBeNull();

    input?.dispatchEvent(createCompositionEvent('compositionstart'));
    if (input) input.value = 'ni hao';
    input?.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'ni hao' }));

    expect(onTextInput).not.toHaveBeenCalled();
    expect(document.body.getAttribute('data-ime-composing')).toBe('true');

    if (input) input.value = '你好';
    input?.dispatchEvent(createCompositionEvent('compositionend', '你好'));
    input?.dispatchEvent(new InputEvent('input', { bubbles: true, data: '你好' }));

    expect(onTextInput).toHaveBeenCalledOnce();
    expect(onTextInput).toHaveBeenCalledWith('你好');
    expect(input?.value).toBe('');
    expect(document.body.hasAttribute('data-ime-composing')).toBe(false);
  });

  it('preserves ordinary typing and terminal Enter handling', () => {
    const input = container.querySelector('input');
    expect(input).not.toBeNull();

    if (input) input.value = 'plain text';
    input?.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'plain text' }));

    expect(onTextInput).toHaveBeenCalledWith('plain text');
    expect(input?.value).toBe('');

    input?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));

    expect(onSpecialKey).toHaveBeenCalledOnce();
    expect(onSpecialKey).toHaveBeenCalledWith('enter');
  });

  it('removes the native input and composition markers during cleanup', () => {
    const input = container.querySelector('input');
    input?.dispatchEvent(new FocusEvent('focus'));
    input?.dispatchEvent(createCompositionEvent('compositionstart'));

    imeInput.cleanup();

    expect(container.querySelector('input')).toBeNull();
    expect(document.body.hasAttribute('data-ime-input-focused')).toBe(false);
    expect(document.body.hasAttribute('data-ime-composing')).toBe(false);
  });
});
