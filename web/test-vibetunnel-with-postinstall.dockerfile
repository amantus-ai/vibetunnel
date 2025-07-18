# Test VibeTunnel npm package with postinstall
FROM node:22

# Install dependencies
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Install vibetunnel globally (with postinstall)
RUN npm install -g vibetunnel@latest

# Test script
RUN echo '#!/bin/bash\n\
echo "Testing VibeTunnel npm package..."\n\
echo "Node version: $(node --version)"\n\
echo ""\n\
echo "Checking installed files..."\n\
ls -la /usr/local/lib/node_modules/vibetunnel/node-pty/build/ 2>/dev/null || echo "No build directory"\n\
ls -la /usr/local/lib/node_modules/vibetunnel/prebuilds/ 2>/dev/null || echo "No prebuilds directory"\n\
echo ""\n\
echo "Testing vibetunnel command..."\n\
vibetunnel --version\n\
echo ""\n\
echo "Starting server test..."\n\
timeout 5 vibetunnel --port 4021 --no-auth || echo "Server test completed"\n\
' > /test.sh && chmod +x /test.sh

CMD ["/test.sh"]