#!/bin/bash

# Simple port retry script for Express server in development
PORT_START=${EXPRESS_PORT:-4030}
PORT=$PORT_START
MAX_ATTEMPTS=10
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  echo "🚀 Attempting to start Express server on port $PORT"
  
  # Check if port is available
  if ! lsof -i :$PORT > /dev/null 2>&1; then
    echo "✅ Port $PORT is available"
    export PORT=$PORT
    export VIBETUNNEL_SEA=""
    exec npx tsx watch src/cli.ts --no-auth
    exit 0
  else
    echo "❌ Port $PORT is in use, trying $((PORT + 1))"
    PORT=$((PORT + 1))
    ATTEMPT=$((ATTEMPT + 1))
  fi
done

echo "❌ Failed to find free port after $MAX_ATTEMPTS attempts starting from $PORT_START"
exit 1