#!/bin/bash

# Build script for cross-platform Tauri builds

set -e

echo "🚀 Building VibeTunnel for all platforms..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Build for macOS (native)
echo -e "${BLUE}Building for macOS...${NC}"
cargo tauri build
echo -e "${GREEN}✅ macOS build complete${NC}"

# Build for Linux using Docker
echo -e "${BLUE}Building for Linux...${NC}"
if command -v docker &> /dev/null; then
    docker build -f Dockerfile.linux -t vibetunnel-linux-builder ..
    docker run --rm -v "$(pwd)/..:/app" vibetunnel-linux-builder
    echo -e "${GREEN}✅ Linux build complete${NC}"
else
    echo -e "${RED}❌ Docker not found. Skipping Linux build.${NC}"
fi

# Build for Windows using Docker
echo -e "${BLUE}Building for Windows...${NC}"
if command -v docker &> /dev/null; then
    docker build -f Dockerfile.windows -t vibetunnel-windows-builder ..
    docker run --rm -v "$(pwd)/..:/app" vibetunnel-windows-builder
    echo -e "${GREEN}✅ Windows build complete${NC}"
else
    echo -e "${RED}❌ Docker not found. Skipping Windows build.${NC}"
fi

echo -e "${GREEN}🎉 All builds complete!${NC}"
echo "Build artifacts can be found in:"
echo "  - macOS: src-tauri/target/release/bundle/"
echo "  - Linux: src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/"
echo "  - Windows: src-tauri/target/x86_64-pc-windows-gnu/release/bundle/"