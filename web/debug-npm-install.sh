#!/bin/bash
set -e

echo "🔍 Debugging npm package installation..."
echo

# Create debug Dockerfile
cat > Dockerfile.npm-debug << 'EOF'
FROM node:20-slim

# Install dependencies for native modules
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    make \
    g++ \
    libpam0g-dev \
    curl \
    tree \
    procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /test

# Copy the npm package
COPY vibetunnel-*.tgz .

# Extract and examine the package first
RUN tar -tzf vibetunnel-*.tgz | head -20
RUN tar -xzf vibetunnel-*.tgz
RUN echo "Package structure:" && tree -L 3 package/

# Install the package globally with verbose output
RUN npm install -g vibetunnel-*.tgz --verbose

# Check what was installed
RUN echo "Checking installed files..." && \
    ls -la /usr/local/lib/node_modules/vibetunnel/ && \
    echo "Checking node-pty..." && \
    ls -la /usr/local/lib/node_modules/vibetunnel/node-pty/ || echo "node-pty directory not found" && \
    echo "Checking prebuilds..." && \
    ls -la /usr/local/lib/node_modules/vibetunnel/prebuilds/ || echo "prebuilds directory not found" && \
    echo "Checking scripts..." && \
    ls -la /usr/local/lib/node_modules/vibetunnel/scripts/ || echo "scripts directory not found"

# Check if postinstall ran
RUN echo "Checking for native modules..." && \
    find /usr/local/lib/node_modules/vibetunnel -name "*.node" -type f

# Try running vibetunnel
CMD vibetunnel --version || echo "Failed to run vibetunnel"
EOF

# Build and run
echo "📦 Building debug Docker image..."
docker build -t vibetunnel-npm-debug -f Dockerfile.npm-debug .

echo
echo "🚀 Running debug container..."
docker run --rm vibetunnel-npm-debug

echo
echo "🧹 Cleaning up..."
rm -f Dockerfile.npm-debug

echo
echo "✅ Debug completed!"