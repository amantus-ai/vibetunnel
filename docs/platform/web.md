# Web Development

## Setup

### Prerequisites
- Node.js 22.12+
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
| PtyManager | `server/pty/pty-manager.ts` | PTY lifecycle + input/resize |
| SessionManager | `server/pty/session-manager.ts` | On-disk session metadata + stdout/stderr paths |
| TerminalManager | `server/services/terminal-manager.ts` | Server-side terminal state + VT snapshots |
| CastOutputHub | `server/services/cast-output-hub.ts` | Stdout tail + pruning (`lastClearOffset`) |
| GitStatusHub | `server/services/git-status-hub.ts` | Git status updates for sessions |
| WsV3Hub | `server/services/ws-v3-hub.ts` | Unified WebSocket v3 transport (`/ws`) |

### API Routes
- HTTP: `/api/...` (sessions, git, config, worktrees)
- WebSocket: `/ws` (binary v3 framing; see `docs/websocket.md`)

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
// services/terminal-socket-client.ts
//
// Single `/ws` WebSocket (v3 framing). Multiplexes sessions via `sessionId`.
import { terminalSocketClient } from './services/terminal-socket-client.js';

terminalSocketClient.initialize();

const unsubscribe = terminalSocketClient.subscribe(sessionId, {
  stdout: true,
  snapshots: true,
  events: true,
  onStdout: (bytes) => {
    // forward bytes to Ghostty renderer
  },
  onSnapshot: (snapshot) => {
    // update preview / hard resync
  },
  onEvent: (event) => {
    // handle exit, git-status, etc
  },
});
```

### Terminal Integration

```typescript
// services/terminal-service.ts
import { Ghostty, Terminal, FitAddon } from 'ghostty-web';

export class TerminalService {
  private terminal: Terminal;
  private fitAddon: FitAddon;
  
  async initialize(container: HTMLElement): Promise<void> {
    const ghostty = await Ghostty.load('/ghostty-vt.wasm');
    this.terminal = new Terminal({
      ghostty,
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
| Multiplexed transport | `/ws` WebSocket v3 framing | One socket for all sessions |
| Snapshot previews | VT snapshot v1 (`SNAPSHOT_VT`) | Fast previews / hard resync |
| Virtual scrolling | ghostty-web scrollback | Handles 100K+ lines |
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
// Terminal debugging
const terminalEl = document.querySelector('vibe-terminal');
console.log(terminalEl?.getDebugText?.({ maxLines: 50 }));

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
