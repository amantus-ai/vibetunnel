"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManagementTools = void 0;
class SessionManagementTools {
    constructor(api) {
        this.api = api;
    }
    getTools() {
        return [
            {
                name: 'vt_list_sessions',
                description: 'List all VibeTunnel terminal sessions with their status and metadata',
                inputSchema: {
                    type: 'object',
                    properties: {
                        includeExited: {
                            type: 'boolean',
                            description: 'Include sessions that have exited (default: false)'
                        }
                    },
                    additionalProperties: false
                }
            },
            {
                name: 'vt_create_session',
                description: 'Create a new named terminal session in VibeTunnel',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Human-readable name for the session (e.g., "Mario", "DevServer")'
                        },
                        command: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Command to execute as an array (e.g., ["npm", "run", "dev"])'
                        },
                        workingDir: {
                            type: 'string',
                            description: 'Working directory for the session (default: current directory)'
                        }
                    },
                    required: ['command'],
                    additionalProperties: false
                }
            },
            {
                name: 'vt_send_input',
                description: 'Send text input to a specific VibeTunnel session',
                inputSchema: {
                    type: 'object',
                    properties: {
                        session: {
                            type: 'string',
                            description: 'Session name or ID to send input to'
                        },
                        text: {
                            type: 'string',
                            description: 'Text to send to the session'
                        },
                        addNewline: {
                            type: 'boolean',
                            description: 'Add newline after text (default: true)',
                            default: true
                        }
                    },
                    required: ['session', 'text'],
                    additionalProperties: false
                }
            },
            {
                name: 'vt_get_output',
                description: 'Get the current terminal output from a VibeTunnel session',
                inputSchema: {
                    type: 'object',
                    properties: {
                        session: {
                            type: 'string',
                            description: 'Session name or ID to get output from'
                        },
                        lines: {
                            type: 'number',
                            description: 'Number of lines to retrieve (default: all available)'
                        }
                    },
                    required: ['session'],
                    additionalProperties: false
                }
            },
            {
                name: 'vt_get_session_status',
                description: 'Get detailed status information for a specific session',
                inputSchema: {
                    type: 'object',
                    properties: {
                        session: {
                            type: 'string',
                            description: 'Session name or ID to get status for'
                        }
                    },
                    required: ['session'],
                    additionalProperties: false
                }
            },
            {
                name: 'vt_kill_session',
                description: 'Terminate a running VibeTunnel session',
                inputSchema: {
                    type: 'object',
                    properties: {
                        session: {
                            type: 'string',
                            description: 'Session name or ID to terminate'
                        }
                    },
                    required: ['session'],
                    additionalProperties: false
                }
            },
            {
                name: 'vt_rename_session',
                description: 'Rename a VibeTunnel session',
                inputSchema: {
                    type: 'object',
                    properties: {
                        session: {
                            type: 'string',
                            description: 'Current session name or ID'
                        },
                        newName: {
                            type: 'string',
                            description: 'New name for the session'
                        }
                    },
                    required: ['session', 'newName'],
                    additionalProperties: false
                }
            }
        ];
    }
    async executeListSessions(args) {
        const result = await this.api.listSessions();
        if (!result.success) {
            throw new Error(result.error);
        }
        let sessions = result.data;
        if (!args.includeExited) {
            sessions = sessions.filter(s => s.status !== 'exited');
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(sessions.map(s => ({
                        id: s.id,
                        name: s.name,
                        command: s.command.join(' '),
                        status: s.status,
                        workingDir: s.workingDir,
                        startedAt: s.startedAt,
                        pid: s.pid,
                        active: s.active
                    })), null, 2)
                }
            ]
        };
    }
    async executeCreateSession(args) {
        const result = await this.api.createSession({
            name: args.name,
            command: args.command,
            workingDir: args.workingDir
        });
        if (!result.success) {
            throw new Error(result.error);
        }
        const session = result.data;
        return {
            content: [
                {
                    type: 'text',
                    text: `Created session "${session.name}" (ID: ${session.id}) running: ${session.command.join(' ')}`
                }
            ]
        };
    }
    async executeSendInput(args) {
        const sessionResult = await this.resolveSession(args.session);
        if (!sessionResult.success) {
            throw new Error(sessionResult.error);
        }
        const session = sessionResult.data;
        const input = {
            text: args.addNewline !== false ? args.text + '\n' : args.text
        };
        const result = await this.api.sendInput(session.id, input);
        if (!result.success) {
            throw new Error(result.error);
        }
        return {
            content: [
                {
                    type: 'text',
                    text: `Sent input to session "${session.name}": ${args.text}`
                }
            ]
        };
    }
    async executeGetOutput(args) {
        const sessionResult = await this.resolveSession(args.session);
        if (!sessionResult.success) {
            throw new Error(sessionResult.error);
        }
        const session = sessionResult.data;
        const result = await this.api.getOutput(session.id, args.lines);
        if (!result.success) {
            throw new Error(result.error);
        }
        return {
            content: [
                {
                    type: 'text',
                    text: `Output from session "${session.name}":\n${result.data}`
                }
            ]
        };
    }
    async executeGetSessionStatus(args) {
        const sessionResult = await this.resolveSession(args.session);
        if (!sessionResult.success) {
            throw new Error(sessionResult.error);
        }
        const session = sessionResult.data;
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        id: session.id,
                        name: session.name,
                        command: session.command.join(' '),
                        status: session.status,
                        workingDir: session.workingDir,
                        startedAt: session.startedAt,
                        pid: session.pid,
                        exitCode: session.exitCode,
                        active: session.active,
                        activityStatus: session.activityStatus
                    }, null, 2)
                }
            ]
        };
    }
    async executeKillSession(args) {
        const sessionResult = await this.resolveSession(args.session);
        if (!sessionResult.success) {
            throw new Error(sessionResult.error);
        }
        const session = sessionResult.data;
        const result = await this.api.killSession(session.id);
        if (!result.success) {
            throw new Error(result.error);
        }
        return {
            content: [
                {
                    type: 'text',
                    text: `Terminated session "${session.name}" (ID: ${session.id})`
                }
            ]
        };
    }
    async executeRenameSession(args) {
        const sessionResult = await this.resolveSession(args.session);
        if (!sessionResult.success) {
            throw new Error(sessionResult.error);
        }
        const session = sessionResult.data;
        const result = await this.api.renameSession(session.id, args.newName);
        if (!result.success) {
            throw new Error(result.error);
        }
        return {
            content: [
                {
                    type: 'text',
                    text: `Renamed session "${session.name}" to "${args.newName}"`
                }
            ]
        };
    }
    // Helper method to resolve session by name or ID
    async resolveSession(sessionIdentifier) {
        // Try to find by name first
        const byNameResult = await this.api.findSessionByName(sessionIdentifier);
        if (byNameResult.success) {
            return byNameResult;
        }
        // Try to get by ID
        const byIdResult = await this.api.getSession(sessionIdentifier);
        if (byIdResult.success) {
            return byIdResult;
        }
        return {
            success: false,
            error: `Session "${sessionIdentifier}" not found (tried both name and ID)`
        };
    }
}
exports.SessionManagementTools = SessionManagementTools;
//# sourceMappingURL=session-management.js.map