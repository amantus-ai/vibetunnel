import { SessionCreateRequest, SessionInputRequest, VibeTunnelConfig, ToolResult } from './types.js';
export declare class VibeTunnelAPI {
    private client;
    private config;
    constructor(config?: VibeTunnelConfig);
    listSessions(): Promise<ToolResult>;
    createSession(request: SessionCreateRequest): Promise<ToolResult>;
    getSession(sessionId: string): Promise<ToolResult>;
    sendInput(sessionId: string, input: SessionInputRequest): Promise<ToolResult>;
    getOutput(sessionId: string, lines?: number): Promise<ToolResult>;
    killSession(sessionId: string): Promise<ToolResult>;
    renameSession(sessionId: string, newName: string): Promise<ToolResult>;
    findSessionByName(name: string): Promise<ToolResult>;
}
//# sourceMappingURL=vibetunnel-api.d.ts.map