#!/bin/bash

# Script to run Playwright tests with parallel configuration

echo "Running Playwright tests with parallel configuration..."
echo ""

# Run all tests (parallel and serial)
if [ "$1" == "all" ]; then
    echo "Running all tests (parallel + serial)..."
    pnpm exec playwright test
elif [ "$1" == "parallel" ]; then
    echo "Running only parallel tests..."
    pnpm exec playwright test --project=chromium-parallel
elif [ "$1" == "serial" ]; then
    echo "Running only serial tests..."
    pnpm exec playwright test --project=chromium-serial
elif [ "$1" == "debug" ]; then
    echo "Running tests in debug mode..."
    pnpm exec playwright test --debug
elif [ "$1" == "ui" ]; then
    echo "Running tests with UI mode..."
    pnpm exec playwright test --ui
else
    echo "Usage: ./scripts/test-parallel.sh [all|parallel|serial|debug|ui]"
    echo ""
    echo "Options:"
    echo "  all      - Run all tests (parallel and serial)"
    echo "  parallel - Run only parallel tests"
    echo "  serial   - Run only serial tests"
    echo "  debug    - Run tests in debug mode"
    echo "  ui       - Run tests with Playwright UI"
    echo ""
    echo "If no option is provided, this help message is shown."
fi