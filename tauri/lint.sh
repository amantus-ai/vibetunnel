#!/bin/bash

# Lint script for VibeTunnel Tauri project
# This script runs rustfmt check, clippy, and tests

set -e

echo "🔍 Running Rust linters and tests for Tauri..."

cd "$(dirname "$0")/src-tauri"

# Format check
echo "📋 Checking code formatting with rustfmt..."
cargo fmt -- --check
echo "✅ Code formatting check passed!"

# Clippy linting
echo "🔧 Running clippy lints..."
cargo clippy -- -D warnings
echo "✅ Clippy checks passed!"

# Run tests
echo "🧪 Running tests..."
cargo test
echo "✅ All tests passed!"

echo "🎉 All checks completed successfully!"