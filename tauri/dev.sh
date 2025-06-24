#!/bin/bash
set -e

echo "Starting VibeTunnel Tauri App in development mode..."

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

echo "Node.js server built successfully!"

# Change back to tauri directory
cd ../tauri

# Run Tauri in dev mode
echo "Starting Tauri app in development mode..."
cargo tauri dev