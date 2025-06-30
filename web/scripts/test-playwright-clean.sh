#!/bin/bash

# Clean up existing sessions
echo "Cleaning up existing sessions..."
rm -rf ~/.vibetunnel/control/*

# Run Playwright tests
echo "Running Playwright tests..."
pnpm playwright test "$@"