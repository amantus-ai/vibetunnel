#!/bin/bash

# Run iOS tests using Xcode
# This properly runs the tests in an iOS environment

set -e

echo "Running iOS tests using Xcode..."

# Run tests for iOS simulator
xcodebuild test \
    -project VibeTunnel-iOS.xcodeproj \
    -scheme VibeTunnel-iOS \
    -destination 'platform=iOS Simulator,name=iPhone 16' \
    -quiet \
    | xcbeautify

echo "Tests completed!"