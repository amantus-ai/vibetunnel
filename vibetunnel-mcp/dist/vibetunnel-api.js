"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VibeTunnelAPI = void 0;
const axios_1 = __importDefault(require("axios"));
class VibeTunnelAPI {
    constructor(config = { baseUrl: 'http://localhost:4020', timeout: 10000 }) {
        this.config = config;
        this.client = axios_1.default.create({
            baseURL: config.baseUrl,
            timeout: config.timeout,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
    async listSessions() {
        try {
            const response = await this.client.get('/api/sessions');
            return {
                success: true,
                data: response.data
            };
        }
        catch (error) {
            return {
                success: false,
                error: `Failed to list sessions: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
    async createSession(request) {
        try {
            const response = await this.client.post('/api/sessions', request);
            return {
                success: true,
                data: response.data
            };
        }
        catch (error) {
            return {
                success: false,
                error: `Failed to create session: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
    async getSession(sessionId) {
        try {
            const response = await this.client.get(`/api/sessions/${sessionId}`);
            return {
                success: true,
                data: response.data
            };
        }
        catch (error) {
            return {
                success: false,
                error: `Failed to get session: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
    async sendInput(sessionId, input) {
        try {
            const response = await this.client.post(`/api/sessions/${sessionId}/input`, input);
            return {
                success: true,
                data: response.data
            };
        }
        catch (error) {
            return {
                success: false,
                error: `Failed to send input: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
    async getOutput(sessionId, lines) {
        try {
            const url = `/api/sessions/${sessionId}/text${lines ? `?lines=${lines}` : ''}`;
            const response = await this.client.get(url);
            return {
                success: true,
                data: response.data
            };
        }
        catch (error) {
            return {
                success: false,
                error: `Failed to get output: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
    async killSession(sessionId) {
        try {
            const response = await this.client.delete(`/api/sessions/${sessionId}`);
            return {
                success: true,
                data: response.data
            };
        }
        catch (error) {
            return {
                success: false,
                error: `Failed to kill session: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
    async renameSession(sessionId, newName) {
        try {
            const response = await this.client.patch(`/api/sessions/${sessionId}`, { name: newName });
            return {
                success: true,
                data: response.data
            };
        }
        catch (error) {
            return {
                success: false,
                error: `Failed to rename session: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
    // Helper method to find session by name
    async findSessionByName(name) {
        const listResult = await this.listSessions();
        if (!listResult.success) {
            return listResult;
        }
        const sessions = listResult.data;
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
exports.VibeTunnelAPI = VibeTunnelAPI;
//# sourceMappingURL=vibetunnel-api.js.map