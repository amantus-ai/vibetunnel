import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PromptDetector } from '../../../server/utils/prompt-patterns.js';

describe('PromptDetector', () => {
  beforeEach(() => {
    // Clear cache before each test for predictable results
    PromptDetector.clearCache();
  });

  afterEach(() => {
    // Clean up after tests
    PromptDetector.clearCache();
  });

  describe('isPromptOnly', () => {
    it('should detect basic shell prompts', () => {
      expect(PromptDetector.isPromptOnly('$ ')).toBe(true);
      expect(PromptDetector.isPromptOnly('$')).toBe(true);
      expect(PromptDetector.isPromptOnly('> ')).toBe(true);
      expect(PromptDetector.isPromptOnly('# ')).toBe(true);
      expect(PromptDetector.isPromptOnly('% ')).toBe(true);
    });

    it('should detect modern shell prompts', () => {
      expect(PromptDetector.isPromptOnly('❯ ')).toBe(true);
      expect(PromptDetector.isPromptOnly('❯')).toBe(true);
      expect(PromptDetector.isPromptOnly('➜ ')).toBe(true);
      expect(PromptDetector.isPromptOnly('➜')).toBe(true);
    });

    it('should detect bracketed prompts', () => {
      expect(PromptDetector.isPromptOnly('[user@host]$ ')).toBe(true);
      expect(PromptDetector.isPromptOnly('[root@server]# ')).toBe(true);
      expect(PromptDetector.isPromptOnly('[~/projects]% ')).toBe(true);
    });

    it('should handle whitespace correctly', () => {
      expect(PromptDetector.isPromptOnly('  $  ')).toBe(true);
      expect(PromptDetector.isPromptOnly('\t$\t')).toBe(true);
      expect(PromptDetector.isPromptOnly('\n$\n')).toBe(true);
    });

    it('should reject prompts with additional content', () => {
      expect(PromptDetector.isPromptOnly('$ ls')).toBe(false);
      expect(PromptDetector.isPromptOnly('output text $')).toBe(false);
      expect(PromptDetector.isPromptOnly('$ \nmore output')).toBe(false);
    });

    it('should reject non-prompt content', () => {
      expect(PromptDetector.isPromptOnly('hello world')).toBe(false);
      expect(PromptDetector.isPromptOnly('command output')).toBe(false);
      expect(PromptDetector.isPromptOnly('')).toBe(false);
    });
  });

  describe('endsWithPrompt', () => {
    it('should detect prompts at end of output', () => {
      expect(PromptDetector.endsWithPrompt('command output\n$ ')).toBe(true);
      expect(PromptDetector.endsWithPrompt('last line\n> ')).toBe(true);
      expect(PromptDetector.endsWithPrompt('root command\n# ')).toBe(true);
    });

    it('should detect modern prompts at end', () => {
      expect(PromptDetector.endsWithPrompt('output\n❯ ')).toBe(true);
      expect(PromptDetector.endsWithPrompt('done\n➜ ')).toBe(true);
    });

    it('should detect bracketed prompts at end', () => {
      expect(PromptDetector.endsWithPrompt('finished\n[user@host]$ ')).toBe(true);
      expect(PromptDetector.endsWithPrompt('complete\n[~/dir]% ')).toBe(true);
    });

    it('should handle prompts with ANSI escape codes', () => {
      // Prompt followed by color reset
      expect(PromptDetector.endsWithPrompt('output\n$ \x1B[0m')).toBe(true);
      expect(PromptDetector.endsWithPrompt('done\n❯ \x1B[32m')).toBe(true);

      // Colored prompts
      expect(PromptDetector.endsWithPrompt('text\n\x1B[32m$\x1B[0m ')).toBe(true);
    });

    it('should reject output not ending with prompt', () => {
      expect(PromptDetector.endsWithPrompt('$ command')).toBe(false);
      expect(PromptDetector.endsWithPrompt('output without prompt')).toBe(false);
      expect(PromptDetector.endsWithPrompt('$ \nmore output')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(PromptDetector.endsWithPrompt('')).toBe(false);
      expect(PromptDetector.endsWithPrompt('$')).toBe(true);
      expect(PromptDetector.endsWithPrompt('\n\n$')).toBe(true);
    });
  });

  describe('getShellType', () => {
    it('should identify bash/sh prompts', () => {
      expect(PromptDetector.getShellType('$ ')).toBe('bash');
      expect(PromptDetector.getShellType('[user@host]$ ')).toBe('bracketed');
    });

    it('should identify zsh prompts', () => {
      expect(PromptDetector.getShellType('% ')).toBe('zsh');
      expect(PromptDetector.getShellType('❯ ')).toBe('zsh');
    });

    it('should identify fish prompts', () => {
      expect(PromptDetector.getShellType('➜ ')).toBe('fish');
    });

    it('should identify root prompts', () => {
      expect(PromptDetector.getShellType('# ')).toBe('root');
      expect(PromptDetector.getShellType('[root@host]# ')).toBe('bracketed');
    });

    it('should identify PowerShell prompts', () => {
      expect(PromptDetector.getShellType('> ')).toBe('powershell');
    });

    it('should return null for non-prompts', () => {
      expect(PromptDetector.getShellType('not a prompt')).toBe(null);
      expect(PromptDetector.getShellType('')).toBe(null);
    });
  });

  describe('caching behavior', () => {
    it('should cache isPromptOnly results', () => {
      const testString = '$ ';

      // First call - cache miss
      expect(PromptDetector.isPromptOnly(testString)).toBe(true);

      // Second call - cache hit
      expect(PromptDetector.isPromptOnly(testString)).toBe(true);

      // Check cache stats
      const stats = PromptDetector.getCacheStats();
      expect(stats.hitRate.only).toBe(1);
    });

    it('should cache endsWithPrompt results', () => {
      const testString = 'output\n$ ';

      // First call - cache miss
      expect(PromptDetector.endsWithPrompt(testString)).toBe(true);

      // Second call - cache hit
      expect(PromptDetector.endsWithPrompt(testString)).toBe(true);

      // Check cache stats
      const stats = PromptDetector.getCacheStats();
      expect(stats.hitRate.end).toBe(1);
    });

    it('should clear cache when requested', () => {
      // Add some entries to cache
      PromptDetector.isPromptOnly('$ ');
      PromptDetector.endsWithPrompt('text\n$ ');

      let stats = PromptDetector.getCacheStats();
      expect(stats.size).toBeGreaterThan(0);

      // Clear cache
      PromptDetector.clearCache();

      stats = PromptDetector.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hitRate.only).toBe(0);
      expect(stats.hitRate.end).toBe(0);
    });
  });

  describe('performance', () => {
    it('should handle large inputs efficiently', () => {
      const largeOutput = 'x'.repeat(10000) + '\n$ ';

      const start = performance.now();
      const result = PromptDetector.endsWithPrompt(largeOutput);
      const duration = performance.now() - start;

      expect(result).toBe(true);
      expect(duration).toBeLessThan(5); // Should complete in less than 5ms
    });

    it('should benefit from caching on repeated calls', () => {
      const testString = 'output\n$ ';

      // Warm up
      PromptDetector.endsWithPrompt(testString);

      // Measure cached call
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        PromptDetector.endsWithPrompt(testString);
      }
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1); // 1000 cached calls should be very fast
    });
  });

  describe('edge cases', () => {
    it('should handle Unicode prompts correctly', () => {
      expect(PromptDetector.isPromptOnly('λ ')).toBe(false); // Lambda not supported yet
      expect(PromptDetector.isPromptOnly('→ ')).toBe(false); // Right arrow not supported
      expect(PromptDetector.isPromptOnly('❯ ')).toBe(true); // But fish/zsh arrows are
    });

    it('should handle multi-line prompts', () => {
      expect(PromptDetector.endsWithPrompt('>>> ')).toBe(false); // Python REPL
      expect(PromptDetector.endsWithPrompt('... ')).toBe(false); // Python continuation
    });

    it('should handle prompts with special characters', () => {
      expect(PromptDetector.isPromptOnly('[git:main]$ ')).toBe(true);
      expect(PromptDetector.isPromptOnly('[~/my-project]❯ ')).toBe(true);
      expect(PromptDetector.isPromptOnly('[12:34:56]# ')).toBe(true);
    });
  });
});
