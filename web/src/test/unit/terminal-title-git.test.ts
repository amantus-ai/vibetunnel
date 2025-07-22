import { describe, expect, it } from 'vitest';
import { type ActivityState, generateDynamicTitle } from '../../server/utils/terminal-title.js';

describe('Terminal Title Generation with Git Info', () => {
  describe('generateDynamicTitle', () => {
    it('should format Git repo and branch as repoName-branch', () => {
      const activity: ActivityState = { isActive: false };
      const title = generateDynamicTitle(
        '/home/user/project',
        ['bash'],
        activity,
        undefined,
        '/home/user/project',
        'main'
      );

      // The escape sequences are included in the output
      expect(title).toBe('\x1B]2;project-main · bash\x07');
    });

    it('should format Git repo in subdirectory', () => {
      const activity: ActivityState = { isActive: false };
      const title = generateDynamicTitle(
        '/home/user/project/src',
        ['vim', 'file.ts'],
        activity,
        undefined,
        '/home/user/project',
        'feature/new-ui'
      );

      expect(title).toBe('\x1B]2;project-feature/new-ui · vim\x07');
    });

    it('should handle detached HEAD state', () => {
      const activity: ActivityState = { isActive: false };
      const title = generateDynamicTitle(
        '/Users/dev/myapp',
        ['node', 'app.js'],
        activity,
        undefined,
        '/Users/dev/myapp',
        'abc1234'
      );

      expect(title).toBe('\x1B]2;myapp-abc1234 · node\x07');
    });

    it('should show path when no Git info available', () => {
      const activity: ActivityState = { isActive: false };
      const title = generateDynamicTitle('/tmp/scripts', ['python3'], activity);

      expect(title).toBe('\x1B]2;/tmp/scripts · python3\x07');
    });

    it('should show path when Git branch is empty', () => {
      const activity: ActivityState = { isActive: false };
      const title = generateDynamicTitle(
        '/home/user/project',
        ['zsh'],
        activity,
        undefined,
        '/home/user/project',
        ''
      );

      // When Git branch is empty, it falls back to showing the path
      expect(title).toBe('\x1B]2;/home/user/project · zsh\x07');
    });

    it('should include activity indicator with Git info', () => {
      const activity: ActivityState = { isActive: true };
      const title = generateDynamicTitle(
        '/home/user/webapp',
        ['npm', 'run', 'dev'],
        activity,
        undefined,
        '/home/user/webapp',
        'develop'
      );

      expect(title).toBe('\x1B]2;● webapp-develop · npm\x07');
    });

    it('should handle long branch names', () => {
      const activity: ActivityState = { isActive: false };
      const title = generateDynamicTitle(
        '/home/user/project',
        ['git', 'status'],
        activity,
        undefined,
        '/home/user/project',
        'feature/JIRA-1234-implement-new-authentication-system-with-oauth2'
      );

      expect(title).toBe(
        '\x1B]2;project-feature/JIRA-1234-implement-new-authentication-system-with-oauth2 · git\x07'
      );
    });

    it('should include session name when provided', () => {
      const activity: ActivityState = { isActive: false };
      const title = generateDynamicTitle(
        '/Users/dev/monorepo/packages/client',
        ['pnpm', 'test'],
        activity,
        'pnpm test (~/monorepo/packages/client)',
        '/Users/dev/monorepo',
        'main'
      );

      // Auto-generated session names are not treated as custom names
      expect(title).toBe('\x1B]2;pnpm test (~/monorepo/packages/client)\x07');
    });

    it('should use custom session name without Git info', () => {
      const activity: ActivityState = { isActive: false };
      const title = generateDynamicTitle(
        '/home/user/project',
        ['bash'],
        activity,
        'My Custom Session',
        '/home/user/project',
        'staging'
      );

      // Custom session names are used exclusively
      expect(title).toBe('\x1B]2;My Custom Session\x07');
    });

    it('should handle specific status with Git info', () => {
      const activity: ActivityState = {
        isActive: true,
        specificStatus: { status: 'Building...' },
      };
      const title = generateDynamicTitle(
        '/home/user/project',
        ['npm', 'run', 'build'],
        activity,
        undefined,
        '/home/user/project',
        'main'
      );

      expect(title).toBe('\x1B]2;Building... · project-main · npm\x07');
    });
  });

  describe('Title Format Edge Cases', () => {
    it('should handle special characters in branch names', () => {
      const activity: ActivityState = { isActive: false };
      const title = generateDynamicTitle(
        '/home/user/project',
        ['code', '.'],
        activity,
        undefined,
        '/home/user/project',
        'fix/issue-#123'
      );

      expect(title).toBe('\x1B]2;project-fix/issue-#123 · code\x07');
    });

    it('should handle unicode in branch names', () => {
      const activity: ActivityState = { isActive: false };
      const title = generateDynamicTitle(
        '/home/user/project',
        ['vim'],
        activity,
        undefined,
        '/home/user/project',
        'feature/添加中文支持'
      );

      expect(title).toBe('\x1B]2;project-feature/添加中文支持 · vim\x07');
    });

    it('should handle branch names with spaces', () => {
      const activity: ActivityState = { isActive: false };
      const title = generateDynamicTitle(
        '/home/user/project',
        ['bash'],
        activity,
        undefined,
        '/home/user/project',
        'branch with spaces'
      );

      expect(title).toBe('\x1B]2;project-branch with spaces · bash\x07');
    });

    it('should handle Git repo at root', () => {
      const activity: ActivityState = { isActive: false };
      const title = generateDynamicTitle('/', ['bash'], activity, undefined, '/', 'master');

      // path.basename('/') returns '' so the repo name is empty
      expect(title).toBe('\x1B]2;-master · bash\x07');
    });

    it('should show home directory with tilde', () => {
      const activity: ActivityState = { isActive: false };
      const homeDir = require('os').homedir();
      const title = generateDynamicTitle(homeDir, ['zsh'], activity);

      expect(title).toBe('\x1B]2;~ · zsh\x07');
    });

    it('should handle empty command array', () => {
      const activity: ActivityState = { isActive: false };
      const title = generateDynamicTitle(
        '/home/user/project',
        [],
        activity,
        undefined,
        '/home/user/project',
        'main'
      );

      expect(title).toBe('\x1B]2;project-main · shell\x07');
    });
  });
});
