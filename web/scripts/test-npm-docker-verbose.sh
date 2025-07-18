#!/bin/bash

# Test VibeTunnel npm package installation with verbose output

VERSION=${1:-latest}

echo "Testing VibeTunnel npm package version: $VERSION"
echo "================================================"

# Create test directory
TMP_DIR=$(mktemp -d)
echo "Test directory: $TMP_DIR"

# Create Dockerfile
cat > "$TMP_DIR/Dockerfile" << 'EOF'
FROM node:20-slim

WORKDIR /app

# Test installation and PAM extraction
RUN echo "=== Installing VibeTunnel ===" && \
    npm install -g vibetunnel@VERSION && \
    echo "=== Installation complete ===" && \
    echo "=== Checking for node_modules/authenticate-pam ===" && \
    ls -la /usr/local/lib/node_modules/vibetunnel/node_modules/ | grep -E "(authenticate|optional)" || echo "No authenticate-pam in node_modules" && \
    echo "=== Checking for optional-modules ===" && \
    ls -la /usr/local/lib/node_modules/vibetunnel/optional-modules/ 2>/dev/null || echo "No optional-modules directory" && \
    echo "=== Checking postinstall output ===" && \
    cd /usr/local/lib/node_modules/vibetunnel && \
    npm run postinstall || echo "Postinstall failed" && \
    echo "=== Final check ===" && \
    find /usr/local/lib/node_modules/vibetunnel -name "authenticate_pam.node" -type f 2>/dev/null || echo "No authenticate_pam.node found"
EOF

# Replace VERSION placeholder
sed -i.bak "s/VERSION/$VERSION/g" "$TMP_DIR/Dockerfile"

# Build and run
echo "Building Docker image..."
docker build -t vibetunnel-npm-test-verbose "$TMP_DIR"

# Cleanup
rm -rf "$TMP_DIR"

echo "✅ Test complete!"