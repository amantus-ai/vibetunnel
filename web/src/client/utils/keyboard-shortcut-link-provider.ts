import type { ILink, ILinkProvider } from 'ghostty-web';

const CONTROL_SHORTCUT_PATTERN = /\bctrl\+([a-z])\b/gi;

function containsControlCharacter(text: string): boolean {
  return Array.from(text).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || codePoint === 0x7f;
  });
}

interface TerminalCell {
  getChars(): string;
}

interface TerminalLine {
  readonly length: number;
  getCell(column: number): TerminalCell | undefined;
}

interface LinkProviderTerminal {
  buffer: {
    active: {
      getLine(row: number): TerminalLine | undefined;
    };
  };
}

interface LineText {
  text: string;
  columns: number[];
}

/**
 * Exposes printed Ctrl+letter chords as Ghostty canvas links.
 */
export class KeyboardShortcutLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: LinkProviderTerminal,
    private readonly onActivate: (controlCharacter: string) => void
  ) {}

  provideLinks(row: number, callback: (links: ILink[] | undefined) => void): void {
    const line = this.terminal.buffer.active.getLine(row);
    if (!line) {
      callback(undefined);
      return;
    }

    const lineText = this.readLine(line);
    const links: ILink[] = [];
    CONTROL_SHORTCUT_PATTERN.lastIndex = 0;

    let match = CONTROL_SHORTCUT_PATTERN.exec(lineText.text);
    while (match) {
      const start = lineText.columns[match.index];
      const end = lineText.columns[match.index + match[0].length - 1];
      const letter = match[1].toLowerCase();

      if (start !== undefined && end !== undefined) {
        links.push({
          text: match[0],
          range: {
            start: { x: start, y: row },
            end: { x: end, y: row },
          },
          activate: () => this.onActivate(String.fromCharCode(letter.charCodeAt(0) - 96)),
        });
      }

      match = CONTROL_SHORTCUT_PATTERN.exec(lineText.text);
    }

    callback(links.length > 0 ? links : undefined);
  }

  private readLine(line: TerminalLine): LineText {
    let text = '';
    const columns: number[] = [];

    for (let column = 0; column < line.length; column++) {
      const chars = line.getCell(column)?.getChars() ?? '';
      const displayText = chars && !containsControlCharacter(chars) ? chars : ' ';

      text += displayText;
      for (let offset = 0; offset < displayText.length; offset++) {
        columns.push(column);
      }
    }

    return { text, columns };
  }
}
