export interface Session {
    id: string;
    name: string;
    command: string[];
    workingDir: string;
    status: 'starting' | 'running' | 'exited';
    exitCode?: number;
    startedAt: string;
    pid?: number;
    initialCols?: number;
    initialRows?: number;
    lastModified: string;
    active?: boolean;
    activityStatus?: {
        isActive: boolean;
        specificStatus?: {
            app: string;
            status: string;
        };
    };
}
export interface SessionCreateRequest {
    name?: string;
    command: string[];
    workingDir?: string;
    initialCols?: number;
    initialRows?: number;
}
export interface SessionInputRequest {
    text?: string;
    key?: string;
}
export interface VibeTunnelConfig {
    baseUrl: string;
    timeout: number;
}
export interface ToolResult {
    success: boolean;
    data?: any;
    error?: string;
}
//# sourceMappingURL=types.d.ts.map