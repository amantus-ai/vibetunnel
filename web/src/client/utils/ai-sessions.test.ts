import { describe, expect, it } from 'vitest';
import { createTestSession } from '../../test/utils/test-factories';
import { isAIAssistantSession } from './ai-sessions';

describe('isAIAssistantSession', () => {
  it('recognizes Auggie executables and wrappers', () => {
    expect(isAIAssistantSession(createTestSession({ command: ['auggie'] }))).toBe(true);
    expect(
      isAIAssistantSession(createTestSession({ command: ['/usr/local/bin/auggie-wrapper'] }))
    ).toBe(true);
    expect(
      isAIAssistantSession(createTestSession({ command: ['/bin/zsh', '-lc', 'auggie'] }))
    ).toBe(true);
  });

  it('does not match unrelated commands containing the name', () => {
    expect(isAIAssistantSession(createTestSession({ command: ['auggie-helper'] }))).toBe(false);
  });
});
