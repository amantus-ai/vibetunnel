#!/bin/bash
set -euo pipefail

# Master script to run tests with coverage for all VibeTunnel projects

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}=== VibeTunnel Test Coverage Report ===${NC}\n"

# Track overall status
ALL_PASSED=true

# Function to run tests for a project
run_project_tests() {
    local project=$1
    local command=$2
    
    echo -e "${BLUE}Testing $project...${NC}"
    
    if eval "$command"; then
        echo -e "${GREEN}✓ $project tests passed${NC}\n"
    else
        echo -e "${RED}✗ $project tests failed${NC}\n"
        ALL_PASSED=false
    fi
}

# Test macOS project
if [ -d "mac" ]; then
    cd mac
    run_project_tests "macOS" "swift test --enable-code-coverage 2>&1 | grep -E 'Test.*passed|failed' | tail -5"
    
    # Extract macOS coverage
    if [ -f ".build/arm64-apple-macosx/debug/codecov/VibeTunnel.json" ]; then
        COVERAGE=$(cat .build/arm64-apple-macosx/debug/codecov/VibeTunnel.json | jq -r '.data[0].totals.lines.percent' 2>/dev/null | awk '{printf "%.1f", $1}')
        echo -e "${BLUE}macOS Line Coverage: ${COVERAGE}%${NC}\n"
    fi
    cd ..
fi

# Test iOS project
if [ -d "ios" ] && [ -f "ios/scripts/quick-test.sh" ]; then
    cd ios
    echo -e "${BLUE}Testing iOS...${NC}"
    if ./scripts/quick-test.sh; then
        echo -e "${GREEN}✓ iOS tests passed${NC}\n"
    else
        echo -e "${RED}✗ iOS tests failed${NC}\n"
        ALL_PASSED=false
    fi
    cd ..
fi

# Test Web project
if [ -d "web" ]; then
    cd web
    echo -e "${BLUE}Testing Web...${NC}"
    
    # Run only unit tests for faster results
    if pnpm vitest run src/test/unit --coverage --reporter=dot 2>&1 | grep -E "Test Files|Tests|Duration" | tail -3; then
        # Extract web coverage
        if [ -f "coverage/coverage-summary.json" ]; then
            COVERAGE=$(cat coverage/coverage-summary.json | jq -r '.total.lines.pct' 2>/dev/null)
            echo -e "${BLUE}Web Line Coverage: ${COVERAGE}%${NC}\n"
        fi
        echo -e "${GREEN}✓ Web unit tests passed${NC}\n"
    else
        echo -e "${RED}✗ Web tests failed${NC}\n"
        ALL_PASSED=false
    fi
    cd ..
fi

# Summary
echo -e "${CYAN}=== Summary ===${NC}"
if [ "$ALL_PASSED" = true ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
else
    echo -e "${RED}✗ Some tests failed${NC}"
    exit 1
fi

# Instructions for detailed reports
echo -e "\n${YELLOW}For detailed coverage reports:${NC}"
echo "- macOS: cd mac && xcrun xccov view --report .build/*/debug/codecov/VibeTunnel.json"
echo "- iOS: cd ios && ./scripts/test-with-coverage.sh"
echo "- Web: cd web && ./scripts/coverage-report.sh"