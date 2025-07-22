/**
 * Session Test Helper
 *
 * Utilities for creating and managing sessions in tests
 */

import type { Application } from 'express';
import request from 'supertest';

export interface TestSession {
  sessionId: string;
  workingDir: string;
  command: string[];
  titleMode?: string;
  gitRepoPath?: string;
  gitBranch?: string;
}

export interface CreateSessionOptions {
  command?: string[];
  workingDir: string;
  titleMode?: string;
  title?: string;
  env?: Record<string, string>;
}

/**
 * Create a test session
 */
export async function createTestSession(
  app: Application,
  options: CreateSessionOptions
): Promise<TestSession> {
  const { command = ['bash'], workingDir, titleMode = 'dynamic', title, env } = options;

  const response = await request(app).post('/api/sessions').send({
    command,
    workingDir,
    titleMode,
    title,
    env,
  });

  if (response.status !== 200) {
    throw new Error(`Failed to create session: ${response.body.error || response.status}`);
  }

  const sessionId = response.body.sessionId;

  // Get session info to retrieve Git metadata
  const sessionsResponse = await request(app).get('/api/sessions');
  const session = sessionsResponse.body.find((s: { id: string }) => s.id === sessionId);

  return {
    sessionId,
    workingDir,
    command,
    titleMode,
    gitRepoPath: session?.gitRepoPath,
    gitBranch: session?.gitBranch,
  };
}

/**
 * Delete a test session
 */
export async function deleteTestSession(app: Application, sessionId: string): Promise<void> {
  await request(app).delete(`/api/sessions/${sessionId}`);
}

/**
 * Send input to a session
 */
export async function sendSessionInput(
  app: Application,
  sessionId: string,
  data: string
): Promise<void> {
  const response = await request(app).post(`/api/sessions/${sessionId}/input`).send({ data });

  if (response.status !== 200) {
    throw new Error(`Failed to send input: ${response.body.error || response.status}`);
  }
}

/**
 * Resize a session
 */
export async function resizeSession(
  app: Application,
  sessionId: string,
  cols: number,
  rows: number
): Promise<void> {
  const response = await request(app)
    .post(`/api/sessions/${sessionId}/resize`)
    .send({ cols, rows });

  if (response.status !== 200) {
    throw new Error(`Failed to resize session: ${response.body.error || response.status}`);
  }
}

/**
 * Get session info
 */
export async function getSessionInfo(app: Application, sessionId: string): Promise<any> {
  const response = await request(app).get('/api/sessions');

  if (response.status !== 200) {
    throw new Error(`Failed to get sessions: ${response.body.error || response.status}`);
  }

  const session = response.body.find((s: { id: string }) => s.id === sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  return session;
}

/**
 * Wait for session output
 * Note: This is a simplified version. In real tests, you might want to use SSE or WebSocket
 */
export async function waitForSessionOutput(
  app: Application,
  sessionId: string,
  timeout: number = 1000
): Promise<string> {
  // In a real implementation, this would connect to the SSE stream
  // For now, just wait a bit for the session to produce output
  await new Promise((resolve) => setTimeout(resolve, timeout));

  // Get session info which includes some output details
  const session = await getSessionInfo(app, sessionId);
  return session.title || '';
}
