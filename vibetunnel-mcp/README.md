# VibeTunnel MCP Server

Model Context Protocol (MCP) server that provides Claude Code with tools to manage VibeTunnel terminal sessions.

## Features

- **Session Management**: Create, list, kill, and rename terminal sessions
- **Input/Output Control**: Send commands and retrieve output from sessions
- **Status Monitoring**: Get detailed session status and activity information
- **Name Resolution**: Reference sessions by either name or ID

## Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Install globally for Claude Code
npm install -g .
```

## Usage with Claude Code

Add the MCP server to Claude Code:

```bash
claude mcp add vibetunnel -- vibetunnel-mcp
```

## Available Tools

### Session Management
- `vt_list_sessions` - List all terminal sessions
- `vt_create_session` - Create a new named session
- `vt_kill_session` - Terminate a session
- `vt_rename_session` - Rename a session

### Session Interaction
- `vt_send_input` - Send text input to a session
- `vt_get_output` - Get current terminal output
- `vt_get_session_status` - Get detailed session status

## Examples

```
# List all running sessions
"List my current sessions"

# Create a new development session
"Create a session named Mario running npm run dev"

# Send commands to sessions
"Tell Mario to restart the server"

# Get session output
"Show me what Claudia is doing"

# Manage sessions
"Kill all idle sessions"
```

## Configuration

Environment variables:
- `VIBETUNNEL_URL` - VibeTunnel server URL (default: http://localhost:4020)
- `VIBETUNNEL_TIMEOUT` - Request timeout in ms (default: 10000)

## Development

```bash
# Watch mode for development
npm run dev

# Test the server
npm start
```