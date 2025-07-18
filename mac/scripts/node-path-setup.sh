#!/bin/bash

# Load fnm if available
if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env)" 2>/dev/null || true
fi

# Load NVM if available
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    source "$NVM_DIR/nvm.sh" 2>/dev/null || true
fi

# Check if we're in a build context that needs to avoid Homebrew library contamination
# This is set by build scripts that compile native code
if [ "${VIBETUNNEL_BUILD_CLEAN_ENV:-}" = "true" ]; then
    # For builds, add Homebrew at the END of PATH to avoid library contamination
    # This ensures system libraries are preferred during compilation
    export PATH="$HOME/.volta/bin:$HOME/Library/pnpm:$HOME/.bun/bin:$PATH:/opt/homebrew/bin:/usr/local/bin"
else
    # For normal usage, Homebrew can be at the beginning for convenience
    export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/Library/pnpm:$HOME/.bun/bin:$PATH"
fi

# Verify Node.js is available (skip in CI when using pre-built artifacts)
if [ "${SKIP_NODE_CHECK}" = "true" ] && [ "${CI}" = "true" ]; then
    # In CI with pre-built artifacts, Node.js is not required
    return 0 2>/dev/null || exit 0
fi

if ! command -v node >/dev/null 2>&1; then
    echo "error: Node.js not found. Install via: brew install node" >&2
    return 1 2>/dev/null || exit 1
fi
