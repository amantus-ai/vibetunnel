#!/bin/bash

# Script to profile Playwright test performance

echo "Running Playwright tests with timing information..."

# Set environment variables for better performance
export PWTEST_SKIP_TEST_OUTPUT=1
export NODE_ENV=test

# Run tests with custom reporter that shows timing
pnpm exec playwright test --reporter=json | jq -r '
  .suites[].suites[]?.specs[]? | 
  select(.tests[0].results[0].duration != null) |
  "\(.tests[0].results[0].duration)ms - \(.file):\(.line) - \(.title)"
' | sort -rn | head -20

echo -e "\nTop 20 slowest tests listed above."