#!/bin/bash

# GitHub Actions script to verify release builds
# This should be run after building the DMG but before creating the release

set -e

echo "::group::Release Build Verification"

# Find the built app (adjust path as needed for your CI)
APP_PATH="$1"
if [ -z "$APP_PATH" ]; then
    # Try to find it in common locations
    if [ -f "build/VibeTunnel.app" ]; then
        APP_PATH="build/VibeTunnel.app"
    elif [ -f "mac/build/Release/VibeTunnel.app" ]; then
        APP_PATH="mac/build/Release/VibeTunnel.app"
    else
        echo "::error::Could not find VibeTunnel.app. Please provide path as argument."
        exit 1
    fi
fi

# Run the verification script
if ./verify-release-build.sh "$APP_PATH"; then
    echo "::notice::✅ Release build verification passed!"
else
    echo "::error::❌ Release build verification failed! Check the logs above."
    exit 1
fi

echo "::endgroup::"

# Additional CI-specific checks
echo "::group::Additional CI Checks"

# Check that we're not on a debug branch
if [[ "$GITHUB_REF" == *"debug"* ]] || [[ "$GITHUB_REF" == *"test"* ]]; then
    echo "::warning::Building from a branch that contains 'debug' or 'test' in the name"
fi

# Verify build configuration from environment
if [ "$CONFIGURATION" == "Debug" ]; then
    echo "::error::Building with Debug configuration! Use Release for production builds."
    exit 1
fi

echo "::endgroup::"