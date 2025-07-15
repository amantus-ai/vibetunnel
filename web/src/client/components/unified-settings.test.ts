import { elementUpdated, expect, fixture, html } from '@open-wc/testing';
import { vi } from 'vitest';
import type { AppPreferences } from './unified-settings';
import './unified-settings';
import type { UnifiedSettings } from './unified-settings';

// Mock fetch for API calls
global.fetch = vi.fn();

// Mock WebSocket
class MockWebSocket {
  url: string;
  readyState = 1; // OPEN
  onopen?: (event: Event) => void;
  onmessage?: (event: MessageEvent) => void;
  onerror?: (event: Event) => void;
  onclose?: (event: CloseEvent) => void;

  constructor(url: string) {
    this.url = url;
    // Simulate open event
    setTimeout(() => {
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 0);
  }

  send(_data: string) {
    // Mock send
  }

  close() {
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }

  // Helper to simulate receiving a message
  simulateMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
  }
}

// Replace global WebSocket
(global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;

describe('UnifiedSettings - Repository Path Server Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Mock default fetch response
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        repositoryBasePath: '~/',
        serverConfigured: false,
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should show repository path as editable when not server-configured', async () => {
    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    await elementUpdated(el);

    // Find the repository base path input
    const input = el.shadowRoot?.querySelector('input[placeholder="~/"]') as HTMLInputElement;

    expect(input).to.exist;
    expect(input.disabled).to.be.false;
    expect(input.readOnly).to.be.false;
    expect(input.classList.contains('opacity-60')).to.be.false;
    expect(input.classList.contains('cursor-not-allowed')).to.be.false;
  });

  it('should show repository path as read-only when server-configured', async () => {
    // Mock server response with serverConfigured = true
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        repositoryBasePath: '/Users/test/Projects',
        serverConfigured: true,
      }),
    });

    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    await elementUpdated(el);

    // Find the repository base path input
    const input = el.shadowRoot?.querySelector('input[placeholder="~/"]') as HTMLInputElement;

    expect(input).to.exist;
    expect(input.disabled).to.be.true;
    expect(input.readOnly).to.be.true;
    expect(input.classList.contains('opacity-60')).to.be.true;
    expect(input.classList.contains('cursor-not-allowed')).to.be.true;
    expect(input.value).to.equal('/Users/test/Projects');
  });

  it('should display lock icon and message when server-configured', async () => {
    // Mock server response with serverConfigured = true
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        repositoryBasePath: '/Users/test/Projects',
        serverConfigured: true,
      }),
    });

    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    await elementUpdated(el);

    // Check for the lock icon
    const lockIcon = el.shadowRoot?.querySelector('svg');
    expect(lockIcon).to.exist;

    // Check for the descriptive text
    const description = el.shadowRoot?.querySelector('p.text-xs');
    expect(description?.textContent).to.include('This path is managed by the VibeTunnel Mac app');
  });

  it('should update repository path via WebSocket when server sends update', async () => {
    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    await elementUpdated(el);

    // Get the WebSocket instance created by the component
    const ws = (el as UnifiedSettings & { configWebSocket: MockWebSocket }).configWebSocket;
    expect(ws).to.exist;

    // Simulate server sending a config update
    ws.simulateMessage({
      type: 'config',
      data: {
        repositoryBasePath: '/Users/new/path',
        serverConfigured: true,
      },
    });

    await elementUpdated(el);

    // Check that the input value updated
    const input = el.shadowRoot?.querySelector('input[placeholder="~/"]') as HTMLInputElement;
    expect(input.value).to.equal('/Users/new/path');
    expect(input.disabled).to.be.true;
  });

  it('should ignore repository path changes when server-configured', async () => {
    // Mock server response with serverConfigured = true
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        repositoryBasePath: '/Users/test/Projects',
        serverConfigured: true,
      }),
    });

    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    await elementUpdated(el);

    // Try to change the repository path
    const originalPath = '/Users/test/Projects';
    (
      el as UnifiedSettings & { handleAppPreferenceChange: (key: string, value: string) => void }
    ).handleAppPreferenceChange('repositoryBasePath', '/Users/different/path');

    await elementUpdated(el);

    // Verify the path didn't change
    const preferences = (el as UnifiedSettings & { appPreferences: AppPreferences }).appPreferences;
    expect(preferences.repositoryBasePath).to.equal(originalPath);
  });

  it('should reconnect WebSocket after disconnection', async () => {
    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    await elementUpdated(el);

    const ws = (el as UnifiedSettings & { configWebSocket: MockWebSocket }).configWebSocket;
    const originalWs = ws;

    // Simulate WebSocket close
    ws.close();

    // Wait for reconnection timeout (5 seconds in the code, but we'll use a shorter time for testing)
    await new Promise((resolve) => setTimeout(resolve, 5100));

    // Check that a new WebSocket was created
    const newWs = (el as UnifiedSettings & { configWebSocket?: MockWebSocket }).configWebSocket;
    expect(newWs).to.exist;
    expect(newWs).to.not.equal(originalWs);
  });

  it('should handle WebSocket message parsing errors gracefully', async () => {
    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    await elementUpdated(el);

    const ws = (el as UnifiedSettings & { configWebSocket: MockWebSocket }).configWebSocket;

    // Send invalid JSON
    if (ws.onmessage) {
      ws.onmessage(new MessageEvent('message', { data: 'invalid json' }));
    }

    // Should not throw and component should still work
    await elementUpdated(el);
    expect(el).to.exist;
  });

  it('should save preferences when updated from server', async () => {
    const el = await fixture<UnifiedSettings>(html`<unified-settings></unified-settings>`);
    await elementUpdated(el);

    // Spy on localStorage
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    // Get the WebSocket instance
    const ws = (el as UnifiedSettings & { configWebSocket: MockWebSocket }).configWebSocket;

    // Simulate server update
    ws.simulateMessage({
      type: 'config',
      data: {
        repositoryBasePath: '/Users/updated/path',
        serverConfigured: true,
      },
    });

    await elementUpdated(el);

    // Verify localStorage was updated
    expect(setItemSpy).to.have.been.calledWith(
      'app-preferences',
      expect.stringContaining('/Users/updated/path')
    );
  });
});
