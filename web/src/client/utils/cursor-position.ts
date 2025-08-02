/**
 * Shared cursor position calculation utility for terminal components
 */
import { TERMINAL_IDS } from './terminal-constants.js';

/**
 * Calculate cursor position for IME input positioning
 * @param cursorX - Cursor column position (0-based)
 * @param cursorY - Cursor row position (0-based)
 * @param fontSize - Terminal font size in pixels
 * @param container - Terminal container element
 * @param sessionStatus - Session status ('running' or other)
 * @returns Cursor position relative to #session-terminal container, or null if unavailable
 */
export function calculateCursorPosition(
  cursorX: number,
  cursorY: number,
  fontSize: number,
  container: Element,
  sessionStatus: string
): { x: number; y: number } | null {
  if (sessionStatus !== 'running') {
    return null;
  }

  if (!container) {
    return null;
  }

  try {
    // Calculate character dimensions based on font size
    const lineHeight = fontSize * 1.2;

    // Measure character width using a test element
    const testElement = document.createElement('span');
    testElement.style.position = 'absolute';
    testElement.style.visibility = 'hidden';
    testElement.style.fontSize = `${fontSize}px`;
    testElement.style.fontFamily =
      'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace';
    testElement.textContent = '0';

    container.appendChild(testElement);
    const charWidth = testElement.getBoundingClientRect().width;
    container.removeChild(testElement);

    // Calculate cursor position within the terminal container
    const terminalRect = container.getBoundingClientRect();
    const cursorOffsetX = cursorX * charWidth;
    const cursorOffsetY = cursorY * lineHeight;

    // Calculate absolute position on the page
    const absoluteX = terminalRect.left + cursorOffsetX;
    const absoluteY = terminalRect.top + cursorOffsetY;

    // Convert to position relative to #session-terminal container
    // (The IME input is positioned relative to this container)
    const sessionTerminal = document.getElementById(TERMINAL_IDS.SESSION_TERMINAL);
    if (!sessionTerminal) {
      return { x: absoluteX, y: absoluteY };
    }

    const sessionRect = sessionTerminal.getBoundingClientRect();
    const relativeX = absoluteX - sessionRect.left;
    const relativeY = absoluteY - sessionRect.top;

    return {
      x: relativeX,
      y: relativeY,
    };
  } catch {
    return null;
  }
}
