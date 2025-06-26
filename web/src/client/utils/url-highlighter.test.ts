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
});
