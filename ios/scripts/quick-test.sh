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
SIMULATOR_ID=$(
    xcrun simctl list devices available |
        grep -E "iPhone.*\\(" |
        head -1 |
        awk -F '[()]' '{print $2}'
)

if [ -z "$SIMULATOR_ID" ]; then
    echo "❌ No iPhone simulator available"
    exit 1
fi

RESULT_BUNDLE_PATH="build/TestResults.xcresult"
mkdir -p build
rm -rf "$RESULT_BUNDLE_PATH"

# Run tests with minimal output (but preserve xcodebuild exit code)
set +e
xcodebuild test \
    -scheme VibeTunnel-iOS \
    -project VibeTunnel-iOS.xcodeproj \
    -destination "platform=iOS Simulator,id=$SIMULATOR_ID" \
    -enableCodeCoverage YES \
    -quiet \
    -resultBundlePath "$RESULT_BUNDLE_PATH" \
    2>&1 | tee /tmp/vibetunnel-ios-xcodebuild-test.log | grep -E "Test Suite|\\*\\* TEST|failed|error:"
xcodebuild_status=${PIPESTATUS[0]}
set -e

# Check result
if [ "$xcodebuild_status" -eq 0 ]; then
    echo "✅ All tests passed!"
    
    # Quick coverage check
    if [ -d "$RESULT_BUNDLE_PATH" ]; then
        COVERAGE=$(xcrun xccov view --report --json "$RESULT_BUNDLE_PATH" 2>/dev/null | jq -r '.lineCoverage' 2>/dev/null | awk '{printf "%.1f", $1 * 100}' || echo "N/A")
        echo "📊 Coverage: ${COVERAGE}%"
    fi
else
    echo "❌ Tests failed!"
    echo "Last xcodebuild output:"
    tail -n 120 /tmp/vibetunnel-ios-xcodebuild-test.log || true
    exit 1
fi
