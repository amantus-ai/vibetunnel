#!/bin/bash
set -e

echo "🔍 Debugging VibeTunnel server startup..."
echo

# Create debug Dockerfile
cat > Dockerfile.debug-test << 'EOF'
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    make \
    g++ \
    libpam0g-dev \
    procps \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /test
COPY vibetunnel-*.tgz .

# Install the package
RUN npm install -g vibetunnel-*.tgz

# Debug script
RUN echo '#!/bin/bash' > /test/debug.sh && \
    echo 'echo "=== Environment ==="' >> /test/debug.sh && \
    echo 'echo "Node version: $(node --version)"' >> /test/debug.sh && \
    echo 'echo "NPM version: $(npm --version)"' >> /test/debug.sh && \
    echo 'echo "Current directory: $(pwd)"' >> /test/debug.sh && \
    echo 'echo ""' >> /test/debug.sh && \
    echo 'echo "=== Installation check ==="' >> /test/debug.sh && \
    echo 'which vibetunnel' >> /test/debug.sh && \
    echo 'ls -la /usr/local/lib/node_modules/vibetunnel/' >> /test/debug.sh && \
    echo 'echo ""' >> /test/debug.sh && \
    echo 'echo "=== Node modules check ==="' >> /test/debug.sh && \
    echo 'ls -la /usr/local/lib/node_modules/vibetunnel/node_modules/ | head -20' >> /test/debug.sh && \
    echo 'echo ""' >> /test/debug.sh && \
    echo 'echo "=== Trying to start server ==="' >> /test/debug.sh && \
    echo 'vibetunnel --port 4020 --no-auth 2>&1 || echo "Exit code: $?"' >> /test/debug.sh && \
    chmod +x /test/debug.sh

CMD ["/test/debug.sh"]
EOF

# Build and run
docker build -t vibetunnel-debug-test -f Dockerfile.debug-test . && \
docker run --rm vibetunnel-debug-test

# Clean up
rm -f Dockerfile.debug-test