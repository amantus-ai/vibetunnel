#!/bin/bash
set -e

# Unset VIBETUNNEL_SEA first to ensure it's not inherited
unset VIBETUNNEL_SEA

# Debug output
echo "Starting test server..."
echo "Current directory: $(pwd)"
echo "Node version: $(node --version)"
echo "VIBETUNNEL_SEA is now: '${VIBETUNNEL_SEA:-unset}'"

# Check if dist/cli.js exists
if [ ! -f dist/cli.js ]; then
    echo "Error: dist/cli.js not found"
    ls -la dist/ || echo "dist directory not found"
    exit 1
fi

# Set environment variables
export NODE_ENV="test"
export VIBETUNNEL_DISABLE_PUSH_NOTIFICATIONS="true"
export SUPPRESS_CLIENT_ERRORS="true"

echo "Starting server on port $1..."
exec node dist/cli.js --no-auth --port "$1"