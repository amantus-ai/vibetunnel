#!/bin/bash
# Run format and lint fixes sequentially to avoid file conflicts
# Based on best practices to prevent race conditions

echo "🔧 Running format and lint fixes sequentially..."

# Run format first
echo "📝 Formatting code..."
if ! pnpm run format; then
    echo "❌ Format failed"
    exit 1
fi
echo "✅ Format completed"

# Then run lint fix (Biome will skip formatting rules already handled)
echo "🔎 Running lint fix..."
if ! pnpm run lint:fix; then
    echo "❌ Lint fix failed"
    exit 1
fi
echo "✅ Lint fix completed"

echo "✅ All fixes applied successfully!"