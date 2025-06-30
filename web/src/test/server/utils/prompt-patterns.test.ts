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

    it('should reject unusually long inputs', () => {
      const longInput = `${'x'.repeat(10001)}$ `;
      expect(PromptDetector.isPromptOnly(longInput)).toBe(false);

      // Just under the limit should work
      const justUnderLimit = `${'x'.repeat(9998)}$ `;
      expect(PromptDetector.isPromptOnly(justUnderLimit)).toBe(false); // Still false because it's not just a prompt

      // A normal prompt padded with spaces under the limit
      const paddedPrompt = `${' '.repeat(9998)}$ `;
      expect(PromptDetector.isPromptOnly(paddedPrompt)).toBe(true);
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
      const largeOutput = `${'x'.repeat(10000)}\n$ `;

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

    it('should handle mixed content with prompts', () => {
      // Prompt in the middle of output
      expect(PromptDetector.endsWithPrompt('some output $ more output')).toBe(false);
      expect(PromptDetector.endsWithPrompt('$ first command\n$ ')).toBe(true);

      // Multiple prompts
      expect(PromptDetector.isPromptOnly('$ $ $')).toBe(false);
      expect(PromptDetector.isPromptOnly('$ # %')).toBe(false);
    });

    it('should handle very long bracketed prompts', () => {
      const longPath = '/very/long/path/that/goes/on/and/on/and/on';
      expect(PromptDetector.isPromptOnly(`[${longPath}]$ `)).toBe(true);
      expect(PromptDetector.endsWithPrompt(`output\n[${longPath}]$ `)).toBe(true);
    });

    it('should handle prompts with timestamps', () => {
      expect(PromptDetector.isPromptOnly('[2024-01-01 12:00:00]$ ')).toBe(true);
      expect(PromptDetector.isPromptOnly('[Mon Jan 01 12:00:00 UTC 2024]# ')).toBe(true);
    });

    it('should handle prompts with git branch info', () => {
      expect(PromptDetector.isPromptOnly('[main]$ ')).toBe(true);
      expect(PromptDetector.isPromptOnly('[feature/new-feature]❯ ')).toBe(true);
      expect(PromptDetector.isPromptOnly('[HEAD detached at abc123]$ ')).toBe(true);
    });

    it('should handle prompts with exit codes', () => {
      expect(PromptDetector.isPromptOnly('[0]$ ')).toBe(true);
      expect(PromptDetector.isPromptOnly('[127]$ ')).toBe(true);
      expect(PromptDetector.isPromptOnly('[✓]$ ')).toBe(true);
      expect(PromptDetector.isPromptOnly('[✗]$ ')).toBe(true);
    });
  });

  describe('getShellType extended tests', () => {
    it('should identify Python REPL correctly', () => {
      expect(PromptDetector.getShellType('>>> ')).toBe('python');
      expect(PromptDetector.getShellType('... ')).toBe('pythonContinuation');
    });

    it('should identify PowerShell variants', () => {
      expect(PromptDetector.getShellType('PS C:\\> ')).toBe('powershell');
      expect(PromptDetector.getShellType('PS> ')).toBe('powershell');
    });

    it('should handle prompts with escape sequences in getShellType', () => {
      expect(PromptDetector.getShellType('$ \x1B[0m')).toBe('withEscape');
      expect(PromptDetector.getShellType('❯ \x1B[32m')).toBe('withEscape');
    });
  });

  describe('cache eviction', () => {
    it('should evict oldest entries when cache is full', () => {
      // Clear stats first
      PromptDetector.clearCache();

      // Fill cache to capacity
      const maxSize = PromptDetector.getCacheStats().maxSize;
      for (let i = 0; i < maxSize; i++) {
        PromptDetector.isPromptOnly(`test${i}$ `);
      }

      let stats = PromptDetector.getCacheStats();
      expect(stats.size).toBe(maxSize);

      // Add one more to trigger eviction
      PromptDetector.isPromptOnly('trigger-eviction$ ');

      stats = PromptDetector.getCacheStats();
      // Should have evicted ~20% of entries
      expect(stats.size).toBeLessThanOrEqual(maxSize);
      expect(stats.size).toBeGreaterThan(maxSize * 0.7);
    });
  });

  describe('real-world scenarios', () => {
    it('should handle actual terminal output correctly', () => {
      const npmOutput = `
> my-app@1.0.0 build
> tsc && vite build

vite v5.0.0 building for production...
✓ 123 modules transformed.
dist/index.html                0.45 kB
dist/assets/index-abc123.js   142.50 kB

✓ built in 2.34s
$ `;
      expect(PromptDetector.endsWithPrompt(npmOutput)).toBe(true);
    });

    it('should handle SSH session prompts', () => {
      expect(PromptDetector.isPromptOnly('user@remote-host:~$ ')).toBe(false); // Not bracketed
      expect(PromptDetector.isPromptOnly('[user@remote-host ~]$ ')).toBe(true); // Bracketed
      expect(PromptDetector.isPromptOnly('root@server:/var/log# ')).toBe(false); // Not bracketed
      expect(PromptDetector.isPromptOnly('[root@server:/var/log]# ')).toBe(true); // Bracketed
    });

    it('should handle Docker container prompts', () => {
      expect(PromptDetector.isPromptOnly('[root@container-id /]# ')).toBe(true);
      expect(PromptDetector.isPromptOnly('[app@container-name /app]$ ')).toBe(true);
    });

    it('should handle custom prompt configurations', () => {
      // Starship style prompts
      expect(PromptDetector.isPromptOnly('[~/projects/app]❯ ')).toBe(true);
      expect(PromptDetector.isPromptOnly('[nodejs:18.0.0]$ ')).toBe(true);

      // Oh My Zsh themes
      expect(PromptDetector.isPromptOnly('[master ✗]$ ')).toBe(true);
      expect(PromptDetector.isPromptOnly('[10:30:45]➜ ')).toBe(true);
    });
  });

  describe('negative lookbehind tests', () => {
    it('should correctly apply negative lookbehind for Python prompts', () => {
      // These should NOT be detected as prompts
      expect(PromptDetector.isPromptOnly('>>>')).toBe(false);
      expect(PromptDetector.isPromptOnly('...')).toBe(false);
      expect(PromptDetector.endsWithPrompt('print("hello")\n>>>')).toBe(false);
      expect(PromptDetector.endsWithPrompt('  File "<stdin>", line 1\n...')).toBe(false);

      // But regular > should still work
      expect(PromptDetector.isPromptOnly('>')).toBe(true);
      expect(PromptDetector.endsWithPrompt('command\n>')).toBe(true);
    });
  });

  describe('backward compatibility exports', () => {
    it('should export standalone functions', async () => {
      // Import the standalone exports
      const { isPromptOnly, endsWithPrompt } = await import(
        '../../../server/utils/prompt-patterns.js'
      );

      // They should work the same as the class methods
      expect(isPromptOnly('$ ')).toBe(true);
      expect(isPromptOnly('not a prompt')).toBe(false);
      expect(endsWithPrompt('output\n$ ')).toBe(true);
      expect(endsWithPrompt('no prompt here')).toBe(false);
    });
  });
});
