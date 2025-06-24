#!/bin/bash

# Run iOS tests using Xcode
# This properly runs the tests in an iOS environment

set -e

echo "Running iOS tests using Xcode..."

# Run tests for iOS simulator
xcodebuild test \
    -project VibeTunnel.xcodeproj \
    -scheme VibeTunnel \
    -destination 'platform=iOS Simulator,name=iPhone 15,OS=18.0' \
    -quiet \
    | xcbeautify

echo "Tests completed!"