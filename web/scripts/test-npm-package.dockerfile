# Test VibeTunnel npm package installation and functionality
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-slim

# Install dependencies for terminal functionality and building native modules
RUN apt-get update && apt-get install -y \
    curl \
    procps \
    python3 \
    build-essential \
    libpam0g-dev \
    && rm -rf /var/lib/apt/lists/*

# Accept package version as build arg (defaults to latest)
ARG PACKAGE_VERSION=latest

# Install vibetunnel globally as root
RUN npm install -g vibetunnel@${PACKAGE_VERSION}

# Create a test user
RUN useradd -m -s /bin/bash testuser

# Switch to test user
USER testuser
WORKDIR /home/testuser

# Create a comprehensive test script
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
echo "=== VibeTunnel npm Package Test ==="\n\
echo "Node version: $(node --version)"\n\
echo "npm version: $(npm --version)"\n\
echo ""\n\
\n\
echo "=== Installation Check ==="\n\
which vibetunnel && echo "✅ vibetunnel command found" || echo "❌ vibetunnel command not found"\n\
which vt && echo "✅ vt command found" || echo "❌ vt command not found"\n\
echo ""\n\
\n\
echo "=== Version Check ==="\n\
vibetunnel --version || echo "Note: Version check failed"\n\
echo ""\n\
\n\
echo "=== Native Module Check ==="\n\
echo "Checking node-pty installation..."\n\
ls -la /usr/local/lib/node_modules/vibetunnel/node-pty/build/Release/pty.node 2>/dev/null && \\\n\
    echo "✅ node-pty native module found" || echo "❌ node-pty native module not found"\n\
echo ""\n\
echo "Checking authenticate-pam installation..."\n\
if [ -f /usr/local/lib/node_modules/vibetunnel/optional-modules/authenticate-pam/build/Release/authenticate_pam.node ]; then\n\
    echo "✅ authenticate-pam found in optional-modules"\n\
elif [ -f /usr/local/lib/node_modules/vibetunnel/node_modules/authenticate-pam/build/Release/authenticate_pam.node ]; then\n\
    echo "✅ authenticate-pam found in node_modules"\n\
else\n\
    echo "⚠️  authenticate-pam not found (optional dependency)"\n\
fi\n\
echo ""\n\
\n\
echo "=== Server Start Test ==="\n\
echo "Starting VibeTunnel server on port 4021..."\n\
timeout 10 vibetunnel --port 4021 --no-auth &\n\
SERVER_PID=$!\n\
sleep 3\n\
\n\
echo "Testing if server is running..."\n\
if curl -s http://localhost:4021 > /dev/null; then\n\
    echo "✅ Server is responding on port 4021"\n\
    \n\
    # Test API endpoint\n\
    echo ""\n\
    echo "=== API Test ==="\n\
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4021/api/status)\n\
    if [ "$STATUS" = "200" ]; then\n\
        echo "✅ API status endpoint returned 200"\n\
    else\n\
        echo "❌ API status endpoint returned $STATUS"\n\
    fi\n\
else\n\
    echo "❌ Server not responding"\n\
fi\n\
\n\
echo ""\n\
echo "Stopping server..."\n\
kill $SERVER_PID 2>/dev/null || true\n\
wait $SERVER_PID 2>/dev/null || true\n\
\n\
echo ""\n\
echo "=== Test Summary ==="\n\
echo "All tests completed. Check results above for any failures."\n\
' > test.sh && chmod +x test.sh

CMD ["./test.sh"]