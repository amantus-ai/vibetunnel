// @vitest-environment happy-dom

import { fixture, html } from '@open-wc/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSession } from '@/test/utils/lit-test-utils';
import type { SessionHeader } from './session-header.js';

const terminalSocketClientMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  getConnectionStatus: vi.fn(() => true),
  onConnectionStateChange: vi.fn(() => () => {}),
}));

vi.mock('../../services/terminal-socket-client.js', () => ({
  terminalSocketClient: terminalSocketClientMock,
}));

import './session-header.js';

describe('SessionHeader', () => {
  let element: SessionHeader;

  beforeEach(async () => {
    element = await fixture<SessionHeader>(html`
      <session-header
        .session=${createMockSession({ id: 'header-back-button' })}
        .showBackButton=${true}
      ></session-header>
    `);
  });

  afterEach(() => {
    element.remove();
  });

  it('uses a 44px mobile target for the back button', () => {
    const backButton = Array.from(element.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Back'
    );

    expect(backButton).toBeTruthy();
    expect(backButton?.classList.contains('min-h-[44px]')).toBe(true);
    expect(backButton?.classList.contains('sm:min-h-0')).toBe(true);
  });
});
