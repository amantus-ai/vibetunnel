#!/bin/bash
# Build web + mac app and launch it

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Building Web App ==="
cd "$PROJECT_DIR/web"
pnpm run build

echo ""
echo "=== Building Mac App ==="
cd "$PROJECT_DIR/mac"
USE_CUSTOM_DERIVED_DATA=true ./scripts/build.sh

echo ""
echo "=== Launching VibeTunnel ==="
open "$PROJECT_DIR/mac/build/Build/Products/Release/VibeTunnel.app"
