#!/bin/bash
set -e

echo "Installing build dependencies..."
apt-get update && apt-get install -y python3 make g++ git

echo "Setting up project..."
cd /workspace

# Fix npm permissions issue in Docker
mkdir -p ~/.npm
chown -R $(id -u):$(id -g) ~/.npm

# Install pnpm using corepack (more reliable)
corepack enable
corepack prepare pnpm@latest --activate

# Install dependencies
cd /workspace
pnpm install --ignore-scripts --no-frozen-lockfile

# Go to node-pty directory
cd node-pty

# Install prebuild locally in node-pty
pnpm add -D prebuild

# Build for Node.js 20
echo "Building for Node.js 20..."
./node_modules/.bin/prebuild --runtime node --target 20.0.0

# List results
echo "Build complete. Prebuilds:"
ls -la prebuilds/
