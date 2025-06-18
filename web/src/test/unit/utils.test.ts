import { describe, it, expect } from 'vitest';

// Mock implementations for testing
class UrlHighlighter {
  highlight(text: string): string {
    // Escape HTML first
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    // Then detect and highlight URLs
    return escaped.replace(
      /(https?:\/\/[^\s]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
  }
}

class CastConverter {
  private width: number;
  private height: number;
  private events: Array<[number, 'o', string]> = [];
  private title?: string;
  private env?: Record<string, string>;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  addOutput(output: string, timestamp: number): void {
    this.events.push([timestamp, 'o', output]);
  }

  setTitle(title: string): void {
    this.title = title;
  }

  setEnvironment(env: Record<string, string>): void {
    this.env = env;
  }

  getCast(): {
    version: number;
    width: number;
    height: number;
    timestamp: number;
    title?: string;
    env: Record<string, string>;
    events: Array<[number, 'o', string]>;
  } {
    return {
      version: 2,
      width: this.width,
      height: this.height,
      timestamp: Math.floor(Date.now() / 1000),
      title: this.title,
      env: this.env || {},
      events: this.events,
    };
  }

  toJSON(): string {
    return JSON.stringify(this.getCast());
  }
}

describe('Utility Functions', () => {
  describe('UrlHighlighter', () => {
    it('should detect http URLs', () => {
      const highlighter = new UrlHighlighter();
      const text = 'Check out http://example.com for more info';
      const result = highlighter.highlight(text);

      expect(result).toContain('<a');
      expect(result).toContain('href="http://example.com"');
      expect(result).toContain('http://example.com</a>');
    });

    it('should detect https URLs', () => {
      const highlighter = new UrlHighlighter();
      const text = 'Secure site: https://secure.example.com/path';
      const result = highlighter.highlight(text);

      expect(result).toContain('href="https://secure.example.com/path"');
    });

    it('should handle multiple URLs', () => {
      const highlighter = new UrlHighlighter();
      const text = 'Visit http://site1.com and https://site2.com';
      const result = highlighter.highlight(text);

      const matches = result.match(/<a[^>]*>/g);
      expect(matches).toHaveLength(2);
    });

    it('should preserve text around URLs', () => {
      const highlighter = new UrlHighlighter();
      const text = 'Before http://example.com after';
      const result = highlighter.highlight(text);

      expect(result).toMatch(/^Before <a[^>]*>http:\/\/example\.com<\/a> after$/);
    });

    it('should handle text without URLs', () => {
      const highlighter = new UrlHighlighter();
      const text = 'No URLs here, just plain text';
      const result = highlighter.highlight(text);

      expect(result).toBe(text);
    });

    it('should escape HTML in non-URL text', () => {
      const highlighter = new UrlHighlighter();
      const text = '<script>alert("xss")</script> http://safe.com';
      const result = highlighter.highlight(text);

      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
      expect(result).toContain('<a');
    });

    it('should handle localhost URLs', () => {
      const highlighter = new UrlHighlighter();
      const text = 'Local dev: http://localhost:3000/api';
      const result = highlighter.highlight(text);

      expect(result).toContain('href="http://localhost:3000/api"');
    });

    it('should handle IP address URLs', () => {
      const highlighter = new UrlHighlighter();
      const text = 'Server at http://192.168.1.1:8080';
      const result = highlighter.highlight(text);

      expect(result).toContain('href="http://192.168.1.1:8080"');
    });
  });

  describe('CastConverter', () => {
    it('should create basic cast structure', () => {
      const converter = new CastConverter(80, 24);
      const cast = converter.getCast();

      expect(cast.version).toBe(2);
      expect(cast.width).toBe(80);
      expect(cast.height).toBe(24);
      expect(cast.timestamp).toBeGreaterThan(0);
      expect(Array.isArray(cast.events)).toBe(true);
    });

    it('should add output events', () => {
      const converter = new CastConverter(80, 24);
      converter.addOutput('Hello World\n', 1.0);

      const cast = converter.getCast();
      expect(cast.events).toHaveLength(1);
      expect(cast.events[0]).toEqual([1.0, 'o', 'Hello World\n']);
    });

    it('should handle multiple events in order', () => {
      const converter = new CastConverter(80, 24);
      converter.addOutput('First\n', 0.5);
      converter.addOutput('Second\n', 1.0);
      converter.addOutput('Third\n', 1.5);

      const cast = converter.getCast();
      expect(cast.events).toHaveLength(3);
      expect(cast.events[0][0]).toBe(0.5);
      expect(cast.events[1][0]).toBe(1.0);
      expect(cast.events[2][0]).toBe(1.5);
    });

    it('should handle empty output', () => {
      const converter = new CastConverter(80, 24);
      converter.addOutput('', 1.0);

      const cast = converter.getCast();
      expect(cast.events).toHaveLength(1);
      expect(cast.events[0][2]).toBe('');
    });

    it('should handle special characters', () => {
      const converter = new CastConverter(80, 24);
      const specialChars = '\x1b[31mRed Text\x1b[0m\n';
      converter.addOutput(specialChars, 1.0);

      const cast = converter.getCast();
      expect(cast.events[0][2]).toBe(specialChars);
    });

    it('should export valid JSON', () => {
      const converter = new CastConverter(80, 24);
      converter.addOutput('Test\n', 1.0);

      const json = converter.toJSON();
      const parsed = JSON.parse(json);

      expect(parsed.version).toBe(2);
      expect(parsed.width).toBe(80);
      expect(parsed.height).toBe(24);
      expect(parsed.events).toHaveLength(1);
    });

    it('should set custom environment', () => {
      const converter = new CastConverter(80, 24);
      const env = { SHELL: '/bin/bash', TERM: 'xterm-256color' };
      converter.setEnvironment(env);

      const cast = converter.getCast();
      expect(cast.env).toEqual(env);
    });

    it('should set custom title', () => {
      const converter = new CastConverter(80, 24);
      converter.setTitle('My Recording');

      const cast = converter.getCast();
      expect(cast.title).toBe('My Recording');
    });

    it('should handle timing precision', () => {
      const converter = new CastConverter(80, 24);
      converter.addOutput('Output', 1.123456789);

      const cast = converter.getCast();
      // Should maintain precision to at least 5 decimal places
      expect(cast.events[0][0]).toBeCloseTo(1.123456, 5);
    });
  });
});
