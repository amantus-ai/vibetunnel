import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeLogger,
  createLogger,
  flushLogger,
  setLogFilePath,
  setVerbosityLevel,
  VerbosityLevel,
} from '../../server/utils/logger';

const MAX_LOG_SIZE = 50 * 1024 * 1024;

function readFileTail(filePath: string, length: number = 1024): string {
  const fileSize = fs.statSync(filePath).size;
  const buffer = Buffer.alloc(Math.min(fileSize, length));
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.readSync(descriptor, buffer, 0, buffer.length, fileSize - buffer.length);
  } finally {
    fs.closeSync(descriptor);
  }
  return buffer.toString('utf8');
}

describe('logger rotation', () => {
  let tempDir: string;
  let logPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetunnel-logger-'));
    logPath = path.join(tempDir, 'server.log');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    setVerbosityLevel(VerbosityLevel.INFO);
  });

  afterEach(async () => {
    await flushLogger();
    closeLogger();
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes the threshold-crossing message before rotating and preserves queued messages', async () => {
    fs.writeFileSync(logPath, '');
    fs.truncateSync(logPath, MAX_LOG_SIZE);
    fs.writeFileSync(`${logPath}.1`, 'stale backup');
    setLogFilePath(logPath);

    const logger = createLogger('rotation-test');
    logger.info('first message after rotation');
    logger.info('second queued message');
    await flushLogger();

    expect(fs.statSync(`${logPath}.1`).size).toBeGreaterThan(MAX_LOG_SIZE);
    expect(readFileTail(`${logPath}.1`)).toContain('first message after rotation');
    const currentLog = fs.readFileSync(logPath, 'utf8');
    expect(currentLog).toContain('second queued message');
  });

  it('flushes queued messages when closed during rotation', async () => {
    fs.writeFileSync(logPath, '');
    fs.truncateSync(logPath, MAX_LOG_SIZE);
    setLogFilePath(logPath);

    const logger = createLogger('rotation-test');
    logger.info('message before close');
    closeLogger();
    await flushLogger();

    expect(readFileTail(`${logPath}.1`)).toContain('message before close');
  });
});
