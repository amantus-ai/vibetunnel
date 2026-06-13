import type { ILink } from 'ghostty-web';
import { describe, expect, it, vi } from 'vitest';
import { KeyboardShortcutLinkProvider } from './keyboard-shortcut-link-provider.js';

interface TestCell {
  chars: string;
}

function createProvider(lineCells: TestCell[], onActivate = vi.fn()) {
  const provider = new KeyboardShortcutLinkProvider(
    {
      buffer: {
        active: {
          getLine: () => ({
            length: lineCells.length,
            getCell: (column: number) => ({
              getChars: () => lineCells[column]?.chars ?? '',
            }),
          }),
        },
      },
    },
    onActivate
  );

  return { provider, onActivate };
}

function cells(text: string): TestCell[] {
  return Array.from(text, (chars) => ({ chars }));
}

function getLinks(provider: KeyboardShortcutLinkProvider): ILink[] {
  let result: ILink[] | undefined;
  provider.provideLinks(0, (links) => {
    result = links;
  });
  return result ?? [];
}

describe('KeyboardShortcutLinkProvider', () => {
  it('detects Ctrl+letter chords and sends the matching control byte', () => {
    const { provider, onActivate } = createProvider(cells('Press Ctrl+R to expand'));

    const links = getLinks(provider);

    expect(links).toHaveLength(1);
    expect(links[0].text).toBe('Ctrl+R');
    expect(links[0].range).toEqual({
      start: { x: 6, y: 0 },
      end: { x: 11, y: 0 },
    });

    links[0].activate({} as MouseEvent);
    expect(onActivate).toHaveBeenCalledWith('\x12');
  });

  it('detects multiple case-insensitive shortcuts on one line', () => {
    const { provider } = createProvider(cells('ctrl+a then CTRL+E'));

    const links = getLinks(provider);

    expect(links.map((link) => link.text)).toEqual(['ctrl+a', 'CTRL+E']);
    expect(links.map((link) => link.range)).toEqual([
      { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
      { start: { x: 12, y: 0 }, end: { x: 17, y: 0 } },
    ]);
  });

  it('maps string offsets back to canvas cells after wide graphemes', () => {
    const { provider } = createProvider([
      { chars: '界' },
      { chars: '' },
      ...cells(' Press Ctrl+C'),
    ]);

    const links = getLinks(provider);

    expect(links[0].range).toEqual({
      start: { x: 9, y: 0 },
      end: { x: 14, y: 0 },
    });
  });

  it('ignores unsupported or embedded chord text', () => {
    const { provider } = createProvider(cells('Ctrl+1 Ctrl+Shift+R myCtrl+R'));

    expect(getLinks(provider)).toEqual([]);
  });
});
