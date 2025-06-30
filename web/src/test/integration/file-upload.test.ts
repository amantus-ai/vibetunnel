/**
 * Integration tests for file upload functionality
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBasicAuthHeader } from '../utils/server-utils.js';

describe('File Upload API', () => {
  const baseUrl = 'http://localhost:4020';
  const authHeader = createBasicAuthHeader('testuser', 'testpass');

  beforeAll(async () => {
    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  it('should upload a file successfully', async () => {
    // Create a simple test text file
    const testFileContent = 'Hello, world!';

    const formData = new FormData();
    const blob = new Blob([testFileContent], { type: 'text/plain' });
    formData.append('file', blob, 'test.txt');

    const response = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
      },
      body: formData,
    });

    expect(response.ok).toBe(true);
    const result = await response.json();

    expect(result).toMatchObject({
      success: true,
      filename: expect.stringMatching(/^[a-f0-9-]+\.txt$/),
      originalName: 'test.txt',
      size: testFileContent.length,
      mimetype: 'text/plain',
      path: expect.stringContaining('uploads'),
      relativePath: expect.stringContaining('uploads'),
    });
  });

  it('should accept text files', async () => {
    const textBuffer = Buffer.from('This is a text file', 'utf-8');
    const formData = new FormData();
    const blob = new Blob([textBuffer], { type: 'text/plain' });
    formData.append('file', blob, 'test.txt');

    const response = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
      },
      body: formData,
    });

    expect(response.ok).toBe(true);
  });

  it('should require authentication', async () => {
    const testFileBuffer = Buffer.from('test content');

    const formData = new FormData();
    const blob = new Blob([testFileBuffer], { type: 'text/plain' });
    formData.append('file', blob, 'test.txt');

    const response = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      body: formData,
    });

    expect(response.status).toBe(401);
  });

  it('should return 400 when no file is provided', async () => {
    const formData = new FormData();

    const response = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
      },
      body: formData,
    });

    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toBe('No file provided');
  });

  it('should list uploaded files', async () => {
    const response = await fetch(`${baseUrl}/api/files`, {
      headers: {
        Authorization: authHeader,
      },
    });

    expect(response.ok).toBe(true);
    const result = await response.json();

    expect(result).toHaveProperty('files');
    expect(result).toHaveProperty('count');
    expect(Array.isArray(result.images)).toBe(true);
    expect(typeof result.count).toBe('number');

    if (result.files.length > 0) {
      const file = result.files[0];
      expect(file).toHaveProperty('filename');
      expect(file).toHaveProperty('size');
      expect(file).toHaveProperty('createdAt');
      expect(file).toHaveProperty('modifiedAt');
      expect(file).toHaveProperty('url');
      expect(file).toHaveProperty('extension');
    }
  });

  it('should serve uploaded files', async () => {
    // First upload a file
    const testFileContent = 'Test file content for serving';

    const formData = new FormData();
    const blob = new Blob([testFileContent], { type: 'text/plain' });
    formData.append('file', blob, 'serve-test.txt');

    const uploadResponse = await fetch(`${baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
      },
      body: formData,
    });

    const uploadResult = await uploadResponse.json();
    const filename = uploadResult.filename;

    // Now try to serve the file
    const serveResponse = await fetch(`${baseUrl}/api/files/${filename}`);

    expect(serveResponse.ok).toBe(true);
    expect(serveResponse.headers.get('content-type')).toBe('text/plain');

    const fileText = await serveResponse.text();
    expect(fileText).toBe(testFileContent);
  });

  it('should return 404 for non-existent files', async () => {
    const response = await fetch(`${baseUrl}/api/files/non-existent.txt`);
    expect(response.status).toBe(404);
  });

  it('should prevent path traversal attacks', async () => {
    const response = await fetch(`${baseUrl}/api/images/../../../etc/passwd`);
    expect(response.status).toBe(400);

    const result = await response.json();
    expect(result.error).toBe('Invalid filename');
  });
});
