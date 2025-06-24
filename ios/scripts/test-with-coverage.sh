#!/bin/bash
set -euo pipefail

# Script to run iOS tests with code coverage using xcodebuild

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Running VibeTunnel iOS Tests with Coverage${NC}"

# Check if we're in the right directory
if [ ! -f "VibeTunnel-iOS.xcodeproj/project.pbxproj" ]; then
    echo -e "${RED}Error: Must run from ios/ directory${NC}"
    exit 1
fi

# Clean build directory
echo -e "${YELLOW}Cleaning build directory...${NC}"
rm -rf build

# Determine the simulator to use
DEVICE_TYPE="iPhone 15"
OS_VERSION="17.5"
SIMULATOR_NAME="${DEVICE_TYPE} (${OS_VERSION})"

# Check if simulator exists, if not use the latest available
if ! xcrun simctl list devices | grep -q "$SIMULATOR_NAME"; then
    echo -e "${YELLOW}Simulator '$SIMULATOR_NAME' not found, using latest available iPhone simulator${NC}"
    SIMULATOR_ID=$(xcrun simctl list devices available | grep "iPhone" | head -1 | awk -F '[()]' '{print $(NF-1)}')
else
    SIMULATOR_ID=$(xcrun simctl list devices | grep "$SIMULATOR_NAME" | head -1 | awk -F '[()]' '{print $(NF-1)}')
fi

echo -e "${GREEN}Using simulator: $SIMULATOR_ID${NC}"

# Build and test with coverage
echo -e "${YELLOW}Building and testing...${NC}"
xcodebuild test \
    -scheme VibeTunnel-iOS \
    -project VibeTunnel-iOS.xcodeproj \
    -destination "platform=iOS Simulator,id=$SIMULATOR_ID" \
    -enableCodeCoverage YES \
    -derivedDataPath build \
    -resultBundlePath build/TestResults.xcresult \
    | xcbeautify

# Check if tests passed
if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo -e "${GREEN}✓ Tests passed!${NC}"
else
    echo -e "${RED}✗ Tests failed!${NC}"
    exit 1
fi

# Extract coverage data
echo -e "${YELLOW}Extracting coverage data...${NC}"
xcrun xccov view --report --json build/TestResults.xcresult > build/coverage.json

# Calculate coverage percentage
COVERAGE=$(cat build/coverage.json | jq -r '.lineCoverage' | awk '{printf "%.1f", $1 * 100}')
echo -e "${GREEN}Line Coverage: ${COVERAGE}%${NC}"

# Generate human-readable coverage report
echo -e "${YELLOW}Generating coverage report...${NC}"
xcrun xccov view --report build/TestResults.xcresult > build/coverage.txt

# Show coverage summary
echo -e "\n${GREEN}Coverage Summary:${NC}"
xcrun xccov view --report build/TestResults.xcresult | head -20

# Optional: Open coverage report in Xcode
echo -e "\n${YELLOW}To view detailed coverage in Xcode, run:${NC}"
echo "open build/TestResults.xcresult"

# Check if coverage meets threshold (75% as per CI)
THRESHOLD=75
if (( $(echo "$COVERAGE < $THRESHOLD" | bc -l) )); then
    echo -e "\n${RED}⚠️  Coverage ${COVERAGE}% is below threshold of ${THRESHOLD}%${NC}"
    exit 1
else
    echo -e "\n${GREEN}✓ Coverage ${COVERAGE}% meets threshold of ${THRESHOLD}%${NC}"
fi