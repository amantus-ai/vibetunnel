#!/bin/bash
#
# Simplified Node.js check for build process
#
# This is a simpler version that's more robust and easier to debug
#

set -e

echo "Checking for Node.js..."

# Common Node.js locations to check
NODE_PATHS=(
    "/opt/homebrew/bin/node"          # Homebrew ARM
    "/usr/local/bin/node"              # Homebrew Intel
    "$HOME/.nvm/versions/node/*/bin/node"  # NVM (glob)
    "$HOME/.volta/bin/node"            # Volta
    "$HOME/.fnm/node-versions/*/bin/node"  # fnm (glob)
    "/usr/bin/node"                    # System
)

# Find Node.js
NODE_BIN=""
for path in "${NODE_PATHS[@]}"; do
    # Handle glob patterns
    for expanded in $path; do
        if [[ -x "$expanded" ]]; then
            NODE_BIN="$expanded"
            break 2
        fi
    done
done

# Also check PATH
if [[ -z "$NODE_BIN" ]] && command -v node &>/dev/null; then
    NODE_BIN=$(command -v node)
fi

# Verify Node.js
if [[ -z "$NODE_BIN" ]] || [[ ! -x "$NODE_BIN" ]]; then
    echo "❌ Node.js not found!"
    echo ""
    echo "Please install Node.js v20 or later:"
    echo "  • Homebrew: brew install node"
    echo "  • Download: https://nodejs.org/"
    echo "  • NVM: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    echo ""
    echo "After installation, restart your terminal and try again."
    exit 1
fi

# Check version
NODE_VERSION=$("$NODE_BIN" --version 2>/dev/null | cut -d'v' -f2)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)

echo "✅ Node.js found: $NODE_BIN"
echo "   Version: v$NODE_VERSION"

if [[ "$NODE_MAJOR" -lt 20 ]]; then
    echo "⚠️  Warning: Node.js v20+ is recommended (found v$NODE_VERSION)"
fi

# Check pnpm
echo ""
echo "Checking for pnpm..."

PNPM_PATHS=(
    "$HOME/Library/pnpm/pnpm"          # User install
    "$HOME/.local/share/pnpm/pnpm"     # Linux user install
    "/opt/homebrew/bin/pnpm"           # Homebrew ARM
    "/usr/local/bin/pnpm"              # Homebrew Intel
)

PNPM_BIN=""
for path in "${PNPM_PATHS[@]}"; do
    if [[ -x "$path" ]]; then
        PNPM_BIN="$path"
        break
    fi
done

# Also check PATH
if [[ -z "$PNPM_BIN" ]] && command -v pnpm &>/dev/null; then
    PNPM_BIN=$(command -v pnpm)
fi

if [[ -z "$PNPM_BIN" ]] || [[ ! -x "$PNPM_BIN" ]]; then
    echo "❌ pnpm not found!"
    echo ""
    echo "Please install pnpm:"
    echo "  • NPM: npm install -g pnpm"
    echo "  • Homebrew: brew install pnpm"
    echo "  • Standalone: curl -fsSL https://get.pnpm.io/install.sh | sh -"
    exit 1
fi

PNPM_VERSION=$("$PNPM_BIN" --version 2>/dev/null)
echo "✅ pnpm found: $PNPM_BIN"
echo "   Version: $PNPM_VERSION"

# Export paths for build scripts
export NODE_PATH="$NODE_BIN"
export PNPM_PATH="$PNPM_BIN"

# Success
echo ""
echo "✅ All build dependencies found!"
exit 0