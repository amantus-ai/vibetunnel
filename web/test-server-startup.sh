#!/bin/bash
set -e

echo "🚀 Testing VibeTunnel server startup..."
echo

# Create test Dockerfile
cat > Dockerfile.server-test << 'EOF'
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

# Create startup script that tests the server
RUN echo '#!/bin/bash' > /test/start-server.sh && \
    echo 'echo "Starting VibeTunnel server on port 4020..."' >> /test/start-server.sh && \
    echo 'vibetunnel --port 4020 --no-auth &' >> /test/start-server.sh && \
    echo 'SERVER_PID=$!' >> /test/start-server.sh && \
    echo '' >> /test/start-server.sh && \
    echo '# Wait for server to start' >> /test/start-server.sh && \
    echo 'echo "Waiting for server to start..."' >> /test/start-server.sh && \
    echo 'sleep 5' >> /test/start-server.sh && \
    echo '' >> /test/start-server.sh && \
    echo '# Check if process is running' >> /test/start-server.sh && \
    echo 'if ps -p $SERVER_PID > /dev/null; then' >> /test/start-server.sh && \
    echo '  echo "✅ Server process is running (PID: $SERVER_PID)"' >> /test/start-server.sh && \
    echo 'else' >> /test/start-server.sh && \
    echo '  echo "❌ Server process died"' >> /test/start-server.sh && \
    echo '  exit 1' >> /test/start-server.sh && \
    echo 'fi' >> /test/start-server.sh && \
    echo '' >> /test/start-server.sh && \
    echo '# Test HTTP endpoint' >> /test/start-server.sh && \
    echo 'echo "Testing HTTP endpoint..."' >> /test/start-server.sh && \
    echo 'if curl -s -f http://localhost:4020 > /dev/null; then' >> /test/start-server.sh && \
    echo '  echo "✅ HTTP server is responding"' >> /test/start-server.sh && \
    echo 'else' >> /test/start-server.sh && \
    echo '  echo "❌ HTTP server not responding"' >> /test/start-server.sh && \
    echo '  kill $SERVER_PID 2>/dev/null' >> /test/start-server.sh && \
    echo '  exit 1' >> /test/start-server.sh && \
    echo 'fi' >> /test/start-server.sh && \
    echo '' >> /test/start-server.sh && \
    echo '# Test API endpoint' >> /test/start-server.sh && \
    echo 'echo "Testing API endpoint..."' >> /test/start-server.sh && \
    echo 'RESPONSE=$(curl -s http://localhost:4020/api/sessions)' >> /test/start-server.sh && \
    echo 'if echo "$RESPONSE" | grep -q "sessions"; then' >> /test/start-server.sh && \
    echo '  echo "✅ API is responding correctly"' >> /test/start-server.sh && \
    echo '  echo "API Response: $RESPONSE"' >> /test/start-server.sh && \
    echo 'else' >> /test/start-server.sh && \
    echo '  echo "❌ API not responding correctly"' >> /test/start-server.sh && \
    echo '  echo "Response: $RESPONSE"' >> /test/start-server.sh && \
    echo '  kill $SERVER_PID 2>/dev/null' >> /test/start-server.sh && \
    echo '  exit 1' >> /test/start-server.sh && \
    echo 'fi' >> /test/start-server.sh && \
    echo '' >> /test/start-server.sh && \
    echo '# Show server info' >> /test/start-server.sh && \
    echo 'echo ""' >> /test/start-server.sh && \
    echo 'echo "📊 Server info:"' >> /test/start-server.sh && \
    echo 'vibetunnel --version || echo "Version command not available"' >> /test/start-server.sh && \
    echo '' >> /test/start-server.sh && \
    echo '# Success - kill server' >> /test/start-server.sh && \
    echo 'echo ""' >> /test/start-server.sh && \
    echo 'echo "✅ All tests passed! Stopping server..."' >> /test/start-server.sh && \
    echo 'kill $SERVER_PID' >> /test/start-server.sh && \
    echo 'wait $SERVER_PID 2>/dev/null' >> /test/start-server.sh && \
    echo 'echo "✅ Server stopped cleanly"' >> /test/start-server.sh && \
    chmod +x /test/start-server.sh

CMD ["/test/start-server.sh"]
EOF

# Build and run
echo "📦 Building Docker image..."
docker build -t vibetunnel-server-test -f Dockerfile.server-test .

echo
echo "🧪 Running server tests..."
docker run --rm vibetunnel-server-test

# Clean up
echo
echo "🧹 Cleaning up..."
rm -f Dockerfile.server-test

echo
echo "✅ Server test completed!"