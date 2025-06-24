# Frontend Testing Plan

## Overview

This document outlines a comprehensive testing strategy for VibeTunnel's web frontend components. Currently, only one frontend test exists (`buffer-subscription-service.test.ts`), leaving the UI components untested.

## Testing Philosophy

### What to Test
- **User interactions**: Click handlers, form submissions, keyboard shortcuts
- **Component state management**: State transitions, property updates
- **Event handling**: Custom events, DOM events, WebSocket messages
- **Error scenarios**: Network failures, invalid inputs, edge cases
- **Accessibility**: ARIA attributes, keyboard navigation

### What NOT to Test
- LitElement framework internals
- Third-party library behavior (xterm.js, Monaco editor)
- CSS styling (unless it affects functionality)
- Browser API implementations

## Component Test Categories

### 1. Core Terminal Components

#### terminal.ts
**Test scenarios:**
- Terminal initialization with different configurations
- Input handling (keyboard events, paste operations)
- WebSocket connection lifecycle
- Buffer updates and rendering
- Resize handling
- Error states (disconnection, invalid data)

**Example test structure:**
```typescript
describe('VibeTerminal', () => {
  let element: VibeTerminal;
  let mockWebSocket: MockWebSocket;
  
  beforeEach(async () => {
    mockWebSocket = new MockWebSocket();
    element = await fixture(html`<vibe-terminal session-id="test-123"></vibe-terminal>`);
  });
  
  it('should initialize terminal with correct dimensions', async () => {
    await element.updateComplete;
    expect(element.terminal).toBeDefined();
    expect(element.terminal.cols).toBe(80);
    expect(element.terminal.rows).toBe(24);
  });
  
  it('should handle keyboard input', async () => {
    const inputSpy = vi.fn();
    element.addEventListener('terminal-input', inputSpy);
    
    await element.updateComplete;
    element.terminal.write('test');
    
    expect(inputSpy).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { data: 'test' } })
    );
  });
});
```

#### vibe-terminal-buffer.ts
**Test scenarios:**
- Buffer rendering from different data formats
- Cursor position updates
- Selection handling
- Performance with large buffers

### 2. Session Management Components

#### session-list.ts
**Test scenarios:**
- Loading sessions from API
- Real-time updates via SSE
- Session filtering and sorting
- Empty state handling
- Error handling

#### session-card.ts
**Test scenarios:**
- Session status display
- Action buttons (connect, disconnect, delete)
- Preview rendering
- Hover/focus states

#### session-create-form.ts
**Test scenarios:**
- Form validation
- API submission
- Loading states
- Error handling
- Success navigation

### 3. Authentication Components

#### auth-login.ts
**Test scenarios:**
- Form submission
- Password validation
- Error message display
- Redirect after successful login
- Remember me functionality

### 4. Utility Components

#### notification-status.ts
**Test scenarios:**
- Permission request flow
- Status display updates
- Settings persistence
- Browser API mocking

#### file-browser.ts
**Test scenarios:**
- Directory navigation
- File selection
- Path validation
- Upload handling

## Testing Utilities

### Enhanced Test Helpers
```typescript
// test/utils/component-helpers.ts
export async function renderComponent<T extends LitElement>(
  template: TemplateResult,
  options?: { viewport?: { width: number; height: number } }
): Promise<T> {
  const element = await fixture<T>(template);
  if (options?.viewport) {
    Object.defineProperty(window, 'innerWidth', { value: options.viewport.width });
    Object.defineProperty(window, 'innerHeight', { value: options.viewport.height });
  }
  return element;
}

export function mockFetch(responses: Map<string, any>) {
  return vi.fn((url: string) => {
    const response = responses.get(url);
    return Promise.resolve({
      ok: true,
      json: async () => response,
      text: async () => JSON.stringify(response)
    });
  });
}
```

### WebSocket Test Utilities
```typescript
// test/utils/websocket-mock.ts
export class MockWebSocket extends EventTarget {
  readyState = WebSocket.CONNECTING;
  url: string;
  
  constructor(url: string) {
    super();
    this.url = url;
    setTimeout(() => this.open(), 0);
  }
  
  open() {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }
  
  send(data: string | ArrayBuffer) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
  
  close() {
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }
}
```

## Test Organization

```
web/src/client/
├── components/
│   ├── __tests__/
│   │   ├── terminal.test.ts
│   │   ├── session-list.test.ts
│   │   ├── session-card.test.ts
│   │   └── ...
│   ├── terminal.ts
│   ├── session-list.ts
│   └── ...
└── services/
    └── __tests__/
        └── buffer-subscription-service.test.ts
```

## CI Integration

Frontend tests will run in the same CI pipeline as backend tests:

1. **Same test command**: `pnpm run test:coverage`
2. **Same job**: `build-and-test` in `.github/workflows/node.yml`
3. **Unified coverage**: Frontend and backend coverage combined
4. **Same thresholds**: 80% coverage requirement applies

### CI Considerations
- Tests use `happy-dom` environment (already configured)
- No need for real browser testing initially
- Coverage reports aggregate automatically
- Failing tests block PR merges

## Implementation Phases

### Phase 1: Core Components (Week 1)
- [ ] terminal.ts - Basic functionality
- [ ] session-list.ts - Data loading and display
- [ ] session-card.ts - User interactions
- [ ] Test utilities enhancement

### Phase 2: Session Management (Week 2)
- [ ] session-create-form.ts - Form handling
- [ ] session-view.ts - Complete session lifecycle
- [ ] Error scenarios across components
- [ ] WebSocket interaction tests

### Phase 3: Secondary Components (Week 3)
- [ ] auth-login.ts - Authentication flow
- [ ] notification-status.ts - Browser API mocking
- [ ] file-browser.ts - File operations
- [ ] Integration tests for component interactions

### Phase 4: Polish and Coverage (Week 4)
- [ ] Achieve 80% coverage target
- [ ] Performance tests for large datasets
- [ ] Accessibility test suite
- [ ] Documentation and examples

## Success Metrics

- **Coverage**: Achieve and maintain 80% code coverage
- **Test Speed**: All unit tests complete in < 10 seconds
- **Reliability**: Zero flaky tests
- **Maintainability**: Clear test names and structure
- **Documentation**: Every complex test has explanatory comments

## Example Component Test

Here's a complete example for the session-card component:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fixture, html, oneEvent } from '@open-wc/testing';
import { SessionCard } from '../session-card';
import type { Session } from '../../types';

describe('SessionCard', () => {
  let element: SessionCard;
  const mockSession: Session = {
    id: 'test-123',
    name: 'Test Session',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    cols: 80,
    rows: 24
  };
  
  beforeEach(async () => {
    element = await fixture(html`
      <session-card .session=${mockSession}></session-card>
    `);
  });
  
  it('displays session information', () => {
    const nameEl = element.shadowRoot!.querySelector('.session-name');
    expect(nameEl?.textContent).toBe('Test Session');
    
    const statusEl = element.shadowRoot!.querySelector('.session-status');
    expect(statusEl?.classList.contains('active')).toBe(true);
  });
  
  it('emits connect event when clicked', async () => {
    const listener = oneEvent(element, 'session-connect');
    
    const card = element.shadowRoot!.querySelector('.session-card') as HTMLElement;
    card.click();
    
    const event = await listener;
    expect(event.detail.sessionId).toBe('test-123');
  });
  
  it('handles delete action', async () => {
    // Mock the fetch API
    global.fetch = vi.fn(() => 
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    );
    
    const deleteBtn = element.shadowRoot!.querySelector('.delete-btn') as HTMLElement;
    deleteBtn.click();
    
    // Confirm dialog would appear here - mock it
    element.confirmDelete();
    
    expect(fetch).toHaveBeenCalledWith('/api/sessions/test-123', {
      method: 'DELETE'
    });
  });
  
  it('shows error state on delete failure', async () => {
    global.fetch = vi.fn(() => 
      Promise.reject(new Error('Network error'))
    );
    
    await element.deleteSession();
    
    expect(element.error).toBe('Failed to delete session');
    const errorEl = element.shadowRoot!.querySelector('.error-message');
    expect(errorEl).toBeTruthy();
  });
});
```

## Next Steps

1. **Review and approve** this testing plan
2. **Set up** enhanced testing utilities
3. **Begin Phase 1** implementation
4. **Track progress** via GitHub issues/PRs
5. **Iterate** based on learnings