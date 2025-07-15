#!/bin/bash
set -e

echo "🔍 Simple npm package test..."
echo

# Create simple Dockerfile
cat > Dockerfile.simple-test << 'EOF'
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    make \
    g++ \
    libpam0g-dev \
    procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /test
COPY vibetunnel-*.tgz .

# Install and check structure
RUN npm install -g vibetunnel-*.tgz && \
    echo "=== Checking installation ===" && \
    ls -la /usr/local/lib/node_modules/vibetunnel/ && \
    echo "=== Checking node-pty ===" && \
    ls -la /usr/local/lib/node_modules/vibetunnel/node-pty/ && \
    echo "=== Checking for .node files ===" && \
    find /usr/local/lib/node_modules/vibetunnel -name "*.node" -type f && \
    echo "=== Checking dist directory ===" && \
    ls -la /usr/local/lib/node_modules/vibetunnel/dist/

# Try to start server
CMD vibetunnel --port 4020 --no-auth || (echo "Failed with error code $?"; exit 1)
EOF

# Build and run
docker build -t vibetunnel-simple-test -f Dockerfile.simple-test . && \
docker run --rm vibetunnel-simple-test

rm -f Dockerfile.simple-test