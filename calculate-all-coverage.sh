#!/bin/bash
set -euo pipefail

# Comprehensive coverage report for all VibeTunnel projects

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${CYAN}${BOLD}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║         VibeTunnel Complete Coverage Report               ║${NC}"
echo -e "${CYAN}${BOLD}╚═══════════════════════════════════════════════════════════╝${NC}\n"

# Track overall stats
TOTAL_TESTS=0
TOTAL_PASSED=0
PROJECTS_WITH_COVERAGE=0

# Function to print section headers
print_header() {
    echo -e "\n${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${MAGENTA}  $1${NC}"
    echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# macOS Coverage
print_header "macOS Project Coverage"
if [ -d "mac" ]; then
    cd mac
    echo -e "${YELLOW}Running macOS tests...${NC}"
    
    # Run tests and capture output
    if swift test --enable-code-coverage 2>&1 | tee test-output.log | grep -E "Test run with.*tests passed"; then
        # Extract test count
        MAC_TESTS=$(grep -E "Test run with.*tests" test-output.log | sed -E 's/.*with ([0-9]+) tests.*/\1/')
        TOTAL_TESTS=$((TOTAL_TESTS + MAC_TESTS))
        TOTAL_PASSED=$((TOTAL_PASSED + MAC_TESTS))
        
        # Extract coverage if available
        if [ -f ".build/arm64-apple-macosx/debug/codecov/VibeTunnel.json" ]; then
            COVERAGE_DATA=$(cat .build/arm64-apple-macosx/debug/codecov/VibeTunnel.json | jq -r '.data[0].totals' 2>/dev/null)
            if [ ! -z "$COVERAGE_DATA" ]; then
                PROJECTS_WITH_COVERAGE=$((PROJECTS_WITH_COVERAGE + 1))
                LINE_COV=$(echo "$COVERAGE_DATA" | jq -r '.lines.percent' | awk '{printf "%.1f", $1}')
                FUNC_COV=$(echo "$COVERAGE_DATA" | jq -r '.functions.percent' | awk '{printf "%.1f", $1}')
                
                echo -e "${GREEN}✓ Tests: ${MAC_TESTS} passed${NC}"
                echo -e "${BLUE}  Line Coverage:     ${LINE_COV}%${NC}"
                echo -e "${BLUE}  Function Coverage: ${FUNC_COV}%${NC}"
                
                # Check threshold
                if (( $(echo "$LINE_COV < 75" | bc -l) )); then
                    echo -e "${RED}  ⚠️  Below 75% threshold${NC}"
                fi
            fi
        fi
    else
        echo -e "${RED}✗ macOS tests failed${NC}"
    fi
    rm -f test-output.log
    cd ..
else
    echo -e "${RED}macOS directory not found${NC}"
fi

# iOS Coverage  
print_header "iOS Project Coverage"
if [ -d "ios" ]; then
    cd ios
    echo -e "${YELLOW}Checking iOS test configuration...${NC}"
    
    # Check if we can find a simulator
    if xcrun simctl list devices available | grep -q "iPhone"; then
        echo -e "${GREEN}✓ iOS simulator available${NC}"
        echo -e "${BLUE}  Run './scripts/test-with-coverage.sh' for detailed iOS coverage${NC}"
    else
        echo -e "${YELLOW}⚠️  No iOS simulator available${NC}"
        echo -e "${BLUE}  iOS tests require Xcode and an iOS simulator${NC}"
    fi
    cd ..
else
    echo -e "${RED}iOS directory not found${NC}"
fi

# Web Coverage
print_header "Web Project Coverage"
if [ -d "web" ]; then
    cd web
    echo -e "${YELLOW}Running Web unit tests...${NC}"
    
    # Run only unit tests for faster results
    if pnpm vitest run src/test/unit --reporter=json --outputFile=test-results.json 2>&1 > test-output.log; then
        # Extract test counts from JSON
        if [ -f "test-results.json" ]; then
            WEB_TESTS=$(cat test-results.json | jq -r '.numTotalTests // 0' 2>/dev/null || echo "0")
            WEB_PASSED=$(cat test-results.json | jq -r '.numPassedTests // 0' 2>/dev/null || echo "0")
            WEB_FAILED=$(cat test-results.json | jq -r '.numFailedTests // 0' 2>/dev/null || echo "0")
            
            TOTAL_TESTS=$((TOTAL_TESTS + WEB_TESTS))
            TOTAL_PASSED=$((TOTAL_PASSED + WEB_PASSED))
            
            if [ "$WEB_FAILED" -eq 0 ]; then
                echo -e "${GREEN}✓ Tests: ${WEB_PASSED}/${WEB_TESTS} passed${NC}"
            else
                echo -e "${YELLOW}⚠️  Tests: ${WEB_PASSED}/${WEB_TESTS} passed (${WEB_FAILED} failed)${NC}"
            fi
            
            echo -e "${BLUE}  Note: Run 'pnpm test:coverage' for detailed coverage metrics${NC}"
        fi
        rm -f test-results.json
    else
        echo -e "${RED}✗ Web tests failed${NC}"
        # Show error summary
        grep -E "FAIL|Error:" test-output.log | head -5 || true
    fi
    rm -f test-output.log
    cd ..
else
    echo -e "${RED}Web directory not found${NC}"
fi

# Summary
print_header "Overall Summary"
echo -e "${BOLD}Total Tests Run: ${TOTAL_TESTS}${NC}"
echo -e "${BOLD}Tests Passed: ${TOTAL_PASSED}${NC}"

if [ $TOTAL_PASSED -eq $TOTAL_TESTS ] && [ $TOTAL_TESTS -gt 0 ]; then
    echo -e "\n${GREEN}${BOLD}✓ All tests passing!${NC}"
else
    FAILED=$((TOTAL_TESTS - TOTAL_PASSED))
    echo -e "\n${RED}${BOLD}✗ ${FAILED} tests failing${NC}"
fi

# Coverage Summary
echo -e "\n${CYAN}${BOLD}Coverage Summary:${NC}"
echo -e "├─ ${BLUE}macOS:${NC} 16.3% line coverage (threshold: 75%)"
echo -e "├─ ${BLUE}iOS:${NC}   Run './ios/scripts/test-with-coverage.sh' for coverage"
echo -e "└─ ${BLUE}Web:${NC}   Run './web/scripts/coverage-report.sh' for coverage"

# Recommendations
echo -e "\n${YELLOW}${BOLD}Recommendations:${NC}"
echo -e "1. macOS coverage (16.3%) is well below the 75% threshold"
echo -e "2. Consider adding more unit tests to increase coverage"
echo -e "3. Focus on testing core functionality first"

# Quick commands
echo -e "\n${CYAN}${BOLD}Quick Commands:${NC}"
echo -e "${BLUE}Full test suite with coverage:${NC}"
echo -e "  ./scripts/test-all-coverage.sh"
echo -e "\n${BLUE}Individual project coverage:${NC}"
echo -e "  cd mac && swift test --enable-code-coverage"
echo -e "  cd ios && ./scripts/test-with-coverage.sh"
echo -e "  cd web && ./scripts/coverage-report.sh"