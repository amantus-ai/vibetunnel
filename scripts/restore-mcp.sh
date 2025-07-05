#!/bin/bash
# Complete MCP restore for vibetunnel project
# This script restores all MCP servers with proper configuration

echo "Restoring all MCP servers..."

# Get OpenAI API key from .zshrc
OPENAI_KEY=$(grep "export OPENAI_API_KEY=" ~/.zshrc | head -1 | cut -d'"' -f2)

if [ -z "$OPENAI_KEY" ]; then
    echo "Warning: OpenAI API key not found in .zshrc"
    echo "Peekaboo MCP will not be able to analyze images without it"
fi

# Core MCP servers
claude mcp add playwright -- npx -y @playwright/mcp@latest

claude mcp add XcodeBuildMCP -- npx -y xcodebuildmcp@latest

claude mcp add RepoPrompt -- /Users/steipete/RepoPrompt/repoprompt_cli

claude mcp add zen-mcp-server -- /Users/steipete/Projects/zen-mcp-server/.zen_venv/bin/python /Users/steipete/Projects/zen-mcp-server/server.py

# Peekaboo with proper environment variables
claude mcp add peekaboo \
    -e PEEKABOO_AI_PROVIDERS="openai/gpt-4o,ollama/llava:latest" \
    -e OPENAI_API_KEY="$OPENAI_KEY" \
    -e PEEKABOO_LOG_LEVEL="info" \
    -e PEEKABOO_DEFAULT_SAVE_PATH="~/Desktop" \
    -- npx -y @steipete/peekaboo-mcp

claude mcp add macos-automator -- npx -y macos-automator-mcp

echo "Done! All MCP servers restored."
echo ""
claude mcp list