#!/bin/bash
# Run all code quality checks in parallel

echo "🔍 Running all code quality checks..."

# Create temporary files for capturing output
FORMAT_OUT=$(mktemp)
LINT_OUT=$(mktemp)
TYPECHECK_OUT=$(mktemp)

# Track PIDs
declare -a pids=()

# Run format check
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

# Run lint
{
    echo "🔎 Running lint..."
    if pnpm run lint > "$LINT_OUT" 2>&1; then
        echo "✅ Lint passed"
    else
        echo "❌ Lint failed"
        cat "$LINT_OUT"
        exit 1
    fi
} &
pids+=($!)

# Run typecheck
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

# Wait for all processes
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