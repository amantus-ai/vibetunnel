/**
 * Integration tests for image upload functionality
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBasicAuthHeader } from '../utils/server-utils.js';

describe('Image Upload API', () => {
  const baseUrl = 'http://localhost:4020';
  const authHeader = createBasicAuthHeader('testuser', 'testpass');

  beforeAll(async () => {
    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  it('should upload an image successfully', async () => {
    // Create a simple test image buffer (1x1 PNG)
    const testImageBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
      0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x5c, 0xc2, 0x88, 0x05, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    const formData = new FormData();
    const blob = new Blob([testImageBuffer], { type: 'image/png' });
    formData.append('image', blob, 'test.png');

    const response = await fetch(`${baseUrl}/api/images/upload`, {
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
      filename: expect.stringMatching(/^[a-f0-9-]+\.png$/),
      originalName: 'test.png',
      size: testImageBuffer.length,
      mimetype: 'image/png',
      path: expect.stringContaining('uploads'),
      relativePath: expect.stringContaining('uploads'),
    });
  });

  it('should reject non-image files', async () => {
    const textBuffer = Buffer.from('This is not an image', 'utf-8');
    const formData = new FormData();
    const blob = new Blob([textBuffer], { type: 'text/plain' });
    formData.append('image', blob, 'test.txt');

    const response = await fetch(`${baseUrl}/api/images/upload`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
      },
      body: formData,
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
  });

  it('should require authentication', async () => {
    const testImageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const formData = new FormData();
    const blob = new Blob([testImageBuffer], { type: 'image/png' });
    formData.append('image', blob, 'test.png');

    const response = await fetch(`${baseUrl}/api/images/upload`, {
      method: 'POST',
      body: formData,
    });

    expect(response.status).toBe(401);
  });

  it('should return 400 when no file is provided', async () => {
    const formData = new FormData();

    const response = await fetch(`${baseUrl}/api/images/upload`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
      },
      body: formData,
    });

    expect(response.status).toBe(400);
    const result = await response.json();
    expect(result.error).toBe('No image file provided');
  });

  it('should list uploaded images', async () => {
    const response = await fetch(`${baseUrl}/api/images`, {
      headers: {
        Authorization: authHeader,
      },
    });

    expect(response.ok).toBe(true);
    const result = await response.json();

    expect(result).toHaveProperty('images');
    expect(result).toHaveProperty('count');
    expect(Array.isArray(result.images)).toBe(true);
    expect(typeof result.count).toBe('number');

    if (result.images.length > 0) {
      const image = result.images[0];
      expect(image).toHaveProperty('filename');
      expect(image).toHaveProperty('size');
      expect(image).toHaveProperty('createdAt');
      expect(image).toHaveProperty('modifiedAt');
      expect(image).toHaveProperty('url');
    }
  });

  it('should serve uploaded images', async () => {
    // First upload an image
    const testImageBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
      0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x5c, 0xc2, 0x88, 0x05, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    const formData = new FormData();
    const blob = new Blob([testImageBuffer], { type: 'image/png' });
    formData.append('image', blob, 'serve-test.png');

    const uploadResponse = await fetch(`${baseUrl}/api/images/upload`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
      },
      body: formData,
    });

    const uploadResult = await uploadResponse.json();
    const filename = uploadResult.filename;

    // Now try to serve the image
    const serveResponse = await fetch(`${baseUrl}/api/images/${filename}`);

    expect(serveResponse.ok).toBe(true);
    expect(serveResponse.headers.get('content-type')).toBe('image/png');

    const imageBuffer = await serveResponse.arrayBuffer();
    expect(imageBuffer.byteLength).toBe(testImageBuffer.length);
  });

  it('should return 404 for non-existent images', async () => {
    const response = await fetch(`${baseUrl}/api/images/non-existent.png`);
    expect(response.status).toBe(404);
  });

  it('should prevent path traversal attacks', async () => {
    const response = await fetch(`${baseUrl}/api/images/../../../etc/passwd`);
    expect(response.status).toBe(400);

    const result = await response.json();
    expect(result.error).toBe('Invalid filename');
  });
});
