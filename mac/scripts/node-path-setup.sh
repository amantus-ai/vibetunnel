#!/bin/bash

ORIGINAL_PATH="$PATH"

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"

if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env --use-on-cd=false)" 2>/dev/null || true
    export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
fi

if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    source "$NVM_DIR/nvm.sh"
    export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
fi

export PATH="$HOME/Library/pnpm:$HOME/.bun/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
    echo "error: Node.js not found. Install via: brew install node" >&2
    exit 1
fi
