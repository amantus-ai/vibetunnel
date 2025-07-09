.PHONY: format lint check build clean all

# Default target
all: format lint build

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

# Build the project
build:
	npm run build

# Clean build artifacts
clean:
	cargo clean
	rm -f *.node

# Development workflow: format, lint, and build
dev: format lint build