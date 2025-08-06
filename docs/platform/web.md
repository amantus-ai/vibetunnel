# Web Development

## Setup

### Prerequisites
- Node.js 18+
- Bun 1.0+
- pnpm 8+

### Install & Run

```bash
cd web
pnpm install
pnpm dev          # Development server
pnpm build        # Production build
pnpm test         # Run tests
```

## Project Structure

```
web/
├── src/
│   ├── server/           # Node.js backend
│   │   ├── server.ts     # HTTP/WebSocket server
│   │   ├── pty/          # Terminal management
│   │   ├── services/     # Business logic
│   │   └── routes/       # API endpoints
│   ├── client/           # Web frontend
│   │   ├── app.ts        # Main application
│   │   ├── components/   # Lit components
│   │   └── services/     # Client services
│   └── shared/           # Shared types
├── dist/                 # Build output
└── tests/                # Test files
```

## Server Development

### Core Services

| Service | File | Purpose |
|---------|------|---------|
| TerminalManager | `services/terminal-manager.ts` | PTY lifecycle |
| SessionManager | `services/session-manager.ts` | Session state |
| BufferAggregator | `services/buffer-aggregator.ts` | Output batching |
| AuthService | `services/auth.ts` | Authentication |

### API Routes

```typescript
// routes/api.ts
router.post('/api/sessions', createSession);
router.get('/api/sessions', listSessions);
router.get('/api/sessions/:id', getSession);
router.delete('/api/sessions/:id', deleteSession);
router.ws('/api/sessions/:id/ws', handleWebSocket);
```

### WebSocket Handler

```typescript
// services/websocket-handler.ts
export async function handleWebSocket(ws: WebSocket, sessionId: string) {
  const session = await sessionManager.get(sessionId);
  
  // Binary protocol for terminal data
  session.onData((data: Buffer) => {
    ws.send(encodeBuffer(data));
  });
  
  // Handle client messages
  ws.on('message', (msg: Buffer) => {
    const data = JSON.parse(msg.toString());
    if (data.type === 'input') {
      session.write(data.data);
    }
  });
}
```

### PTY Management

```typescript
// pty/pty-manager.ts
import * as pty from 'node-pty';

export class PTYManager {
  create(options: PTYOptions): IPty {
    return pty.spawn(options.shell || '/bin/zsh', options.args, {
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd || process.env.HOME,
      env: { ...process.env, ...options.env }
    });
  }
}
```

## Client Development

### Lit Components

```typescript
// components/terminal-view.ts
@customElement('terminal-view')
export class TerminalView extends LitElement {
  @property({ type: String }) sessionId = '';
  
  private terminal?: Terminal;
  private ws?: WebSocket;
  
  createRenderRoot() {
    return this; // No shadow DOM for Tailwind
  }
  
  firstUpdated() {
    this.initTerminal();
    this.connectWebSocket();
  }
  
  render() {
    return html`
      <div id="terminal" class="h-full w-full"></div>
    `;
  }
}
```

### WebSocket Client

```typescript
// services/websocket-client.ts
export class WebSocketClient {
  private ws?: WebSocket;
  
  connect(sessionId: string): void {
    this.ws = new WebSocket(`ws://localhost:4020/api/sessions/${sessionId}/ws`);
    this.ws.binaryType = 'arraybuffer';
    
    this.ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const text = this.decodeBuffer(event.data);
        this.onData?.(text);
      }
    };
  }
  
  send(data: string): void {
    this.ws?.send(JSON.stringify({ type: 'input', data }));
  }
}
```

### Terminal Integration

```typescript
// services/terminal-service.ts
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

export class TerminalService {
  private terminal: Terminal;
  private fitAddon: FitAddon;
  
  initialize(container: HTMLElement): void {
    this.terminal = new Terminal({
      theme: {
        background: '#1e1e1e',
        foreground: '#ffffff'
      }
    });
    
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(container);
    this.fitAddon.fit();
  }
}
```

## Build System

### Development Build

```json
// package.json scripts
{
  "dev": "concurrently \"npm:dev:*\"",
  "dev:server": "tsx watch src/server/server.ts",
  "dev:client": "vite",
  "dev:tailwind": "tailwindcss -w"
}
```

### Production Build

```bash
# Build everything
pnpm build

# Outputs:
# dist/server/   - Compiled server
# dist/client/   - Static web assets
# dist/bun       - Standalone executable
```

### Bun Compilation

```typescript
// scripts/build-bun.ts
await Bun.build({
  entrypoints: ['src/server/server.ts'],
  outdir: 'dist',
  target: 'bun',
  minify: true,
  sourcemap: 'external'
});
```

## Testing

### Unit Tests

```typescript
// tests/terminal-manager.test.ts
describe('TerminalManager', () => {
  it('creates session', async () => {
    const manager = new TerminalManager();
    const session = await manager.create({ shell: '/bin/bash' });
    expect(session.id).toBeDefined();
  });
});
```

### E2E Tests

```typescript
// tests/e2e/session.test.ts
test('create and connect to session', async ({ page }) => {
  await page.goto('http://localhost:4020');
  await page.click('button:text("New Terminal")');
  await expect(page.locator('.terminal')).toBeVisible();
});
```

## Performance

### Optimization Techniques

| Technique | Implementation | Impact |
|-----------|---------------|--------|
| Buffer aggregation | Batch every 16ms | 90% fewer messages |
| Binary protocol | Magic byte encoding | 50% smaller payload |
| Virtual scrolling | xterm.js built-in | Handles 100K+ lines |
| Service worker | Cache static assets | Instant load |

### Benchmarks

```typescript
// Measure WebSocket throughput
const start = performance.now();
let bytes = 0;

ws.onmessage = (event) => {
  bytes += event.data.byteLength;
  if (performance.now() - start > 1000) {
    console.log(`Throughput: ${bytes / 1024}KB/s`);
  }
};
```

## Debugging

### Server Debugging

```bash
# Run with inspector
node --inspect dist/server/server.js

# With source maps
NODE_OPTIONS='--enable-source-maps' node dist/server/server.js

# Verbose logging
DEBUG=vt:* pnpm dev:server
```

### Client Debugging

```javascript
// Enable xterm.js debug mode
terminal.options.logLevel = 'debug';

// WebSocket debugging
ws.addEventListener('message', (e) => {
  console.log('WS received:', e.data);
});
```

## Common Issues

| Issue | Solution |
|-------|----------|
| CORS errors | Check server CORS config |
| WebSocket fails | Verify port/firewall |
| Terminal garbled | Check encoding (UTF-8) |
| Build fails | Clear node_modules |

## See Also
- [API Reference](../core/api-reference.md)
- [Protocol Specs](../core/protocols.md)
- [Development Guide](../guides/development.md)