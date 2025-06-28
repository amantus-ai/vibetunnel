/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UrlHighlighter } from './url-highlighter';

describe('UrlHighlighter', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function createLines(lines: string[]): void {
    container.innerHTML = lines
      .map((line) => `<div class="terminal-line">${escapeHtml(line)}</div>`)
      .join('');
  }

  function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getHighlightedUrls(): Array<{ href: string; text: string }> {
    const links = container.querySelectorAll('.terminal-link');
    return Array.from(links).map((link) => ({
      href: (link as HTMLAnchorElement).href,
      text: link.textContent || '',
    }));
  }

  function getUniqueUrls(): string[] {
    const urls = getHighlightedUrls();
    const uniqueHrefs = new Set(urls.map((u) => u.href));
    return Array.from(uniqueHrefs);
  }

  describe('Basic URL detection', () => {
    it('should detect simple HTTP URLs', () => {
      createLines(['Visit https://example.com for more info']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].href).toBe('https://example.com/');
    });

    it('should detect multiple URLs on the same line', () => {
      createLines(['Check https://example.com and https://google.com']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(2);
      expect(urls[0].href).toBe('https://example.com/');
      expect(urls[1].href).toBe('https://google.com/');
    });

    it('should detect file:// URLs', () => {
      createLines(['Open file:///Users/test/document.pdf']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].href).toBe('file:///Users/test/document.pdf');
    });

    it('should detect localhost URLs', () => {
      createLines(['Server running at http://localhost:3000/api']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].href).toBe('http://localhost:3000/api');
    });
  });

  describe('Multi-line URL detection', () => {
    it('should detect URLs split with complete protocol', () => {
      createLines(['Visit https://', 'example.com/path']);
      UrlHighlighter.processLinks(container);
      const uniqueUrls = getUniqueUrls();
      expect(uniqueUrls).toHaveLength(1);
      expect(uniqueUrls[0]).toBe('https://example.com/path');
    });

    it('should detect URLs split mid-protocol', () => {
      createLines(['Visit ht', 'tps://example.com']);
      UrlHighlighter.processLinks(container);
      const uniqueUrls = getUniqueUrls();
      expect(uniqueUrls).toHaveLength(1);
      expect(uniqueUrls[0]).toBe('https://example.com/');
    });

    it('should detect URLs split with partial protocol ending with slash', () => {
      createLines(['Visit https:/', '/example.com/path']);
      UrlHighlighter.processLinks(container);
      const uniqueUrls = getUniqueUrls();
      expect(uniqueUrls).toHaveLength(1);
      expect(uniqueUrls[0]).toBe('https://example.com/path');
    });

    it('should detect URLs wrapped mid-word without spaces', () => {
      createLines(['https://verylongdomainname', 'withextension.com/path']);
      UrlHighlighter.processLinks(container);
      const uniqueUrls = getUniqueUrls();
      expect(uniqueUrls).toHaveLength(1);
      expect(uniqueUrls[0]).toBe('https://verylongdomainnamewithextension.com/path');
    });

    it('should handle URLs spanning multiple lines', () => {
      createLines(['https://example', '.com/very/long', '/path/to/resource']);
      UrlHighlighter.processLinks(container);
      const uniqueUrls = getUniqueUrls();
      expect(uniqueUrls).toHaveLength(1);
      expect(uniqueUrls[0]).toBe('https://example.com/very/long/path/to/resource');
    });

    it('should handle domain continuation with TLD extension', () => {
      createLines(['https://example.com', '.uk/path']);
      UrlHighlighter.processLinks(container);
      const uniqueUrls = getUniqueUrls();
      expect(uniqueUrls).toHaveLength(1);
      expect(uniqueUrls[0]).toBe('https://example.com.uk/path');
    });

    it('should handle path continuation without leading slash', () => {
      createLines(['https://example.com/', 'path/to/resource']);
      UrlHighlighter.processLinks(container);
      const uniqueUrls = getUniqueUrls();
      expect(uniqueUrls).toHaveLength(1);
      expect(uniqueUrls[0]).toBe('https://example.com/path/to/resource');
    });

    it('should not continue URL with common words', () => {
      createLines(['https://example.com', 'Check this out']);
      UrlHighlighter.processLinks(container);
      const uniqueUrls = getUniqueUrls();
      expect(uniqueUrls).toHaveLength(1);
      expect(uniqueUrls[0]).toBe('https://example.com/');
    });
  });

  describe('False positive prevention', () => {
    it('should not treat file paths as URL continuations', () => {
      createLines(['Protocol: https:', '/etc/passwd is a file']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should not join unrelated text with partial protocols', () => {
      createLines(['Use http', 'server for testing']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should not create invalid URLs from random text', () => {
      createLines(['The file:', 'important.txt']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });
  });

  describe('Complex URL patterns', () => {
    it('should handle URLs with query parameters', () => {
      createLines(['https://api.example.com/search?q=test&limit=10']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].href).toBe('https://api.example.com/search?q=test&limit=10');
    });

    it('should handle URLs with fragments', () => {
      createLines(['https://docs.example.com/guide#section-2']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].href).toBe('https://docs.example.com/guide#section-2');
    });

    it('should handle URLs with parentheses', () => {
      createLines(['https://en.wikipedia.org/wiki/Example_(disambiguation)']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].href).toBe('https://en.wikipedia.org/wiki/Example_(disambiguation)');
    });

    it('should handle URLs with special characters in path', () => {
      createLines(['https://example.com/path-with_underscores/and.dots/']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].href).toBe('https://example.com/path-with_underscores/and.dots/');
    });

    it('should handle IPv6 URLs', () => {
      createLines(['http://[2001:db8::1]:8080/path']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].href).toBe('http://[2001:db8::1]:8080/path');
    });
  });

  describe('URL boundary detection', () => {
    it('should stop at whitespace', () => {
      createLines(['https://example.com and more text']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].href).toBe('https://example.com/');
    });

    it('should remove trailing punctuation', () => {
      createLines(['Visit https://example.com.']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].href).toBe('https://example.com/');
    });

    it('should handle URLs in parentheses correctly', () => {
      createLines(['(see https://example.com/page)']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].href).toBe('https://example.com/page');
    });

    it('should preserve balanced parentheses in URLs', () => {
      createLines(['https://example.com/test(foo)bar']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].href).toBe('https://example.com/test(foo)bar');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty lines', () => {
      createLines(['', 'https://example.com', '']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].href).toBe('https://example.com/');
    });

    it('should not process already highlighted URLs', () => {
      container.innerHTML =
        '<div class="terminal-line"><a class="terminal-link" href="https://example.com">https://example.com</a></div>';
      const beforeUrls = getHighlightedUrls();
      UrlHighlighter.processLinks(container);
      const afterUrls = getHighlightedUrls();
      expect(afterUrls).toHaveLength(beforeUrls.length);
      expect(afterUrls[0].href).toBe(beforeUrls[0].href);
    });

    it('should reject URLs longer than 2048 characters', () => {
      const longPath = 'a'.repeat(2040);
      createLines([`https://example.com/${longPath}`]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should handle minimum viable URLs', () => {
      createLines(['http://a.b']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].href).toBe('http://a.b/');
    });
  });

  describe('Regex syntax validation', () => {
    it('should handle URLs with all allowed special characters', () => {
      const specialCharsUrl = "https://example.com/path-_.~:/?#[]@!$&'()*+,;=%{}|\\^`end";
      createLines([`${specialCharsUrl} text`]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      // The URL should end at the space. Note: backtick gets URL-encoded to %60
      const expectedUrl = specialCharsUrl.replace('`', '%60');
      expect(urls[0].href).toBe(expectedUrl);
    });
  });

  describe('Bug fixes: Accurate range marking', () => {
    it('should correctly mark ranges for multi-line URLs', () => {
      // Test that range marking accounts for actual text on each line
      const lines = ['Check out https://very-', 'long-domain.com/path'];
      createLines(lines);
      UrlHighlighter.processLinks(container);

      const urls = getUniqueUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0]).toBe('https://very-long-domain.com/path');

      // Verify that only the URL portion is highlighted, not the entire lines
      const links = container.querySelectorAll('.terminal-link');
      const firstLineLink = links[0] as HTMLAnchorElement;
      const secondLineLink = links[1] as HTMLAnchorElement;

      expect(firstLineLink.textContent).toBe('https://very-');
      expect(secondLineLink.textContent).toBe('long-domain.com/path');
    });

    it('should correctly handle URLs ending at line boundaries', () => {
      // URL ends exactly at the line boundary with no trailing characters
      createLines(['Visit https://example.com', 'Next line with text']);
      UrlHighlighter.processLinks(container);

      const links = container.querySelectorAll('.terminal-link');
      expect(links).toHaveLength(1);
      expect(links[0].textContent).toBe('https://example.com');

      // Verify the link doesn't extend into the next line
      const nextLineText = container.querySelectorAll('.terminal-line')[1].textContent;
      expect(nextLineText).toBe('Next line with text');
    });

    it('should handle URLs with leading spaces correctly', () => {
      // Test with multi-line URL split at protocol boundary
      createLines(['Check out https://', '    example.com/path/to/resource']);
      UrlHighlighter.processLinks(container);

      const urls = getUniqueUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0]).toBe('https://example.com/path/to/resource');

      // Verify second line link starts after the spaces
      const links = container.querySelectorAll('.terminal-link');
      expect(links).toHaveLength(2);
      expect(links[0].textContent).toBe('https://');
      expect(links[1].textContent).toBe('example.com/path/to/resource');
    });

    it('should not over-mark ranges when URL is cleaned', () => {
      // Test URL with punctuation that gets cleaned
      createLines(['Check (https://example.com/test) out']);
      UrlHighlighter.processLinks(container);

      const links = container.querySelectorAll('.terminal-link');
      expect(links).toHaveLength(1);
      // The actual highlighted text should be the full URL before cleaning
      expect(links[0].textContent).toBe('https://example.com/test');

      // Verify parentheses are not included
      const lineElement = container.querySelector('.terminal-line');
      expect(lineElement).toBeTruthy();
      const lineText = lineElement?.textContent || '';
      expect(lineText).toContain('(');
      expect(lineText).toContain(')');
    });

    it('should handle URLs with cleaned endings', () => {
      // Test that the cleaned URL length doesn't under-mark the range
      createLines(['Visit https://example.com/test) here']);
      UrlHighlighter.processLinks(container);

      const urls = getUniqueUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0]).toBe('https://example.com/test');

      // Verify the link text includes the full URL before cleaning
      const links = container.querySelectorAll('.terminal-link');
      expect(links).toHaveLength(1);
      expect(links[0].textContent).toBe('https://example.com/test');
    });

    it('should not over-mark single-line URLs', () => {
      createLines(['Visit https://example.com! for more']);
      UrlHighlighter.processLinks(container);

      const links = container.querySelectorAll('.terminal-link');
      expect(links).toHaveLength(1);
      expect(links[0].textContent).toBe('https://example.com');

      // Verify exclamation mark is not included
      const fullText = container.textContent;
      expect(fullText).toContain('!');
    });
  });

  describe('Bug fixes: Multi-node URL highlighting', () => {
    it('should highlight URLs spanning multiple text nodes', () => {
      // Create a scenario with multiple text nodes within a line
      container.innerHTML =
        '<div class="terminal-line">Check <span>https://</span><span>example.com</span> out</div>';
      UrlHighlighter.processLinks(container);

      const links = container.querySelectorAll('.terminal-link');
      expect(links).toHaveLength(2); // Two spans should be converted to links

      const urls = getUniqueUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0]).toBe('https://example.com/');
    });

    it('should handle complex HTML structures with multiple text nodes', () => {
      // Create a more realistic scenario - terminal lines usually have spans for styling
      container.innerHTML = `
        <div class="terminal-line">
          <span>Visit </span>
          <span class="highlight">https://example.com/path</span>
          <span> for info</span>
        </div>
      `;
      UrlHighlighter.processLinks(container);

      const urls = getUniqueUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0]).toBe('https://example.com/path');

      // Verify the URL is highlighted
      const links = container.querySelectorAll('.terminal-link');
      expect(links.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle partial URL matches across nodes', () => {
      container.innerHTML =
        '<div class="terminal-line">URL: ht<span>tps://ex</span>ample.com here</div>';
      UrlHighlighter.processLinks(container);

      const urls = getUniqueUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0]).toBe('https://example.com/');
    });

    it('should handle deeply nested text nodes', () => {
      // Create nested structure with URL split across nested elements
      container.innerHTML = `
        <div class="terminal-line">See <strong>https://<em>example.com</em>/nested</strong> here</div>
      `;
      UrlHighlighter.processLinks(container);

      const urls = getUniqueUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0]).toBe('https://example.com/nested');

      // Verify link elements were created
      const links = container.querySelectorAll('.terminal-link');
      expect(links.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle URLs split across many small text nodes', () => {
      // Simulate each character in its own node (worst case)
      const urlChars = 'https://example.com'.split('');
      const spans = urlChars.map((char) => `<span>${char}</span>`).join('');
      container.innerHTML = `<div class="terminal-line">URL: ${spans} end</div>`;

      UrlHighlighter.processLinks(container);

      const urls = getUniqueUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0]).toBe('https://example.com/');
    });
  });

  describe('Edge cases: URL end detection on last line', () => {
    it('should properly detect URL end on the last line of container', () => {
      createLines(['Last line: https://example.com']);
      UrlHighlighter.processLinks(container);

      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].href).toBe('https://example.com/');
      expect(urls[0].text).toBe('https://example.com');
    });

    it('should handle URL ending exactly at line end on last line', () => {
      createLines(['Text before', 'https://example.com/ends-here']);
      UrlHighlighter.processLinks(container);

      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].text).toBe('https://example.com/ends-here');
    });

    it('should handle partial URL on last line', () => {
      createLines(['Starting https://']);
      UrlHighlighter.processLinks(container);

      // Partial URL should not be highlighted
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });
  });

  describe('Performance: Repeated processing', () => {
    it('should handle repeated processing without duplicating links', () => {
      createLines(['Visit https://example.com today']);

      // Process multiple times
      UrlHighlighter.processLinks(container);
      UrlHighlighter.processLinks(container);
      UrlHighlighter.processLinks(container);

      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(1);
      expect(urls[0].href).toBe('https://example.com/');
    });

    it('should correctly process after DOM modifications', () => {
      createLines(['https://example.com']);
      UrlHighlighter.processLinks(container);

      // Modify the DOM by adding new content
      const line = container.querySelector('.terminal-line');
      if (line) {
        line.appendChild(document.createTextNode(' and https://google.com'));
      }

      // Process again
      UrlHighlighter.processLinks(container);

      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(2);
      expect(urls[0].href).toBe('https://example.com/');
      expect(urls[1].href).toBe('https://google.com/');
    });
  });

  describe('Bug fix: Numbered lists should not be detected as URLs', () => {
    it('should not detect single digit numbered lists as URLs', () => {
      createLines([
        '1. First item in the list',
        '2. Second item in the list',
        '3. Third item in the list',
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should not detect double digit numbered lists as URLs', () => {
      createLines(['10. Tenth item', '11. Eleventh item', '99. Ninety-ninth item']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should not detect numbered lists with various content as URLs', () => {
      createLines([
        '1. Successfully set up Playwright E2E testing framework with:',
        '2. There might be a WebSocket or SSE connection issue',
        '3. The terminal component might not be initializing properly for web sessions',
        '4. Identified the issue: Web sessions in the test environment',
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should not detect numbered sub-lists as URLs', () => {
      createLines([
        '1.1 First sub-item',
        '1.2 Second sub-item',
        '2.1 Another sub-item',
        '10.5 Decimal numbered item',
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should still detect actual URLs in lines with numbers', () => {
      createLines([
        '1. Visit https://example.com for more info',
        '2. Check http://localhost:3000 for the local server',
        '3. The file is at file:///home/user/doc.pdf',
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(3);
      expect(urls[0].href).toBe('https://example.com/');
      expect(urls[1].href).toBe('http://localhost:3000/');
      expect(urls[2].href).toBe('file:///home/user/doc.pdf');
    });

    it('should not detect lettered lists as URLs', () => {
      createLines([
        'a. First lettered item',
        'b. Second lettered item',
        'A. Uppercase letter',
        'B. Another uppercase',
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should not detect version numbers as URLs', () => {
      createLines(['Version 1.0', 'Release 2.5.3', 'v3.14.159']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should not detect decimal numbers as URLs', () => {
      createLines([
        'Pi is approximately 3.14159',
        'The price is $19.99',
        'Temperature: 98.6 degrees',
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should not detect IP-like patterns in text as URLs', () => {
      createLines([
        'Error code 404.503 occurred',
        'Section 1.2.3 of the manual',
        'Coordinates 40.7128.74.0060',
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should still detect domains containing numbers', () => {
      createLines([
        'Visit https://web3.example.com',
        'Check http://api.v2.service.io',
        'Go to https://365.microsoft.com',
      ]);
      UrlHighlighter.processLinks(container);
      const uniqueUrls = getUniqueUrls();
      expect(uniqueUrls).toHaveLength(3);
      expect(uniqueUrls).toContain('https://web3.example.com/');
      expect(uniqueUrls).toContain('http://api.v2.service.io/');
      expect(uniqueUrls).toContain('https://365.microsoft.com/');
    });

    it('should detect domains starting with numbers', () => {
      createLines([
        'Visit https://365.microsoft.com',
        'Check https://911.gov',
        'Go to https://123movies.example.com',
        'See https://4chan.org',
      ]);
      UrlHighlighter.processLinks(container);
      const uniqueUrls = getUniqueUrls();
      expect(uniqueUrls).toHaveLength(4);
      expect(uniqueUrls).toContain('https://365.microsoft.com/');
      expect(uniqueUrls).toContain('https://911.gov/');
      expect(uniqueUrls).toContain('https://123movies.example.com/');
      expect(uniqueUrls).toContain('https://4chan.org/');
    });

    it('should not detect invalid domains with hyphens at start or end', () => {
      createLines([
        'https://-invalid.com',
        'https://invalid-.com',
        'https://test.-invalid.com',
        'https://test.invalid-.com',
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should not detect Roman numerals as URLs', () => {
      createLines([
        'i. First item',
        'ii. Second item',
        'iii. Third item',
        'iv. Fourth item',
        'v. Fifth item',
        'I. First uppercase',
        'II. Second uppercase',
        'III. Third uppercase',
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should not detect alternative list styles as URLs', () => {
      createLines([
        '1) Alternative list style',
        '2) Another item',
        '3) Third item with content',
        'a) Letter with parenthesis',
        'b) Another letter item',
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should not detect extremely long numbered lists as URLs', () => {
      createLines([
        '999. Item nine hundred ninety-nine',
        '1000. Item one thousand',
        '12345. Very long numbered item',
        '999999. Extremely long number',
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should not detect markdown-style checkbox lists as URLs', () => {
      createLines([
        '- [ ] Unchecked item',
        '- [x] Checked item',
        '* [ ] Another unchecked',
        '+ [x] Another checked',
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should not detect time formats as URLs', () => {
      createLines([
        'Meeting at 10:30 AM',
        'Deadline: 23:59:59',
        'Duration: 1:30:45',
        'Timer: 00:05:30',
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should not detect mathematical expressions as URLs', () => {
      createLines(['Result: 3.14 * 2.71', 'Formula: E = mc^2', 'Ratio 16:9', 'Score 10/10']);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(0);
    });

    it('should detect internationalized domain names', () => {
      createLines([
        'Visit https://münchen.de',
        'Check https://россия.рф',
        'Go to https://香港.cn',
        'See https://example.xn--fiqs8s', // Punycode for .中国
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      // Note: The browser's URL constructor will convert IDNs to punycode
      expect(urls.length).toBeGreaterThan(0);
    });

    it('should validate all domain labels correctly', () => {
      createLines([
        'Visit https://valid.subdomain.example.com today',
        'Check https://test-123.sub-domain.example.org now',
        'Go to https://a.b.c.d.e.f.g.com please',
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(3);
      expect(urls[0].href).toBe('https://valid.subdomain.example.com/');
      expect(urls[1].href).toBe('https://test-123.sub-domain.example.org/');
      expect(urls[2].href).toBe('https://a.b.c.d.e.f.g.com/');
    });

    it('should reject domains with invalid TLD labels', () => {
      createLines([
        'Invalid: https://example.com- (TLD ends with hyphen)',
        'Invalid: https://example.-com (TLD starts with hyphen)',
        'Valid: https://example.c-om (TLD has hyphen in middle)',
        'Invalid: https://example.123 (TLD is purely numeric)',
        'Valid: https://example.co2m (TLD with number but has letters)',
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      // Only the valid ones should be detected
      expect(urls).toHaveLength(2);
      expect(urls[0].text).toBe('https://example.c-om');
      expect(urls[1].text).toBe('https://example.co2m');
    });

    it('should validate each subdomain label independently', () => {
      createLines([
        'https://valid-.subdomain.example.com', // First label invalid
        'https://valid.-subdomain.example.com', // Second label invalid
        'https://valid.subdomain-.example.com', // Third label invalid
        'https://valid.subdomain.example-.com', // Fourth label invalid
        'https://valid.subdomain.example.-com', // TLD invalid
        'https://valid-sub.sub-domain.ex-ample.com', // All valid
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      // Only the last one with all valid labels should be detected
      expect(urls).toHaveLength(1);
      expect(urls[0].href).toBe('https://valid-sub.sub-domain.ex-ample.com/');
    });

    it('should enforce minimum domain structure', () => {
      createLines([
        'Test 1: https://com (No domain, just TLD)',
        'Test 2: https://example (No TLD)',
        'Test 3: https://example.c (Single letter TLD - valid)',
        'Test 4: https://a.b (Minimal valid domain)',
      ]);
      UrlHighlighter.processLinks(container);
      const urls = getHighlightedUrls();
      expect(urls).toHaveLength(2);
      expect(urls[0].text).toBe('https://example.c');
      expect(urls[1].text).toBe('https://a.b');
    });
  });
});
