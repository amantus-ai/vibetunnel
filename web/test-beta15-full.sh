#!/bin/bash
set -e

echo "Full test of VibeTunnel npm package beta 15"
echo "==========================================="

# Change to web directory
cd "$(dirname "$0")"

# Build the Docker image
echo "Building Docker image..."
docker build -f Dockerfile.test-beta15-full -t vibetunnel-beta15-full-test .

# Run the test
echo -e "\nRunning full beta 15 package test..."
docker run --rm -p 4021:4021 vibetunnel-beta15-full-test

echo -e "\nFull beta 15 package test complete!"