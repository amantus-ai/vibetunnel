#!/bin/bash
# Script to test a single file with memory monitoring

if [ -z "$1" ]; then
  echo "Usage: $0 <test-file-path>"
  echo "Example: $0 src/client/components/session-view/image-upload-menu.test.ts"
  exit 1
fi

TEST_FILE="$1"
LOG_FILE="test-single-${TEST_FILE//\//-}.log"

echo "🧪 Testing single file: $TEST_FILE"
echo "📝 Log will be saved to: $LOG_FILE"
echo ""

# Run the specific test with memory logging
MEMORY_LOG=1 NODE_OPTIONS="--expose-gc --max-old-space-size=8192" \
  pnpm run test --run "$TEST_FILE" 2>&1 | tee "$LOG_FILE"

EXIT_CODE=${PIPESTATUS[0]}

if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "❌ Test failed with exit code: $EXIT_CODE"
  echo "Check the log file for details: $LOG_FILE"
  
  # Also check if test-memory.log was created
  if [ -f "test-memory.log" ]; then
    echo ""
    echo "📊 Memory log available at: test-memory.log"
    echo "Last 20 lines of memory log:"
    tail -20 test-memory.log
  fi
else
  echo ""
  echo "✅ Test passed successfully"
fi

exit $EXIT_CODE