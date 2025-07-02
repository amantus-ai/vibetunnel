#!/bin/bash
# Run all code quality checks
# Format and lint checks run in parallel (read-only)
# Type checking runs in parallel as it doesn't modify files

# Create temporary files for capturing output
FORMAT_OUT=$(mktemp)
LINT_OUT=$(mktemp)
TYPECHECK_OUT=$(mktemp)

# Track PIDs for parallel tasks
declare -a pids=()

# Run format CHECK (read-only) in parallel
{
    if ! pnpm run format:check > "$FORMAT_OUT" 2>&1; then
        echo "Format check failed:"
        cat "$FORMAT_OUT"
        exit 1
    fi
} &
pids+=($!)

# Run lint CHECK (with Biome check, not write) in parallel
{
    if ! pnpm run lint > "$LINT_OUT" 2>&1; then
        echo "Lint check failed:"
        cat "$LINT_OUT"
        exit 1
    fi
} &
pids+=($!)

# Run typecheck in parallel (doesn't modify files)
{
    if ! pnpm run typecheck > "$TYPECHECK_OUT" 2>&1; then
        echo "Typecheck failed:"
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

# Exit with appropriate code
if [ "$failed" = true ]; then
    exit 1
fi