#!/bin/bash
# Run all code quality checks
# Format and lint checks run in parallel (read-only)
# Type checking runs in parallel as it doesn't modify files

echo "🔍 Running all code quality checks..."

# Create temporary files for capturing output
FORMAT_OUT=$(mktemp)
LINT_OUT=$(mktemp)
TYPECHECK_OUT=$(mktemp)

# Track PIDs for parallel tasks
declare -a pids=()

# Run format CHECK (read-only) in parallel
{
    echo "📝 Checking formatting..."
    if pnpm run format:check > "$FORMAT_OUT" 2>&1; then
        echo "✅ Format check passed"
    else
        echo "❌ Format check failed"
        cat "$FORMAT_OUT"
        exit 1
    fi
} &
pids+=($!)

# Run lint CHECK (with Biome check, not write) in parallel
{
    echo "🔎 Running lint check..."
    if pnpm run lint > "$LINT_OUT" 2>&1; then
        echo "✅ Lint check passed"
    else
        echo "❌ Lint check failed"
        cat "$LINT_OUT"
        exit 1
    fi
} &
pids+=($!)

# Run typecheck in parallel (doesn't modify files)
{
    echo "🏷️  Running typecheck..."
    if pnpm run typecheck > "$TYPECHECK_OUT" 2>&1; then
        echo "✅ Typecheck passed"
    else
        echo "❌ Typecheck failed"
        cat "$TYPECHECK_OUT"
        exit 1
    fi
} &
pids+=($!)

# Wait for all parallel processes
failed=false
for pid in "${pids[@]}"; do
    if ! wait "$pid"; then
        failed=true
    fi
done

# Cleanup
rm -f "$FORMAT_OUT" "$LINT_OUT" "$TYPECHECK_OUT"

if [ "$failed" = true ]; then
    echo "❌ Some checks failed"
    exit 1
else
    echo "✅ All checks passed!"
fi