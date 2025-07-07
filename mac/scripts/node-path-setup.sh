#!/bin/bash

# Add Node.js paths in priority order: Homebrew → Volta → fnm → NVM
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"

# Load fnm if available
if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env)" 2>/dev/null || true
fi

# Load NVM if available (lowest priority)
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
fi

# Add package managers
export PATH="$HOME/Library/pnpm:$HOME/.bun/bin:$PATH"

# Make sure we have a working Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "error: Node.js not found. Install via: brew install node" >&2
    exit 1
fi
