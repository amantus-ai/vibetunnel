import type { IBufferCell } from '@xterm/headless';

export interface BufferCell {
  char: string;
  width: number;
  fg?: number;
  bg?: number;
  attributes?: number;
}

// Attribute bit flags
const ATTR_BOLD = 0x01;
const ATTR_ITALIC = 0x02;
const ATTR_UNDERLINE = 0x04;
const ATTR_DIM = 0x08;
const ATTR_INVERSE = 0x10;
const ATTR_INVISIBLE = 0x20;
const ATTR_STRIKETHROUGH = 0x40;

// Helper function for escaping HTML
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a line from IBufferCell array (from xterm.js)
 */
export function renderLineFromBuffer(
  line: { getCell: (col: number, cell: IBufferCell) => void; length: number },
  cell: IBufferCell,
  cursorCol: number = -1
): string {
  let html = '';
  let currentChars = '';
  let currentClasses = '';
  let currentStyle = '';

  const flushGroup = () => {
    if (currentChars) {
      const escapedChars = escapeHtml(currentChars);
      html += `<span class="${currentClasses}"${currentStyle ? ` style="${currentStyle}"` : ''}>${escapedChars}</span>`;
      currentChars = '';
    }
  };

  // Process each cell in the line
  for (let col = 0; col < line.length; col++) {
    line.getCell(col, cell);
    if (!cell) continue;

    const char = cell.getChars() || ' ';
    const width = cell.getWidth();

    // Skip zero-width cells (part of wide characters)
    if (width === 0) continue;

    // Get styling
    const { classes, style } = getCellStyling(cell, col === cursorCol);

    // Check if styling changed
    if (classes !== currentClasses || style !== currentStyle) {
      flushGroup();
      currentClasses = classes;
      currentStyle = style;
    }

    currentChars += char;
  }

  // Flush remaining chars
  flushGroup();

  return html;
}

/**
 * Render a line from BufferCell array (from JSON/binary buffer)
 */
export function renderLineFromCells(cells: BufferCell[], cursorCol: number = -1): string {
  let html = '';
  let currentChars = '';
  let currentClasses = '';
  let currentStyle = '';

  const flushGroup = () => {
    if (currentChars) {
      const escapedChars = escapeHtml(currentChars);
      html += `<span class="${currentClasses}"${currentStyle ? ` style="${currentStyle}"` : ''}>${escapedChars}</span>`;
      currentChars = '';
    }
  };

  // Process each cell
  let col = 0;
  for (const cell of cells) {
    // Skip zero-width cells
    if (cell.width === 0) continue;

    // Get styling
    const { classes, style } = getCellStylingFromBuffer(cell, col === cursorCol);

    // Check if styling changed
    if (classes !== currentClasses || style !== currentStyle) {
      flushGroup();
      currentClasses = classes;
      currentStyle = style;
    }

    currentChars += cell.char;
    col += cell.width;
  }

  // Flush remaining chars
  flushGroup();

  // If the line is empty or has no visible content, add a non-breaking space
  // to ensure the line maintains its height
  if (!html) {
    html = '<span class="terminal-char">&nbsp;</span>';
  }

  return html;
}

function getCellStyling(cell: IBufferCell, isCursor: boolean): { classes: string; style: string } {
  let classes = 'terminal-char';
  let style = '';

  if (isCursor) {
    classes += ' cursor';
  }

  // Get foreground color
  const fg = cell.getFgColor();
  if (fg !== undefined) {
    if (typeof fg === 'number' && fg >= 0 && fg <= 255) {
      style += `color: var(--terminal-color-${fg});`;
    } else if (typeof fg === 'number' && fg > 255) {
      const r = (fg >> 16) & 0xff;
      const g = (fg >> 8) & 0xff;
      const b = fg & 0xff;
      style += `color: rgb(${r}, ${g}, ${b});`;
    }
  }

  // Get background color
  const bg = cell.getBgColor();
  if (bg !== undefined) {
    if (typeof bg === 'number' && bg >= 0 && bg <= 255) {
      style += `background-color: var(--terminal-color-${bg});`;
    } else if (typeof bg === 'number' && bg > 255) {
      const r = (bg >> 16) & 0xff;
      const g = (bg >> 8) & 0xff;
      const b = bg & 0xff;
      style += `background-color: rgb(${r}, ${g}, ${b});`;
    }
  }

  // Don't set background color for cursor - let CSS animation handle it

  // Get text attributes
  if (cell.isBold()) classes += ' bold';
  if (cell.isItalic()) classes += ' italic';
  if (cell.isUnderline()) classes += ' underline';
  if (cell.isDim()) classes += ' dim';
  if (cell.isStrikethrough()) classes += ' strikethrough';

  // Handle inverse colors
  if (cell.isInverse()) {
    const tempFg = style.match(/color: ([^;]+);/)?.[1];
    const tempBg = style.match(/background-color: ([^;]+);/)?.[1];
    if (tempFg && tempBg) {
      style = style.replace(/color: [^;]+;/, `color: ${tempBg};`);
      style = style.replace(/background-color: [^;]+;/, `background-color: ${tempFg};`);
    } else if (tempFg) {
      style = style.replace(/color: [^;]+;/, 'color: #1e1e1e;');
      style += `background-color: ${tempFg};`;
    } else {
      style += 'color: #1e1e1e; background-color: #d4d4d4;';
    }
  }

  // Handle invisible text
  if (cell.isInvisible()) {
    style += 'opacity: 0;';
  }

  return { classes, style };
}

function getCellStylingFromBuffer(
  cell: BufferCell,
  isCursor: boolean
): { classes: string; style: string } {
  let classes = 'terminal-char';
  let style = '';

  if (isCursor) {
    classes += ' cursor';
  }

  // Get foreground color
  if (cell.fg !== undefined) {
    if (cell.fg >= 0 && cell.fg <= 255) {
      style += `color: var(--terminal-color-${cell.fg});`;
    } else {
      const r = (cell.fg >> 16) & 0xff;
      const g = (cell.fg >> 8) & 0xff;
      const b = cell.fg & 0xff;
      style += `color: rgb(${r}, ${g}, ${b});`;
    }
  } else {
    // Default foreground color if not specified
    style += `color: #d4d4d4;`;
  }

  // Get background color
  if (cell.bg !== undefined) {
    if (cell.bg >= 0 && cell.bg <= 255) {
      style += `background-color: var(--terminal-color-${cell.bg});`;
    } else {
      const r = (cell.bg >> 16) & 0xff;
      const g = (cell.bg >> 8) & 0xff;
      const b = cell.bg & 0xff;
      style += `background-color: rgb(${r}, ${g}, ${b});`;
    }
  }

  // Don't set background color for cursor - let CSS animation handle it

  // Get text attributes from bit flags
  const attrs = cell.attributes || 0;
  if (attrs & ATTR_BOLD) classes += ' bold';
  if (attrs & ATTR_ITALIC) classes += ' italic';
  if (attrs & ATTR_UNDERLINE) classes += ' underline';
  if (attrs & ATTR_DIM) classes += ' dim';
  if (attrs & ATTR_STRIKETHROUGH) classes += ' strikethrough';

  // Handle inverse colors
  if (attrs & ATTR_INVERSE) {
    const tempFg = style.match(/color: ([^;]+);/)?.[1];
    const tempBg = style.match(/background-color: ([^;]+);/)?.[1];
    if (tempFg && tempBg) {
      style = style.replace(/color: [^;]+;/, `color: ${tempBg};`);
      style = style.replace(/background-color: [^;]+;/, `background-color: ${tempFg};`);
    } else if (tempFg) {
      style = style.replace(/color: [^;]+;/, 'color: #1e1e1e;');
      style += `background-color: ${tempFg};`;
    } else {
      style += 'color: #1e1e1e; background-color: #d4d4d4;';
    }
  }

  // Handle invisible text
  if (attrs & ATTR_INVISIBLE) {
    style += 'opacity: 0;';
  }

  return { classes, style };
}

/**
 * Decode binary buffer format
 */
export function decodeBinaryBuffer(buffer: ArrayBuffer): {
  cols: number;
  rows: number;
  viewportY: number;
  cursorX: number;
  cursorY: number;
  cells: BufferCell[][];
} {
  const view = new DataView(buffer);
  let offset = 0;

  // Read header
  const magic = view.getUint16(offset, true);
  offset += 2;
  if (magic !== 0x5654) {
    throw new Error('Invalid buffer format');
  }

  const version = view.getUint8(offset++);
  if (version !== 0x01) {
    throw new Error(`Unsupported buffer version: ${version}`);
  }

  const _flags = view.getUint8(offset++);
  const cols = view.getUint32(offset, true);
  offset += 4;
  const rows = view.getUint32(offset, true);
  offset += 4;
  const viewportY = view.getInt32(offset, true); // Signed
  offset += 4;
  const cursorX = view.getInt32(offset, true); // Signed
  offset += 4;
  const cursorY = view.getInt32(offset, true); // Signed
  offset += 4;
  offset += 4; // Skip reserved

  // Decode cells
  const cells: BufferCell[][] = [];
  const uint8 = new Uint8Array(buffer);

  // Optimized format
  while (offset < uint8.length) {
    const marker = uint8[offset++];

    if (marker === 0xfe) {
      // Empty row(s)
      const count = uint8[offset++];
      for (let i = 0; i < count; i++) {
        cells.push([{ char: ' ', width: 1 }]);
      }
    } else if (marker === 0xfd) {
      // Row with content
      const cellCount = view.getUint16(offset, true);
      offset += 2;

      const rowCells: BufferCell[] = [];
      for (let i = 0; i < cellCount; i++) {
        const result = decodeCell(uint8, offset);
        offset = result.offset;
        rowCells.push(result.cell);
      }
      cells.push(rowCells);
    }
  }

  return { cols, rows, viewportY, cursorX, cursorY, cells };
}

function decodeCell(uint8: Uint8Array, offset: number): { cell: BufferCell; offset: number } {
  const typeByte = uint8[offset++];

  // Type byte format:
  // Bit 7: Has extended data (attrs/colors)
  // Bit 6: Is Unicode (vs ASCII)
  // Bit 5: Has foreground color
  // Bit 4: Has background color
  // Bit 3: Is RGB foreground (vs palette)
  // Bit 2: Is RGB background (vs palette)
  // Bits 1-0: Character type (00=space, 01=ASCII, 10=Unicode)

  const hasExtended = !!(typeByte & 0x80);
  const isUnicode = !!(typeByte & 0x40);
  const hasFg = !!(typeByte & 0x20);
  const hasBg = !!(typeByte & 0x10);
  const isRgbFg = !!(typeByte & 0x08);
  const isRgbBg = !!(typeByte & 0x04);
  const charType = typeByte & 0x03;

  // Simple space
  if (typeByte === 0x00) {
    return {
      cell: { char: ' ', width: 1 },
      offset,
    };
  }

  // Read character
  let char: string;
  if (charType === 0x00) {
    char = ' ';
  } else if (isUnicode) {
    const charLen = uint8[offset++];
    const charBytes = uint8.slice(offset, offset + charLen);
    char = new TextDecoder().decode(charBytes);
    offset += charLen;
  } else {
    char = String.fromCharCode(uint8[offset++]);
  }

  // Default cell
  const cell: BufferCell = { char, width: 1 };

  // Read extended data if present
  if (hasExtended) {
    // Attributes
    const attributes = uint8[offset++];
    if (attributes !== 0) {
      cell.attributes = attributes;
    }

    // Foreground color
    if (hasFg) {
      if (isRgbFg) {
        cell.fg = (uint8[offset] << 16) | (uint8[offset + 1] << 8) | uint8[offset + 2];
        offset += 3;
      } else {
        cell.fg = uint8[offset++];
      }
    }

    // Background color
    if (hasBg) {
      if (isRgbBg) {
        cell.bg = (uint8[offset] << 16) | (uint8[offset + 1] << 8) | uint8[offset + 2];
        offset += 3;
      } else {
        cell.bg = uint8[offset++];
      }
    }
  }

  return { cell, offset };
}

// Re-export as object for backwards compatibility
export const TerminalRenderer = {
  renderLineFromBuffer,
  renderLineFromCells,
  decodeBinaryBuffer,
};
