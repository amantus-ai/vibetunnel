#!/bin/bash

# Test npm package installation in Docker

echo "Building Docker test image..."
docker build -f Dockerfile.npm-test -t vibetunnel-npm-test .

echo ""
echo "Running installation test..."
docker run --rm vibetunnel-npm-test