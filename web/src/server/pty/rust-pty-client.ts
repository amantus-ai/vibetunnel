import { EventEmitter } from 'events';

export interface SpawnOptions {
  cwd?: string;
  cols?: number;
  rows?: number;
}

export interface SpawnResult {
  id: string;
  pid: number;
}

export class RustPtyProcess extends EventEmitter {
  private timer?: NodeJS.Timeout;

  constructor(private info: SpawnResult) {
    super();
  }

  get pid() {
    return this.info.pid;
  }

  async write(data: string): Promise<void> {
    await sendInput(this.info.id, data);
  }

  async resize(cols: number, rows: number): Promise<void> {
    await resize(this.info.id, cols, rows);
  }

  async kill(): Promise<void> {
    this.stopPolling();
    await kill(this.info.id);
  }

  startPolling(interval = 100) {
    const poll = async () => {
      const out = await read(this.info.id);
      if (out) this.emit('data', out);
      this.timer = setTimeout(poll, interval);
    };
    poll();
  }

  stopPolling() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

const BASE_URL = process.env.RUST_PTY_URL || 'http://127.0.0.1:4030';

export async function createSession(command: string[], options: SpawnOptions): Promise<SpawnResult> {
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, cwd: options.cwd, cols: options.cols, rows: options.rows }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return (await res.json()) as SpawnResult;
}

export async function sendInput(id: string, data: string): Promise<void> {
  await fetch(`${BASE_URL}/sessions/${id}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
}

export async function resize(id: string, cols: number, rows: number): Promise<void> {
  await fetch(`${BASE_URL}/sessions/${id}/resize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cols, rows }),
  });
}

export async function read(id: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/sessions/${id}/read`);
  if (!res.ok) return '';
  return res.text();
}

export async function kill(id: string): Promise<void> {
  await fetch(`${BASE_URL}/sessions/${id}`, { method: 'DELETE' });
}
