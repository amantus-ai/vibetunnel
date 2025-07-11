# Vendored PTY

This is a vendored fork of [node-pty](https://github.com/microsoft/node-pty) v1.1.0-beta34 with the threading and shared pipe architecture removed.

## Why?

The original node-pty uses a shared pipe/socket architecture through `ConoutSocketWorker` that causes issues when used heavily:
- All PTY instances write to the same shared pipe
- This can overwhelm other Electron processes (like VS Code) that are also listening on the pipe
- Heavy usage from VibeTunnel causes crashes in other applications

## What's Changed?

1. **Removed ConoutSocketWorker** - No more worker threads for socket management
2. **Removed shared pipe architecture** - Each PTY instance uses direct file descriptors
3. **Simplified Windows implementation** - Direct socket connections without intermediary workers
4. **Kept core functionality** - The essential PTY spawn/resize/kill operations remain unchanged

## Building

```bash
npm install
npm run build
```

The native modules will be compiled during installation.

## Usage

The API remains compatible with node-pty:

```javascript
const pty = require('node-pty');
const ptyProcess = pty.spawn('bash', [], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: process.env.HOME,
  env: process.env
});

ptyProcess.on('data', function(data) {
  console.log(data);
});

ptyProcess.write('ls\r');
```