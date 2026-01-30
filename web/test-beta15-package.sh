#!/bin/bash
set -e

echo "Testing VibeTunnel npm package beta 15"
echo "======================================"

# Change to web directory
cd "$(dirname "$0")"

# Build the Docker image
echo "Building Docker image..."
docker build -f Dockerfile.test-beta15 -t vibetunnel-beta15-test .

# Run the test
echo -e "\nRunning beta 15 package test..."
docker run --rm vibetunnel-beta15-test

echo -e "\nBeta 15 package test complete!"