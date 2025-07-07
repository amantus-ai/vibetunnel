import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { VibeTunnelAPI } from '../vibetunnel-api.js';
export declare class SessionManagementTools {
    private api;
    constructor(api: VibeTunnelAPI);
    getTools(): Tool[];
    executeListSessions(args: {
        includeExited?: boolean;
    }): Promise<{
        content: {
            type: string;
            text: string;
        }[];
    }>;
    executeCreateSession(args: {
        name?: string;
        command: string[];
        workingDir?: string;
    }): Promise<{
        content: {
            type: string;
            text: string;
        }[];
    }>;
    executeSendInput(args: {
        session: string;
        text: string;
        addNewline?: boolean;
    }): Promise<{
        content: {
            type: string;
            text: string;
        }[];
    }>;
    executeGetOutput(args: {
        session: string;
        lines?: number;
    }): Promise<{
        content: {
            type: string;
            text: string;
        }[];
    }>;
    executeGetSessionStatus(args: {
        session: string;
    }): Promise<{
        content: {
            type: string;
            text: string;
        }[];
    }>;
    executeKillSession(args: {
        session: string;
    }): Promise<{
        content: {
            type: string;
            text: string;
        }[];
    }>;
    executeRenameSession(args: {
        session: string;
        newName: string;
    }): Promise<{
        content: {
            type: string;
            text: string;
        }[];
    }>;
    private resolveSession;
}
//# sourceMappingURL=session-management.d.ts.map