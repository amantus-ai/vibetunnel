#!/bin/bash
set -e

echo "Building VibeTunnel Tauri App..."

# Change to web directory and build the Node.js server
echo "Building Node.js server..."
cd ../web

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing web dependencies..."
    pnpm install
fi

# Build the web project (creates vibetunnel executable)
echo "Building vibetunnel executable..."
pnpm run build

# Check that required files exist
if [ ! -f "native/vibetunnel" ]; then
    echo "Error: vibetunnel executable not found at web/native/vibetunnel"
    exit 1
fi

if [ ! -f "native/pty.node" ]; then
    echo "Error: pty.node not found at web/native/pty.node"
    exit 1
fi

if [ ! -f "native/spawn-helper" ]; then
    echo "Error: spawn-helper not found at web/native/spawn-helper"
    exit 1
fi

echo "Node.js server built successfully!"

# Change back to tauri directory
cd ../tauri

# Build Tauri app
echo "Building Tauri app..."
cargo tauri build

echo "Build complete!"