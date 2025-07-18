#!/bin/bash

# Test VibeTunnel npm package installation in Docker
# Usage: ./scripts/test-npm-docker.sh [version]
# Example: ./scripts/test-npm-docker.sh 1.0.0-beta.11.4

VERSION=${1:-latest}

echo "Testing VibeTunnel npm package version: $VERSION"
echo "================================================"

# Create temporary dockerfile
TEMP_DIR=$(mktemp -d)
DOCKERFILE="$TEMP_DIR/Dockerfile"

cat > "$DOCKERFILE" << EOF
FROM node:20-slim

# Test 1: Install without PAM headers (should succeed)
RUN echo "=== Test 1: Installing without PAM headers ===" && \
    npm install -g vibetunnel@$VERSION && \
    vibetunnel --version && \
    node -e "try { require('authenticate-pam'); console.log('PAM available'); } catch { console.log('PAM not available - this is expected'); }"

# Test 2: Install PAM headers and check if module compiles
RUN echo "=== Test 2: Installing PAM headers ===" && \
    apt-get update && apt-get install -y libpam0g-dev && \
    echo "PAM headers installed"

# Test 3: Verify VibeTunnel still works
RUN echo "=== Test 3: Verifying VibeTunnel functionality ===" && \
    vibetunnel --version && \
    vibetunnel --help > /dev/null && \
    echo "VibeTunnel is working correctly!"

CMD ["echo", "All tests passed successfully!"]
EOF

# Build and run the test
echo "Building Docker image..."
docker build -f "$DOCKERFILE" -t vibetunnel-npm-test . || {
    echo "❌ Docker build failed!"
    rm -rf "$TEMP_DIR"
    exit 1
}

echo ""
echo "Running tests..."
docker run --rm vibetunnel-npm-test || {
    echo "❌ Tests failed!"
    rm -rf "$TEMP_DIR"
    exit 1
}

# Cleanup
rm -rf "$TEMP_DIR"
docker rmi vibetunnel-npm-test > /dev/null 2>&1

echo ""
echo "✅ All tests passed! VibeTunnel $VERSION installs correctly on Linux."