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
});
