#!/bin/bash

# Lint fix script for VibeTunnel Tauri project
# This script automatically fixes formatting and some linting issues

set -e

echo "🔧 Auto-fixing Rust code issues for Tauri..."

cd "$(dirname "$0")/src-tauri"

# Format code
echo "📋 Formatting code with rustfmt..."
cargo fmt
echo "✅ Code formatted!"

# Fix clippy warnings that can be auto-fixed
echo "🔧 Attempting to fix clippy warnings..."
cargo clippy --fix --allow-dirty --allow-staged -- -D warnings
echo "✅ Applied clippy fixes!"

# Run tests to ensure nothing broke
echo "🧪 Running tests to verify fixes..."
cargo test
echo "✅ All tests passed!"

echo "🎉 All auto-fixes completed successfully!"
echo ""
echo "Note: Some issues may require manual fixes. Run ./lint.sh to check for remaining issues."