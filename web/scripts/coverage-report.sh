#!/bin/bash
set -euo pipefail

# Script to run web tests with coverage and generate reports

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}Running VibeTunnel Web Tests with Coverage${NC}"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Must run from web/ directory${NC}"
    exit 1
fi

# Clean previous coverage
echo -e "${YELLOW}Cleaning previous coverage data...${NC}"
rm -rf coverage

# Run tests with coverage
echo -e "${YELLOW}Running tests with coverage...${NC}"
pnpm vitest run --coverage 2>&1 | tee test-output.log

# Check if tests passed
if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo -e "${GREEN}✓ Tests passed!${NC}"
else
    echo -e "${RED}✗ Tests failed!${NC}"
    # Show failed tests
    echo -e "\n${RED}Failed tests:${NC}"
    grep -E "FAIL|✗|×" test-output.log || true
fi

# Extract coverage summary
if [ -f "coverage/coverage-summary.json" ]; then
    echo -e "\n${GREEN}Coverage Summary:${NC}"
    
    # Extract percentages using jq
    LINES=$(cat coverage/coverage-summary.json | jq -r '.total.lines.pct')
    FUNCTIONS=$(cat coverage/coverage-summary.json | jq -r '.total.functions.pct')
    BRANCHES=$(cat coverage/coverage-summary.json | jq -r '.total.branches.pct')
    STATEMENTS=$(cat coverage/coverage-summary.json | jq -r '.total.statements.pct')
    
    echo -e "${BLUE}Lines:${NC}      ${LINES}%"
    echo -e "${BLUE}Functions:${NC}  ${FUNCTIONS}%"
    echo -e "${BLUE}Branches:${NC}   ${BRANCHES}%"
    echo -e "${BLUE}Statements:${NC} ${STATEMENTS}%"
    
    # Check if coverage meets thresholds (80% as configured)
    THRESHOLD=80
    BELOW_THRESHOLD=false
    
    if (( $(echo "$LINES < $THRESHOLD" | bc -l) )); then
        echo -e "${RED}⚠️  Line coverage ${LINES}% is below threshold of ${THRESHOLD}%${NC}"
        BELOW_THRESHOLD=true
    fi
    
    if (( $(echo "$FUNCTIONS < $THRESHOLD" | bc -l) )); then
        echo -e "${RED}⚠️  Function coverage ${FUNCTIONS}% is below threshold of ${THRESHOLD}%${NC}"
        BELOW_THRESHOLD=true
    fi
    
    if (( $(echo "$BRANCHES < $THRESHOLD" | bc -l) )); then
        echo -e "${RED}⚠️  Branch coverage ${BRANCHES}% is below threshold of ${THRESHOLD}%${NC}"
        BELOW_THRESHOLD=true
    fi
    
    if (( $(echo "$STATEMENTS < $THRESHOLD" | bc -l) )); then
        echo -e "${RED}⚠️  Statement coverage ${STATEMENTS}% is below threshold of ${THRESHOLD}%${NC}"
        BELOW_THRESHOLD=true
    fi
    
    if [ "$BELOW_THRESHOLD" = false ]; then
        echo -e "\n${GREEN}✓ All coverage metrics meet the ${THRESHOLD}% threshold${NC}"
    fi
    
    # Show uncovered files
    echo -e "\n${YELLOW}Files with low coverage:${NC}"
    cat coverage/coverage-summary.json | jq -r '
        to_entries | 
        map(select(.key != "total" and .value.lines.pct < 80)) | 
        sort_by(.value.lines.pct) | 
        .[] | 
        "\(.value.lines.pct)% - \(.key)"
    ' | head -10 || echo "No files below 80% coverage"
    
else
    echo -e "${RED}Coverage data not generated${NC}"
fi

# Clean up
rm -f test-output.log

# Open HTML report
echo -e "\n${YELLOW}To view detailed coverage report:${NC}"
echo "open coverage/index.html"