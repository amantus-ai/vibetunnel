# Test VibeTunnel npm package on different Node.js versions
FROM node:22-slim

# Install dependencies for terminal functionality and building native modules
RUN apt-get update && apt-get install -y \
    curl \
    procps \
    python3 \
    build-essential \
    libpam0g-dev \
    && rm -rf /var/lib/apt/lists/*

# Install vibetunnel globally as root
RUN npm install -g vibetunnel@latest

# Create a test user
RUN useradd -m -s /bin/bash testuser

# Switch to test user
USER testuser
WORKDIR /home/testuser

# Create a test script
RUN echo '#!/bin/bash\n\
echo "Testing VibeTunnel npm package..."\n\
echo "Node version: $(node --version)"\n\
echo "npm version: $(npm --version)"\n\
echo "VibeTunnel version:"\n\
vibetunnel --version\n\
echo ""\n\
echo "Starting VibeTunnel server..."\n\
vibetunnel --port 4021 --no-auth &\n\
SERVER_PID=$!\n\
sleep 3\n\
echo ""\n\
echo "Testing if server is running..."\n\
curl -s http://localhost:4021 > /dev/null && echo "✅ Server is responding" || echo "❌ Server not responding"\n\
echo ""\n\
echo "Stopping server..."\n\
kill $SERVER_PID\n\
' > test.sh && chmod +x test.sh

CMD ["./test.sh"]