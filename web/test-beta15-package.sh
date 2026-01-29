#!/bin/bash
set -e

echo "Testing ShellOps npm package beta 15"
echo "======================================"

# Change to web directory
cd "$(dirname "$0")"

# Build the Docker image
echo "Building Docker image..."
docker build -f Dockerfile.test-beta15 -t shellops-beta15-test .

# Run the test
echo -e "\nRunning beta 15 package test..."
docker run --rm shellops-beta15-test

echo -e "\nBeta 15 package test complete!"