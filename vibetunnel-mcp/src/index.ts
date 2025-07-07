#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { VibeTunnelAPI } from './vibetunnel-api.js';
import { SessionManagementTools } from './tools/session-management.js';

class VibeTunnelMCPServer {
  private server: Server;
  private api: VibeTunnelAPI;
  private sessionTools: SessionManagementTools;

  constructor() {
    this.server = new Server(
      {
        name: 'vibetunnel-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize VibeTunnel API client
    this.api = new VibeTunnelAPI({
      baseUrl: process.env.VIBETUNNEL_URL || 'http://localhost:4020',
      timeout: parseInt(process.env.VIBETUNNEL_TIMEOUT || '10000')
    });

    // Initialize tool handlers
    this.sessionTools = new SessionManagementTools(this.api);

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          ...this.sessionTools.getTools()
        ]
      };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'vt_list_sessions':
            return await this.sessionTools.executeListSessions(args || {});
          
          case 'vt_create_session':
            return await this.sessionTools.executeCreateSession(args as any);
          
          case 'vt_send_input':
            return await this.sessionTools.executeSendInput(args as any);
          
          case 'vt_get_output':
            return await this.sessionTools.executeGetOutput(args as any);
          
          case 'vt_get_session_status':
            return await this.sessionTools.executeGetSessionStatus(args as any);
          
          case 'vt_kill_session':
            return await this.sessionTools.executeKillSession(args as any);
          
          case 'vt_rename_session':
            return await this.sessionTools.executeRenameSession(args as any);
          
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
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
    const transport = new StdioServerTransport();
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