#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const vibetunnel_api_js_1 = require("./vibetunnel-api.js");
const session_management_js_1 = require("./tools/session-management.js");
class VibeTunnelMCPServer {
    constructor() {
        this.server = new index_js_1.Server({
            name: 'vibetunnel-mcp',
            version: '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        // Initialize VibeTunnel API client
        this.api = new vibetunnel_api_js_1.VibeTunnelAPI({
            baseUrl: process.env.VIBETUNNEL_URL || 'http://localhost:4020',
            timeout: parseInt(process.env.VIBETUNNEL_TIMEOUT || '10000')
        });
        // Initialize tool handlers
        this.sessionTools = new session_management_js_1.SessionManagementTools(this.api);
        this.setupHandlers();
    }
    setupHandlers() {
        // List available tools
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
            return {
                tools: [
                    ...this.sessionTools.getTools()
                ]
            };
        });
        // Handle tool execution
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            try {
                switch (name) {
                    case 'vt_list_sessions':
                        return await this.sessionTools.executeListSessions(args || {});
                    case 'vt_create_session':
                        return await this.sessionTools.executeCreateSession(args);
                    case 'vt_send_input':
                        return await this.sessionTools.executeSendInput(args);
                    case 'vt_get_output':
                        return await this.sessionTools.executeGetOutput(args);
                    case 'vt_get_session_status':
                        return await this.sessionTools.executeGetSessionStatus(args);
                    case 'vt_kill_session':
                        return await this.sessionTools.executeKillSession(args);
                    case 'vt_rename_session':
                        return await this.sessionTools.executeRenameSession(args);
                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            }
            catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error executing ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`
                        }
                    ],
                    isError: true
                };
            }
        });
    }
    async run() {
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        console.error('VibeTunnel MCP Server running on stdio');
    }
}
// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.error('Shutting down VibeTunnel MCP Server...');
    process.exit(0);
});
// Start the server
const server = new VibeTunnelMCPServer();
server.run().catch((error) => {
    console.error('Failed to start VibeTunnel MCP Server:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map