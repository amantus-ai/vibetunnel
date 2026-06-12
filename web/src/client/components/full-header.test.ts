// @vitest-environment happy-dom

import { fixture, html } from '@open-wc/testing';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { FullHeader } from './full-header';

vi.mock('./notification-status.js', () => ({}));

describe('FullHeader', () => {
  beforeAll(async () => {
    await import('./full-header');
  });

  it.each([
    ['password', 'System Account'],
    ['ssh-key', 'SSH Key'],
    ['tailscale', 'Tailscale'],
    [null, 'Authenticated'],
    ['future-auth-method', 'Authenticated'],
  ])('shows a friendly label for the %s auth method', async (authMethod, expectedLabel) => {
    const element = await fixture<FullHeader>(html`
      <full-header .currentUser=${'test-user'} .authMethod=${authMethod}></full-header>
    `);

    const menuButton = element.querySelector<HTMLButtonElement>('[title="User menu"]');
    menuButton?.click();
    await element.updateComplete;

    expect(element.querySelector('[data-testid="auth-method-label"]')?.textContent?.trim()).toBe(
      expectedLabel
    );
  });
});
