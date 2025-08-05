// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateCursorPosition, clearCharacterWidthCache } from './cursor-position.js';
import { TERMINAL_IDS } from './terminal-constants.js';

describe('cursor-position', () => {
  let mockContainer: HTMLElement;
  let mockSessionTerminal: HTMLElement;

  beforeEach(() => {
    // Clear the cache before each test
    clearCharacterWidthCache();

    // Reset any existing mocks
    vi.clearAllMocks();

    // Create mock DOM elements
    mockContainer = {
      style: {},
      appendChild: vi.fn(),
      removeChild: vi.fn(),
      getBoundingClientRect: vi.fn().mockReturnValue({
        left: 100,
        top: 50,
        width: 800,
        height: 600,
        right: 900,
        bottom: 650,
        x: 100,
        y: 50,
        toJSON: () => ({}),
      }),
    } as any;

    mockSessionTerminal = {
      id: TERMINAL_IDS.SESSION_TERMINAL,
      style: {},
      remove: vi.fn(),
      getBoundingClientRect: vi.fn().mockReturnValue({
        left: 20,
        top: 10,
        width: 1000,
        height: 700,
        right: 1020,
        bottom: 710,
        x: 20,
        y: 10,
        toJSON: () => ({}),
      }),
    } as any;

    // Mock getElementById to return our mock session terminal
    vi.spyOn(document, 'getElementById').mockImplementation((id) => {
      if (id === TERMINAL_IDS.SESSION_TERMINAL) {
        return mockSessionTerminal;
      }
      return null;
    });
  });

  describe('calculateCursorPosition', () => {
    it('should calculate correct position for given cursor coordinates', () => {
      const fontSize = 14;
      const cursorX = 5; // 5 characters from left
      const cursorY = 3; // 3 lines from top

      // Mock getBoundingClientRect for the test element to provide consistent char width
      const mockTestElement = {
        getBoundingClientRect: vi.fn().mockReturnValue({ width: 8.4 }), // Mock char width
        style: {},
        textContent: '',
      };
      vi.spyOn(document, 'createElement').mockReturnValue(mockTestElement as any);

      const result = calculateCursorPosition(cursorX, cursorY, fontSize, mockContainer, 'running');

      expect(result).not.toBeNull();
      expect(result?.x).toBeGreaterThan(0);
      expect(result?.y).toBeGreaterThan(0);

      // The position should be relative to the session terminal container
      // x = (containerLeft + cursorX * charWidth) - sessionTerminalLeft
      // y = (containerTop + cursorY * lineHeight) - sessionTerminalTop
      const expectedRelativeX = 100 + cursorX * 8.4 - 20; // Using mocked char width
      const expectedRelativeY = 50 + cursorY * (fontSize * 1.2) - 10; // Using actual line height calculation

      expect(result?.x).toBeCloseTo(expectedRelativeX, 1);
      expect(result?.y).toBeCloseTo(expectedRelativeY, 1);
    });

    it('should return null when session is not running', () => {
      const result = calculateCursorPosition(5, 3, 14, mockContainer, 'exited');
      expect(result).toBeNull();
    });

    it('should handle missing container gracefully', () => {
      // Mock a container that throws an error during getBoundingClientRect
      const errorContainer = {
        getBoundingClientRect: vi.fn().mockImplementation(() => {
          throw new Error('Container error');
        }),
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      };

      const result = calculateCursorPosition(5, 3, 14, errorContainer as any, 'running');

      // Should return null when calculation fails
      expect(result).toBeNull();
    });

    it('should cache character width measurements', () => {
      const fontSize = 14;

      // Mock a test element with consistent measurement
      const mockTestElement = {
        getBoundingClientRect: vi.fn().mockReturnValue({ width: 8.4 }),
        style: {},
        textContent: '',
      };
      const createElementSpy = vi
        .spyOn(document, 'createElement')
        .mockReturnValue(mockTestElement as any);

      // Mock appendChild and removeChild to track element creation
      const appendChildSpy = vi.spyOn(mockContainer, 'appendChild');
      const removeChildSpy = vi.spyOn(mockContainer, 'removeChild');

      // First call should create a test element and cache the result
      calculateCursorPosition(1, 1, fontSize, mockContainer, 'running');
      expect(createElementSpy).toHaveBeenCalledTimes(1);
      expect(appendChildSpy).toHaveBeenCalledTimes(1);
      expect(removeChildSpy).toHaveBeenCalledTimes(1);

      // Reset spies
      createElementSpy.mockClear();
      appendChildSpy.mockClear();
      removeChildSpy.mockClear();

      // Second call with same font size should use cached value (no new element creation)
      calculateCursorPosition(2, 2, fontSize, mockContainer, 'running');
      expect(createElementSpy).toHaveBeenCalledTimes(0); // Cached value, no new element
      expect(appendChildSpy).toHaveBeenCalledTimes(0); // No new appendChild
      expect(removeChildSpy).toHaveBeenCalledTimes(0); // No new removeChild

      // Different font size should create new measurement
      calculateCursorPosition(1, 1, 16, mockContainer, 'running');
      expect(createElementSpy).toHaveBeenCalledTimes(1); // New font size, new element
      expect(appendChildSpy).toHaveBeenCalledTimes(1);
      expect(removeChildSpy).toHaveBeenCalledTimes(1);
    });

    it('should clean up test elements even on error', () => {
      const fontSize = 14;

      // Mock a test element that will throw during getBoundingClientRect
      const testElement = {
        style: {},
        textContent: '',
        getBoundingClientRect: vi.fn().mockImplementation(() => {
          throw new Error('Test error');
        }),
      };
      vi.spyOn(document, 'createElement').mockReturnValue(testElement as any);

      // This should not throw and should still clean up
      expect(() => {
        calculateCursorPosition(1, 1, fontSize, mockContainer, 'running');
      }).not.toThrow();

      // Verify cleanup was called even though getBoundingClientRect failed
      expect(mockContainer.removeChild).toHaveBeenCalledWith(testElement);
    });

    it('should handle missing session terminal element', () => {
      // Mock getElementById to return null (session terminal not found)
      vi.spyOn(document, 'getElementById').mockImplementation(() => null);

      // Mock a test element for char width measurement
      const mockTestElement = {
        getBoundingClientRect: vi.fn().mockReturnValue({ width: 8.4 }),
        style: {},
        textContent: '',
      };
      vi.spyOn(document, 'createElement').mockReturnValue(mockTestElement as any);

      const result = calculateCursorPosition(5, 3, 14, mockContainer, 'running');

      // Should still return a position (absolute coordinates)
      expect(result).not.toBeNull();
      expect(result?.x).toBeGreaterThan(0);
      expect(result?.y).toBeGreaterThan(0);
    });

    it('should use correct font family for measurements', () => {
      const fontSize = 14;

      // Mock a test element that tracks style assignments
      const testElement = {
        style: {} as any,
        textContent: '',
        getBoundingClientRect: vi.fn().mockReturnValue({ width: 8.4 }),
      };
      const createElementSpy = vi
        .spyOn(document, 'createElement')
        .mockReturnValue(testElement as any);

      calculateCursorPosition(1, 1, fontSize, mockContainer, 'running');

      expect(createElementSpy).toHaveBeenCalledWith('span');
      expect(testElement.style.fontFamily).toBe(
        'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace'
      );
      expect(testElement.style.fontSize).toBe('14px');
      expect(testElement.textContent).toBe('0');
    });
  });

  describe('clearCharacterWidthCache', () => {
    it('should clear the character width cache', () => {
      const fontSize = 14;

      // Mock a test element with consistent measurement
      const mockTestElement = {
        getBoundingClientRect: vi.fn().mockReturnValue({ width: 8.4 }),
        style: {},
        textContent: '',
      };
      const createElementSpy = vi
        .spyOn(document, 'createElement')
        .mockReturnValue(mockTestElement as any);

      // Make a call to populate the cache
      calculateCursorPosition(1, 1, fontSize, mockContainer, 'running');
      expect(createElementSpy).toHaveBeenCalledTimes(1);

      createElementSpy.mockClear();

      // This should use cached value (no new element creation)
      calculateCursorPosition(1, 1, fontSize, mockContainer, 'running');
      expect(createElementSpy).toHaveBeenCalledTimes(0); // Uses cached value

      // Clear the cache
      clearCharacterWidthCache();

      // This should create a new measurement after cache clear
      calculateCursorPosition(1, 1, fontSize, mockContainer, 'running');
      expect(createElementSpy).toHaveBeenCalledTimes(1); // Cache cleared, new measurement needed
    });
  });
});
