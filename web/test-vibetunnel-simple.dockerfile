# Test VibeTunnel npm package with prebuilds
FROM node:22

# Create a test user
RUN useradd -m -s /bin/bash testuser

# Install dependencies
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Install vibetunnel globally
RUN npm install -g --ignore-scripts vibetunnel@latest

# Test script
RUN echo '#!/bin/bash\n\
echo "Testing VibeTunnel npm package..."\n\
echo "Node version: $(node --version)"\n\
echo "npm version: $(npm --version)"\n\
echo ""\n\
echo "Testing vibetunnel command..."\n\
which vibetunnel && echo "✅ vibetunnel command found" || echo "❌ vibetunnel command not found"\n\
echo ""\n\
echo "Checking version..."\n\
vibetunnel --version 2>&1 || echo "Note: Version check may fail if native modules are missing"\n\
echo ""\n\
echo "Checking help..."\n\
vibetunnel --help 2>&1 | head -20\n\
' > /test.sh && chmod +x /test.sh

CMD ["/test.sh"]