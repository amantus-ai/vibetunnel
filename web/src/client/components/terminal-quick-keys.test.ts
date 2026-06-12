// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalQuickKeys } from './terminal-quick-keys.js';

// Define interface for private methods we need to test
interface TerminalQuickKeysPrivate extends TerminalQuickKeys {
  getButtonSizeClass(label: string): string;
  handleKeyPress(
    key: string,
    isModifier?: boolean,
    isSpecial?: boolean,
    isToggle?: boolean,
    event?: Event
  ): void;
  activeModifiers: Set<string>;
  isLandscape: boolean;
}

describe('TerminalQuickKeys', () => {
  let component: TerminalQuickKeysPrivate;
  let mockOnKeyPress: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    component = new TerminalQuickKeys() as TerminalQuickKeysPrivate;
    mockOnKeyPress = vi.fn();
    component.onKeyPress = mockOnKeyPress;
    component.visible = true;
  });

  describe('Option key chord system', () => {
    it('should toggle Option modifier state when pressed', () => {
      // Press Option key
      component.handleKeyPress('Option', true, false, false);

      // Option should be in active modifiers
      expect(component.activeModifiers.has('Option')).toBe(true);

      // Should not send Option key immediately
      expect(mockOnKeyPress).not.toHaveBeenCalled();
    });

    it('should clear Option modifier when pressed twice', () => {
      // Press Option key twice
      component.handleKeyPress('Option', true, false, false);
      component.handleKeyPress('Option', true, false, false);

      // Option should not be in active modifiers
      expect(component.activeModifiers.has('Option')).toBe(false);

      // Should not send any keys
      expect(mockOnKeyPress).not.toHaveBeenCalled();
    });

    it('should send Option+Arrow combination when arrow pressed after Option', () => {
      // Press Option first
      component.handleKeyPress('Option', true, false, false);

      // Then press ArrowLeft
      component.handleKeyPress('ArrowLeft', false, false, false);

      // Should have sent Option (ESC) first, then ArrowLeft
      expect(mockOnKeyPress).toHaveBeenCalledTimes(2);
      expect(mockOnKeyPress).toHaveBeenNthCalledWith(1, 'Option', true, false);
      expect(mockOnKeyPress).toHaveBeenNthCalledWith(2, 'ArrowLeft', false, false);

      // Option modifier should be cleared
      expect(component.activeModifiers.has('Option')).toBe(false);
    });

    it('should work with all arrow keys', () => {
      const arrowKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

      arrowKeys.forEach((arrow) => {
        mockOnKeyPress.mockClear();

        // Press Option first
        component.handleKeyPress('Option', true, false, false);

        // Then press arrow key
        component.handleKeyPress(arrow, false, false, false);

        // Should have sent Option+Arrow combination
        expect(mockOnKeyPress).toHaveBeenCalledTimes(2);
        expect(mockOnKeyPress).toHaveBeenNthCalledWith(1, 'Option', true, false);
        expect(mockOnKeyPress).toHaveBeenNthCalledWith(2, arrow, false, false);
      });
    });

    it('should clear Option modifier when non-arrow key is pressed', () => {
      // Press Option first
      component.handleKeyPress('Option', true, false, false);

      // Then press a non-arrow key
      component.handleKeyPress('a', false, false, false);

      // Should have cleared Option modifier
      expect(component.activeModifiers.has('Option')).toBe(false);

      // Should have sent only the 'a' key
      expect(mockOnKeyPress).toHaveBeenCalledOnce();
      expect(mockOnKeyPress).toHaveBeenCalledWith('a', false, false, false);
    });

    it('should handle multiple Option+Arrow sequences', () => {
      // First sequence: Option+ArrowLeft
      component.handleKeyPress('Option', true, false, false);
      component.handleKeyPress('ArrowLeft', false, false, false);

      expect(mockOnKeyPress).toHaveBeenCalledTimes(2);

      mockOnKeyPress.mockClear();

      // Second sequence: Option+ArrowRight
      component.handleKeyPress('Option', true, false, false);
      component.handleKeyPress('ArrowRight', false, false, false);

      expect(mockOnKeyPress).toHaveBeenCalledTimes(2);
      expect(mockOnKeyPress).toHaveBeenNthCalledWith(1, 'Option', true, false);
      expect(mockOnKeyPress).toHaveBeenNthCalledWith(2, 'ArrowRight', false, false);
    });
  });

  describe('Visual state updates', () => {
    it('should request update when Option modifier changes', () => {
      const requestUpdateSpy = vi.spyOn(component, 'requestUpdate');

      // Press Option
      component.handleKeyPress('Option', true, false, false);
      expect(requestUpdateSpy).toHaveBeenCalled();

      requestUpdateSpy.mockClear();

      // Press Option again to toggle off
      component.handleKeyPress('Option', true, false, false);
      expect(requestUpdateSpy).toHaveBeenCalled();
    });

    it('should request update when chord is completed', () => {
      const requestUpdateSpy = vi.spyOn(component, 'requestUpdate');

      // Press Option
      component.handleKeyPress('Option', true, false, false);
      requestUpdateSpy.mockClear();

      // Press ArrowLeft
      component.handleKeyPress('ArrowLeft', false, false, false);
      expect(requestUpdateSpy).toHaveBeenCalled();
    });

    it('notifies the parent when expanded quick-key rows change', async () => {
      const layoutChangeSpy = vi.fn();
      component.addEventListener('quick-keys-layout-change', layoutChangeSpy);
      document.body.append(component);
      await component.updateComplete;
      layoutChangeSpy.mockClear();

      component.handleKeyPress('CtrlExpand', false, false, true);
      await component.updateComplete;

      expect(layoutChangeSpy).toHaveBeenCalledOnce();
      component.remove();
    });
  });

  describe('Touch target sizing', () => {
    it('uses larger padding in portrait orientation', () => {
      component.isLandscape = false;

      expect(component.getButtonSizeClass('Esc')).toBe('px-1.5 py-2.5');
    });

    it('keeps compact padding in landscape orientation', () => {
      component.isLandscape = true;

      expect(component.getButtonSizeClass('Esc')).toBe('px-1 py-2');
    });

    it('applies the orientation padding to arrow keys', async () => {
      document.body.append(component);
      component.isLandscape = false;
      component.requestUpdate();
      await component.updateComplete;

      const arrowKey = component.querySelector<HTMLButtonElement>('[data-key="ArrowUp"]');

      expect(arrowKey?.classList.contains('px-1.5')).toBe(true);
      expect(arrowKey?.classList.contains('py-2.5')).toBe(true);
      component.remove();
    });
  });
});
