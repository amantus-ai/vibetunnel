import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type GitFollowRequest,
  type GitFollowResponse,
  MessageBuilder,
  MessageParser,
  MessageType,
  type StatusResponse,
} from './pty/socket-protocol.js';

describe('API Socket Integration Tests', () => {
  const testSocketPath = path.join(process.env.HOME || '/tmp', '.vibetunnel-test', 'api.sock');
  let server: net.Server;
  
  beforeAll(async () => {
    // Create test socket directory
    const socketDir = path.dirname(testSocketPath);
    if (!fs.existsSync(socketDir)) {
      fs.mkdirSync(socketDir, { recursive: true });
    }
    
    // Clean up any existing socket
    try {
      fs.unlinkSync(testSocketPath);
    } catch (_error) {
      // Ignore
    }
    
    // Create a simple test server
    server = net.createServer((socket) => {
      const parser = new MessageParser();
      
      socket.on('data', (data) => {
        parser.addData(data);
        
        for (const message of parser.parseMessages()) {
          switch (message.type) {
            case MessageType.STATUS_REQUEST:
              const statusResponse: StatusResponse = {
                running: true,
                port: 4020,
                url: 'http://localhost:4020',
                followMode: {
                  enabled: true,
                  branch: 'main',
                  repoPath: '/test/repo',
                },
              };
              socket.write(MessageBuilder.statusResponse(statusResponse));
              break;
              
            case MessageType.GIT_FOLLOW_REQUEST:
              const request = JSON.parse(message.payload.toString()) as GitFollowRequest;
              const followResponse: GitFollowResponse = {
                success: true,
                currentBranch: request.branch,
              };
              socket.write(MessageBuilder.gitFollowResponse(followResponse));
              break;
              
            case MessageType.GIT_EVENT_NOTIFY:
              socket.write(MessageBuilder.gitEventAck({ handled: true }));
              break;
          }
        }
      });
    });
    
    await new Promise<void>((resolve) => {
      server.listen(testSocketPath, resolve);
    });
  });
  
  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    
    // Clean up socket file
    try {
      fs.unlinkSync(testSocketPath);
    } catch (_error) {
      // Ignore
    }
  });
  
  it('should handle status request', async () => {
    const response = await sendMessageAndGetResponse(
      testSocketPath,
      MessageBuilder.statusRequest()
    );
    
    expect(response.type).toBe(MessageType.STATUS_RESPONSE);
    const status = response.payload as StatusResponse;
    expect(status.running).toBe(true);
    expect(status.port).toBe(4020);
    expect(status.url).toBe('http://localhost:4020');
    expect(status.followMode).toEqual({
      enabled: true,
      branch: 'main',
      repoPath: '/test/repo',
    });
  });
  
  it('should handle follow mode request', async () => {
    const request: GitFollowRequest = {
      repoPath: '/test/repo',
      branch: 'feature-branch',
      enable: true,
    };
    
    const response = await sendMessageAndGetResponse(
      testSocketPath,
      MessageBuilder.gitFollowRequest(request)
    );
    
    expect(response.type).toBe(MessageType.GIT_FOLLOW_RESPONSE);
    const followResponse = response.payload as GitFollowResponse;
    expect(followResponse.success).toBe(true);
    expect(followResponse.currentBranch).toBe('feature-branch');
  });
  
  it('should handle git event notification', async () => {
    const response = await sendMessageAndGetResponse(
      testSocketPath,
      MessageBuilder.gitEventNotify({
        repoPath: '/test/repo',
        type: 'checkout',
      })
    );
    
    expect(response.type).toBe(MessageType.GIT_EVENT_ACK);
    const ack = response.payload as { handled: boolean };
    expect(ack.handled).toBe(true);
  });
});

/**
 * Helper function to send a message and get response
 */
async function sendMessageAndGetResponse(
  socketPath: string,
  message: Buffer
): Promise<{ type: MessageType; payload: any }> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    const parser = new MessageParser();
    
    client.on('connect', () => {
      client.write(message);
    });
    
    client.on('data', (data) => {
      parser.addData(data);
      for (const msg of parser.parseMessages()) {
        client.end();
        resolve({
          type: msg.type,
          payload: JSON.parse(msg.payload.toString('utf8')),
        });
      }
    });
    
    client.on('error', reject);
    
    // Timeout after 2 seconds
    setTimeout(() => {
      client.destroy();
      reject(new Error('Response timeout'));
    }, 2000);
  });
}