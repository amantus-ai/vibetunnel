/**
 * Keyboard Shortcut Highlighter utility for DOM terminal
 *
 * Handles detection and highlighting of keyboard shortcuts in terminal content,
 * making them clickable to send the actual key sequences.
 */

// Constants
const TERMINAL_SHORTCUT_CLASS = 'terminal-shortcut';

// Keyboard shortcut patterns (case insensitive)
const SHORTCUT_PATTERNS = [
  // Ctrl combinations
  {
    pattern: /\bctrl\+([a-z])\b/gi,
    keySequence: (match: RegExpMatchArray) => `ctrl_${match[1].toLowerCase()}`,
  },
  { pattern: /\bctrl\+([0-9])\b/gi, keySequence: (match: RegExpMatchArray) => `ctrl_${match[1]}` },
  {
    pattern: /\bctrl\+f([1-9]|1[0-2])\b/gi,
    keySequence: (match: RegExpMatchArray) => `ctrl_f${match[1]}`,
  },

  // Common shortcuts
  {
    pattern: /\bctrl\+shift\+([a-z])\b/gi,
    keySequence: (match: RegExpMatchArray) => `ctrl_shift_${match[1].toLowerCase()}`,
  },
  {
    pattern: /\balt\+([a-z])\b/gi,
    keySequence: (match: RegExpMatchArray) => `alt_${match[1].toLowerCase()}`,
  },
  {
    pattern: /\bcmd\+([a-z])\b/gi,
    keySequence: (match: RegExpMatchArray) => `cmd_${match[1].toLowerCase()}`,
  },

  // Function keys
  { pattern: /\bf([1-9]|1[0-2])\b/gi, keySequence: (match: RegExpMatchArray) => `f${match[1]}` },

  // Special keys
  { pattern: /\besc\b/gi, keySequence: () => 'escape' },
  { pattern: /\bescape\b/gi, keySequence: () => 'escape' },
  { pattern: /\btab\b/gi, keySequence: () => 'tab' },
  { pattern: /\bshift\+tab\b/gi, keySequence: () => 'shift_tab' },
  { pattern: /\benter\b/gi, keySequence: () => 'enter' },
  { pattern: /\breturn\b/gi, keySequence: () => 'enter' },
  { pattern: /\bbackspace\b/gi, keySequence: () => 'backspace' },
  { pattern: /\bdelete\b/gi, keySequence: () => 'delete' },
  { pattern: /\bspace\b/gi, keySequence: () => ' ' },

  // Arrow keys
  {
    pattern: /\barrow\s+(up|down|left|right)\b/gi,
    keySequence: (match: RegExpMatchArray) => `arrow_${match[1].toLowerCase()}`,
  },
  {
    pattern: /\b(up|down|left|right)\s+arrow\b/gi,
    keySequence: (match: RegExpMatchArray) => `arrow_${match[1].toLowerCase()}`,
  },

  // Page keys
  {
    pattern: /\bpage\s+(up|down)\b/gi,
    keySequence: (match: RegExpMatchArray) => `page_${match[1].toLowerCase()}`,
  },
  { pattern: /\b(home|end)\b/gi, keySequence: (match: RegExpMatchArray) => match[1].toLowerCase() },

  // Common phrases with shortcuts
  { pattern: /\besc\s+to\s+(interrupt|quit|exit|cancel)\b/gi, keySequence: () => 'escape' },
  { pattern: /\bpress\s+esc\b/gi, keySequence: () => 'escape' },
  { pattern: /\bpress\s+enter\b/gi, keySequence: () => 'enter' },
  { pattern: /\bpress\s+tab\b/gi, keySequence: () => 'tab' },
  {
    pattern: /\bpress\s+ctrl\+([a-z])\b/gi,
    keySequence: (match: RegExpMatchArray) => `ctrl_${match[1].toLowerCase()}`,
  },
  {
    pattern: /\bctrl\+([a-z])\s+to\s+\w+/gi,
    keySequence: (match: RegExpMatchArray) => `ctrl_${match[1].toLowerCase()}`,
  },

  // q to quit pattern
  { pattern: /\bq\s+to\s+(quit|exit)\b/gi, keySequence: () => 'q' },
  { pattern: /\bpress\s+q\b/gi, keySequence: () => 'q' },

  // Claude Code interactive prompts - generic numbered options
  { pattern: /❯\s*(\d+)\.\s+.*/g, keySequence: (match: RegExpMatchArray) => match[1] },
  { pattern: /(\d+)\.\s+.*/g, keySequence: (match: RegExpMatchArray) => match[1] },
];

type ProcessedRange = {
  start: number;
  end: number;
};

interface ShortcutMatch {
  text: string;
  keySequence: string;
  start: number;
  end: number;
}

/**
 * Main entry point - process all keyboard shortcuts in a container
 */
export function processKeyboardShortcuts(
  container: HTMLElement,
  onShortcutClick: (keySequence: string) => void
): void {
  const processor = new ShortcutProcessor(container, onShortcutClick);
  processor.process();
}

/**
 * ShortcutProcessor class encapsulates the shortcut detection and highlighting logic
 */
class ShortcutProcessor {
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Used in constructor
  private container: HTMLElement;
  private lines: NodeListOf<Element>;
  private processedRanges: Map<number, ProcessedRange[]> = new Map();
  private onShortcutClick: (keySequence: string) => void;

  constructor(container: HTMLElement, onShortcutClick: (keySequence: string) => void) {
    this.container = container;
    this.lines = container.querySelectorAll('.terminal-line');
    this.onShortcutClick = onShortcutClick;
  }

  process(): void {
    if (this.lines.length === 0) return;

    // Process each line
    for (let i = 0; i < this.lines.length; i++) {
      this.processLine(i);
    }
  }

  private processLine(lineIndex: number): void {
    const lineText = this.getLineText(lineIndex);
    if (!lineText) return;

    // Find all shortcuts in this line
    const shortcuts = this.findShortcutsInLine(lineText);

    // Create clickable shortcuts for each match
    for (const shortcut of shortcuts) {
      // Check if already processed
      if (!this.isRangeProcessed(lineIndex, shortcut.start, shortcut.end)) {
        this.createShortcutLink(shortcut, lineIndex);
        this.markRangeAsProcessed(lineIndex, shortcut.start, shortcut.end);
      }
    }
  }

  private findShortcutsInLine(lineText: string): ShortcutMatch[] {
    const shortcuts: ShortcutMatch[] = [];

    for (const pattern of SHORTCUT_PATTERNS) {
      // Reset the regex
      pattern.pattern.lastIndex = 0;

      let match = pattern.pattern.exec(lineText);
      while (match !== null) {
        const text = match[0];
        const keySequence = pattern.keySequence(match);
        const start = match.index;
        const end = match.index + text.length;

        shortcuts.push({
          text,
          keySequence,
          start,
          end,
        });

        match = pattern.pattern.exec(lineText);
      }
    }

    // Sort by start position to handle overlaps
    shortcuts.sort((a, b) => a.start - b.start);

    // Remove overlapping matches (keep the first one)
    const nonOverlapping: ShortcutMatch[] = [];
    for (const shortcut of shortcuts) {
      const hasOverlap = nonOverlapping.some(
        (existing) => shortcut.start < existing.end && shortcut.end > existing.start
      );
      if (!hasOverlap) {
        nonOverlapping.push(shortcut);
      }
    }

    return nonOverlapping;
  }

  private createShortcutLink(shortcut: ShortcutMatch, lineIndex: number): void {
    const line = this.lines[lineIndex];
    const highlighter = new ShortcutHighlighter(line, shortcut, this.onShortcutClick);
    highlighter.createLink();
  }

  private getLineText(lineIndex: number): string {
    if (lineIndex < 0 || lineIndex >= this.lines.length) return '';
    return this.lines[lineIndex].textContent || '';
  }

  private isRangeProcessed(lineIndex: number, start: number, end: number): boolean {
    const ranges = this.processedRanges.get(lineIndex);
    if (!ranges) return false;

    return ranges.some((range) => start < range.end && end > range.start);
  }

  private markRangeAsProcessed(lineIndex: number, start: number, end: number): void {
    if (!this.processedRanges.has(lineIndex)) {
      this.processedRanges.set(lineIndex, []);
    }

    const ranges = this.processedRanges.get(lineIndex);
    if (ranges) {
      ranges.push({ start, end });
    }
  }
}

/**
 * ShortcutHighlighter handles the DOM manipulation to create clickable shortcuts
 */
class ShortcutHighlighter {
  private lineElement: Element;
  private shortcut: ShortcutMatch;
  private onShortcutClick: (keySequence: string) => void;

  constructor(
    lineElement: Element,
    shortcut: ShortcutMatch,
    onShortcutClick: (keySequence: string) => void
  ) {
    this.lineElement = lineElement;
    this.shortcut = shortcut;
    this.onShortcutClick = onShortcutClick;
  }

  createLink(): void {
    this.wrapTextInLink(this.lineElement, this.shortcut.start, this.shortcut.end);
  }

  private wrapTextInLink(lineElement: Element, startCol: number, endCol: number): void {
    // First pass: collect all text nodes and their positions
    const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT, null);
    const textNodeData: Array<{ node: Text; start: number; end: number }> = [];
    let currentPos = 0;
    let node = walker.nextNode();

    while (node) {
      const textNode = node as Text;
      const nodeText = textNode.textContent || '';
      const nodeStart = currentPos;
      const nodeEnd = currentPos + nodeText.length;

      // Only collect nodes that overlap with our range
      if (nodeEnd > startCol && nodeStart < endCol) {
        textNodeData.push({ node: textNode, start: nodeStart, end: nodeEnd });
      }

      currentPos = nodeEnd;
      node = walker.nextNode();
    }

    // Second pass: process all relevant text nodes in reverse order
    // (to avoid invalidating positions when modifying the DOM)
    for (let i = textNodeData.length - 1; i >= 0; i--) {
      const { node: textNode, start: nodeStart } = textNodeData[i];
      const nodeText = textNode.textContent || '';

      const linkStart = Math.max(0, startCol - nodeStart);
      const linkEnd = Math.min(nodeText.length, endCol - nodeStart);

      if (linkStart < linkEnd) {
        this.wrapTextNode(textNode, linkStart, linkEnd);
      }
    }
  }

  private wrapTextNode(textNode: Text, start: number, end: number): void {
    const parent = textNode.parentNode;
    if (!parent) return;

    // Don't wrap if already inside a link or shortcut
    if (this.isInsideClickable(parent as Element)) return;

    const nodeText = textNode.textContent || '';
    const beforeText = nodeText.substring(0, start);
    const linkText = nodeText.substring(start, end);
    const afterText = nodeText.substring(end);

    // Create the shortcut element
    const shortcutElement = this.createShortcutElement(linkText);

    // Replace the text node
    const fragment = document.createDocumentFragment();

    if (beforeText) {
      fragment.appendChild(document.createTextNode(beforeText));
    }

    fragment.appendChild(shortcutElement);

    if (afterText) {
      fragment.appendChild(document.createTextNode(afterText));
    }

    parent.replaceChild(fragment, textNode);
  }

  private createShortcutElement(text: string): HTMLSpanElement {
    const shortcut = document.createElement('span');
    shortcut.className = TERMINAL_SHORTCUT_CLASS;
    shortcut.style.color = '#9ca3af'; // Gray-400
    shortcut.style.textDecoration = 'underline';
    shortcut.style.textDecorationStyle = 'dotted';
    shortcut.style.cursor = 'pointer';
    shortcut.style.fontWeight = '500';
    shortcut.textContent = text;

    // Add click handler
    shortcut.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onShortcutClick(this.shortcut.keySequence);
    });

    // Add hover effects
    shortcut.addEventListener('mouseenter', () => {
      shortcut.style.backgroundColor = 'rgba(156, 163, 175, 0.2)';
      shortcut.style.color = '#d1d5db'; // Gray-300
    });

    shortcut.addEventListener('mouseleave', () => {
      shortcut.style.backgroundColor = '';
      shortcut.style.color = '#9ca3af'; // Gray-400
    });

    // Add title for accessibility
    shortcut.title = `Click to send: ${this.shortcut.keySequence}`;

    return shortcut;
  }

  private isInsideClickable(element: Element): boolean {
    let current: Element | null = element;
    while (current && current !== document.body) {
      if (
        (current.tagName === 'A' && current.classList.contains('terminal-link')) ||
        (current.tagName === 'SPAN' && current.classList.contains(TERMINAL_SHORTCUT_CLASS))
      ) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }
}

// Export as default for backwards compatibility
export const KeyboardShortcutHighlighter = {
  processKeyboardShortcuts,
};
