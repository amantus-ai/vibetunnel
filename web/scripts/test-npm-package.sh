#!/bin/bash

# Test VibeTunnel npm package using Docker
# Usage: ./test-npm-package.sh [version] [node_version]
# Examples:
#   ./test-npm-package.sh                  # Test latest with Node.js 22
#   ./test-npm-package.sh beta.12          # Test specific version
#   ./test-npm-package.sh latest 20        # Test with Node.js 20
#   ./test-npm-package.sh beta.12 24       # Test beta.12 with Node.js 24

PACKAGE_VERSION=${1:-latest}
NODE_VERSION=${2:-22}

echo "Testing VibeTunnel npm package"
echo "Package version: $PACKAGE_VERSION"
echo "Node.js version: $NODE_VERSION"
echo "================================================"

# Build Docker image
docker build \
    --build-arg NODE_VERSION=$NODE_VERSION \
    --build-arg PACKAGE_VERSION=$PACKAGE_VERSION \
    -t vibetunnel-npm-test:$PACKAGE_VERSION-node$NODE_VERSION \
    -f "$(dirname "$0")/test-npm-package.dockerfile" \
    "$(dirname "$0")"

# Run the test
docker run --rm vibetunnel-npm-test:$PACKAGE_VERSION-node$NODE_VERSION

# Cleanup
docker rmi vibetunnel-npm-test:$PACKAGE_VERSION-node$NODE_VERSION 2>/dev/null || true

echo ""
echo "✅ Test complete!"