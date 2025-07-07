import axios, { AxiosInstance } from 'axios';
import { Session, SessionCreateRequest, SessionInputRequest, VibeTunnelConfig, ToolResult } from './types.js';

export class VibeTunnelAPI {
  private client: AxiosInstance;
  private config: VibeTunnelConfig;

  constructor(config: VibeTunnelConfig = { baseUrl: 'http://localhost:4020', timeout: 10000 }) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async listSessions(): Promise<ToolResult> {
    try {
      const response = await this.client.get('/api/sessions');
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list sessions: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async createSession(request: SessionCreateRequest): Promise<ToolResult> {
    try {
      const response = await this.client.post('/api/sessions', request);
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create session: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async getSession(sessionId: string): Promise<ToolResult> {
    try {
      const response = await this.client.get(`/api/sessions/${sessionId}`);
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get session: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async sendInput(sessionId: string, input: SessionInputRequest): Promise<ToolResult> {
    try {
      const response = await this.client.post(`/api/sessions/${sessionId}/input`, input);
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to send input: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async getOutput(sessionId: string, lines?: number): Promise<ToolResult> {
    try {
      const url = `/api/sessions/${sessionId}/text${lines ? `?lines=${lines}` : ''}`;
      const response = await this.client.get(url);
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get output: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async killSession(sessionId: string): Promise<ToolResult> {
    try {
      const response = await this.client.delete(`/api/sessions/${sessionId}`);
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to kill session: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async renameSession(sessionId: string, newName: string): Promise<ToolResult> {
    try {
      const response = await this.client.patch(`/api/sessions/${sessionId}`, { name: newName });
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to rename session: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  // Helper method to find session by name
  async findSessionByName(name: string): Promise<ToolResult> {
    const listResult = await this.listSessions();
    if (!listResult.success) {
      return listResult;
    }

    const sessions = listResult.data as Session[];
    const session = sessions.find(s => s.name === name);
    
    if (!session) {
      return {
        success: false,
        error: `Session with name "${name}" not found`
      };
    }

    return {
      success: true,
      data: session
    };
  }
}