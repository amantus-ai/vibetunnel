#!/bin/bash
set -e

echo "🧪 Testing VibeTunnel npm package installation and server startup..."
echo

# Create Dockerfile
cat > Dockerfile.npm-test << 'EOF'
FROM node:20-slim

# Install dependencies for native modules
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    make \
    g++ \
    libpam0g-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /test

# Copy the npm package
COPY vibetunnel-*.tgz .

# Install the package globally
RUN npm install -g vibetunnel-*.tgz

# Verify installation
RUN which vibetunnel || (echo "vibetunnel not found" && exit 1)
RUN which vt || echo "vt command not installed (expected on Linux)"

# Create a test script
RUN echo '#!/bin/bash' > /test/test-server.sh && \
    echo 'echo "Starting VibeTunnel server..."' >> /test/test-server.sh && \
    echo 'vibetunnel --port 4020 --no-auth &' >> /test/test-server.sh && \
    echo 'SERVER_PID=$!' >> /test/test-server.sh && \
    echo 'echo "Server PID: $SERVER_PID"' >> /test/test-server.sh && \
    echo 'sleep 5' >> /test/test-server.sh && \
    echo 'echo "Checking if server is running..."' >> /test/test-server.sh && \
    echo 'if ps -p $SERVER_PID > /dev/null; then' >> /test/test-server.sh && \
    echo '  echo "✅ Server is running"' >> /test/test-server.sh && \
    echo '  echo "Testing HTTP endpoint..."' >> /test/test-server.sh && \
    echo '  curl -s http://localhost:4020 > /dev/null && echo "✅ HTTP server responding" || echo "❌ HTTP server not responding"' >> /test/test-server.sh && \
    echo '  echo "Testing API endpoint..."' >> /test/test-server.sh && \
    echo '  curl -s http://localhost:4020/api/sessions | grep -q "sessions" && echo "✅ API responding" || echo "❌ API not responding"' >> /test/test-server.sh && \
    echo '  kill $SERVER_PID' >> /test/test-server.sh && \
    echo 'else' >> /test/test-server.sh && \
    echo '  echo "❌ Server failed to start"' >> /test/test-server.sh && \
    echo '  exit 1' >> /test/test-server.sh && \
    echo 'fi' >> /test/test-server.sh && \
    chmod +x /test/test-server.sh

# Run the test
CMD ["/test/test-server.sh"]
EOF

# Build and run
echo "📦 Building Docker image..."
docker build -t vibetunnel-npm-test -f Dockerfile.npm-test .

echo
echo "🚀 Running tests..."
docker run --rm vibetunnel-npm-test

echo
echo "🧹 Cleaning up..."
rm -f Dockerfile.npm-test

echo
echo "✅ Test completed!"