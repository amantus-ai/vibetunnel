#!/bin/bash
set -euo pipefail

# Quick test script for iOS - runs tests without full xcodebuild output

echo "🧪 Running iOS tests..."

# Check if we're in the right directory
if [ ! -f "VibeTunnel-iOS.xcodeproj/project.pbxproj" ]; then
    echo "❌ Error: Must run from ios/ directory"
    exit 1
fi

# Find an available simulator
SIMULATOR_ID=$(xcrun simctl list devices available | grep "iPhone" | head -1 | awk -F '[()]' '{print $(NF-1)}')

if [ -z "$SIMULATOR_ID" ]; then
    echo "❌ No iPhone simulator available"
    exit 1
fi

# Run tests with minimal output
xcodebuild test \
    -scheme VibeTunnel-iOS \
    -project VibeTunnel-iOS.xcodeproj \
    -destination "platform=iOS Simulator,id=$SIMULATOR_ID" \
    -enableCodeCoverage YES \
    -quiet \
    2>&1 | grep -E "Test Suite|passed|failed|error:" || true

# Check result
if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo "✅ All tests passed!"
    
    # Quick coverage check
    if [ -d "build/TestResults.xcresult" ]; then
        COVERAGE=$(xcrun xccov view --report --json build/TestResults.xcresult 2>/dev/null | jq -r '.lineCoverage' 2>/dev/null | awk '{printf "%.1f", $1 * 100}' || echo "N/A")
        echo "📊 Coverage: ${COVERAGE}%"
    fi
else
    echo "❌ Tests failed!"
    exit 1
fi