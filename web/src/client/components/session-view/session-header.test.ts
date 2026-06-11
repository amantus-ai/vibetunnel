// @vitest-environment happy-dom

import { fixture, html } from '@open-wc/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  const elements: SessionHeader[] = [];

  afterEach(() => {
    for (const element of elements) {
      element.remove();
    }
    elements.length = 0;
  });

  async function renderHeader(options: {
    isMobile: boolean;
    showBackButton?: boolean;
    showSidebarToggle?: boolean;
    sidebarCollapsed?: boolean;
    onBack?: () => void;
    onSidebarToggle?: () => void;
  }): Promise<SessionHeader> {
    const element = await fixture<SessionHeader>(html`
      <session-header
        .session=${createMockSession({ id: 'header-controls' })}
        .isMobile=${options.isMobile}
        .showBackButton=${options.showBackButton ?? false}
        .showSidebarToggle=${options.showSidebarToggle ?? false}
        .sidebarCollapsed=${options.sidebarCollapsed ?? false}
        .onBack=${options.onBack}
        .onSidebarToggle=${options.onSidebarToggle}
      ></session-header>
    `);
    elements.push(element);
    return element;
  }

  it('renders compact 44px mobile navigation controls and preserves callbacks', async () => {
    const onBack = vi.fn();
    const onSidebarToggle = vi.fn();
    const element = await renderHeader({
      isMobile: true,
      showBackButton: true,
      showSidebarToggle: true,
      sidebarCollapsed: true,
      onBack,
      onSidebarToggle,
    });

    const backButton = element.querySelector<HTMLButtonElement>(
      '[data-testid="session-back-button"]'
    );
    const sidebarButton = element.querySelector<HTMLButtonElement>(
      '[data-testid="session-sidebar-toggle"]'
    );
    const chatButton = element.querySelector<HTMLButtonElement>(
      '[data-testid="chat-mode-toggle-button-compact"]'
    );
    const menuButton = element.querySelector<HTMLButtonElement>(
      'compact-menu button[aria-label="More actions menu"]'
    );

    for (const button of [backButton, sidebarButton, chatButton, menuButton]) {
      expect(button).toBeTruthy();
      expect(button?.classList.contains('w-11')).toBe(true);
      expect(button?.classList.contains('h-11')).toBe(true);
    }

    expect(backButton?.getAttribute('aria-label')).toBe('Back');
    expect(backButton?.textContent?.trim()).toBe('');
    expect(backButton?.querySelector('svg')).toBeTruthy();

    backButton?.click();
    sidebarButton?.click();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSidebarToggle).toHaveBeenCalledTimes(1);
  });

  it('keeps the desktop back label and responsive sizing classes', async () => {
    const element = await renderHeader({ isMobile: false, showBackButton: true });
    const backButton = element.querySelector<HTMLButtonElement>(
      '[data-testid="session-back-button"]'
    );

    expect(backButton?.textContent?.trim()).toBe('Back');
    expect(backButton?.classList.contains('md:w-auto')).toBe(true);
    expect(backButton?.classList.contains('md:h-auto')).toBe(true);
  });
});
