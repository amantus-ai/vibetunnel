.PHONY: format lint check build test clean all

# Default target
all: format lint test build

# Format code with rustfmt
format:
	cargo fmt

# Check formatting without applying changes
format-check:
	cargo fmt -- --check

# Run clippy linter
lint:
	cargo clippy -- -D warnings

# Run all checks (format check + clippy)
check: format-check lint

# Build the project in release mode
build:
	cargo build --release

# Run tests
test:
	cargo test

# Clean build artifacts
clean:
	cargo clean

# Development workflow: format, lint, test, and build
dev: format lint test build

# Install locally for testing
install: build
	cp target/release/vt-pipe ~/.local/bin/