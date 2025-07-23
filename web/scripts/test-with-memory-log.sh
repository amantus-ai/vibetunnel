#!/bin/bash

# Script to run tests with memory logging to identify which test causes OOM

echo "🔍 Running tests with memory logging enabled..."
echo "This will create a test-memory.log file with detailed memory usage per test."
echo ""

# Enable garbage collection exposure
export NODE_OPTIONS="--expose-gc --max-old-space-size=8192"

# Enable memory logging
export MEMORY_LOG=1

# Clear previous log
rm -f test-memory.log

# Run tests
echo "Starting test run..."
pnpm test --reporter=verbose

# Check if the log file was created
if [ -f test-memory.log ]; then
    echo ""
    echo "✅ Memory log created: test-memory.log"
    echo ""
    echo "📊 Last 10 tests before crash (if any):"
    tail -n 50 test-memory.log | grep -E '"test":|"memory":'
    
    echo ""
    echo "🔍 Tests with highest memory usage:"
    grep -A 5 '"test":' test-memory.log | grep -B 1 -A 4 'heapUsed' | awk '
        /"test":/ { test=$0 }
        /"heapUsed":/ { 
            gsub(/[^0-9.]/, "", $0)
            if ($0 > max) { max=$0; maxtest=test }
        }
        END { print "Highest memory usage:", max, "MB in test:", maxtest }
    '
else
    echo "❌ No memory log file created. The crash might have occurred before any tests ran."
fi