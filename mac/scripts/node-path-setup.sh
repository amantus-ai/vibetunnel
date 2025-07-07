#!/bin/bash

# Prioritize Homebrew Node.js over NVM/fnm for build reliability
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"

# Load fnm if available
if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env --use-on-cd=false)" 2>/dev/null || true
fi

# Load NVM if available  
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    source "$NVM_DIR/nvm.sh"
fi

# Restore Homebrew priority after version managers modify PATH
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/Library/pnpm:$HOME/.bun/bin:$PATH"

# Verify Node.js is available
if ! command -v node >/dev/null 2>&1; then
    echo "error: Node.js not found. Install via: brew install node" >&2
    return 1 2>/dev/null || exit 1
fi
