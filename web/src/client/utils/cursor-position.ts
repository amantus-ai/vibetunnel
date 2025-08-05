/**
 * Shared cursor position calculation utility for terminal components
 */
import { TERMINAL_FONT_FAMILY, TERMINAL_IDS } from './terminal-constants.js';

// Cache for character width measurements per font size
const charWidthCache = new Map<number, number>();

/**
 * Measure character width for a given font size, with caching
 * @param fontSize - Font size in pixels
 * @param container - Container element to append test element to
 * @returns Character width in pixels
 */
function measureCharacterWidth(fontSize: number, container: Element): number {
  // Return cached value if available
  if (charWidthCache.has(fontSize)) {
    const cachedWidth = charWidthCache.get(fontSize);
    if (cachedWidth !== undefined) {
      return cachedWidth;
    }
  }

  // Create test element to measure character width
  const testElement = document.createElement('span');
  testElement.style.position = 'absolute';
  testElement.style.visibility = 'hidden';
  testElement.style.fontSize = `${fontSize}px`;
  testElement.style.fontFamily = TERMINAL_FONT_FAMILY;
  testElement.textContent = '0';

  try {
    container.appendChild(testElement);
    const charWidth = testElement.getBoundingClientRect().width;

    // Cache the measurement
    charWidthCache.set(fontSize, charWidth);
    return charWidth;
  } finally {
    // Ensure cleanup even if measurement fails
    container.removeChild(testElement);
  }
}

/**
 * Clear the character width cache
 * Call when font size changes or on window resize/zoom
 */
export function clearCharacterWidthCache(): void {
  charWidthCache.clear();
}

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

    // Get character width with caching
    const charWidth = measureCharacterWidth(fontSize, container);

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
