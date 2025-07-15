#!/bin/bash
set -e

echo "Testing Docker build for Linux x64..."

# Create the build script
cat > docker-build-test.sh << 'EOF'
#!/bin/bash
set -e

echo "Installing build dependencies..."
apt-get update && apt-get install -y python3 make g++ git

echo "Setting up project..."
cd /workspace

# Fix npm permissions issue in Docker
mkdir -p ~/.npm
chown -R $(id -u):$(id -g) ~/.npm

# Install pnpm using corepack (more reliable)
corepack enable
corepack prepare pnpm@latest --activate

# Install dependencies
cd /workspace
pnpm install --ignore-scripts --no-frozen-lockfile

# Go to node-pty directory
cd node-pty

# Install prebuild locally in node-pty
pnpm add -D prebuild

# Build for Node.js 20
echo "Building for Node.js 20..."
./node_modules/.bin/prebuild --runtime node --target 20.0.0

# List results
echo "Build complete. Prebuilds:"
ls -la prebuilds/
EOF

chmod +x docker-build-test.sh

# Run the test
docker run --rm \
  -v "$(pwd)":/workspace \
  -w /workspace \
  --platform linux/amd64 \
  node:22-bookworm \
  /workspace/docker-build-test.sh

# Clean up
rm docker-build-test.sh