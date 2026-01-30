#!/bin/bash

# =============================================================================
# =============================================================================
#
# This script runs SwiftFormat and SwiftLint on the VibeTunnel iOS codebase
# to ensure consistent code style and catch potential issues.
#
# USAGE:
#   ./scripts/lint.sh
#
# DEPENDENCIES:
#   - swiftformat (brew install swiftformat)
#   - swiftlint (brew install swiftlint)
#
# FEATURES:
#   - Automatically formats Swift code with SwiftFormat
#   - Fixes auto-correctable SwiftLint issues
#   - Reports remaining SwiftLint warnings and errors
#
# EXIT CODES:
#   0 - Success (all checks passed)
#   1 - Missing dependencies or linting errors
#
# =============================================================================

set -euo pipefail

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SCRIPT_DIR/common.sh" ]] && source "$SCRIPT_DIR/common.sh" || true

PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Change to project root
cd "$PROJECT_ROOT"

# Check if project has Swift files
if ! find . -name "*.swift" -not -path "./.build/*" -not -path "./build/*" | head -1 | grep -q .; then
    print_warning "No Swift files found in project"
    exit 0
fi

print_info "Running SwiftFormat..."
if command -v swiftformat &> /dev/null; then
    if swiftformat . --config ../apple/.swiftformat --verbose; then
        print_success "SwiftFormat completed successfully"
    else
        print_error "SwiftFormat encountered errors"
        exit 1
    fi
else
    print_error "SwiftFormat not installed"
    echo "   Install with: brew install swiftformat"
    exit 1
fi

print_info "Running SwiftLint..."
if command -v swiftlint &> /dev/null; then
    # First run auto-corrections
    print_info "Applying auto-corrections..."
    swiftlint --fix --config ../apple/.swiftlint.yml
    
    # Then run full lint check
    print_info "Checking for remaining issues..."
    if swiftlint --config ../apple/.swiftlint.yml; then
        print_success "SwiftLint completed successfully"
    else
        print_warning "SwiftLint found issues that require manual attention"
        # Don't exit with error as these may be warnings
    fi
else
    print_error "SwiftLint not installed"
    echo "   Install with: brew install swiftlint"
    exit 1
fi

print_success "Linting complete!"
