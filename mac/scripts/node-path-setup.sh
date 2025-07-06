#!/bin/bash
# node-path-setup.sh
# -------------------------------------------------------------
# Common helper to ensure Node.js managers add their binaries to
# PATH for VibeTunnel build scripts. Source this instead of
# duplicating logic in every script.
#
# Priority order (highest to lowest):
# 1. Homebrew (most reliable for builds)
#    - Apple Silicon: /opt/homebrew/bin/node 
#    - Intel: /usr/local/bin/node
#    - Exit early if found and working
# 2. Volta (explicit version management)
# 3. fnm (fast node manager)
#    - Disables auto-switching in CI/Xcode
# 4. NVM (can be slow, lowest priority)
#    - Disables auto-switching in CI/Xcode
#    - Uses system/default/node in CI
#
# This fixes issue #246 where NVM was overriding Homebrew node
# causing version conflicts in Xcode builds.
#
# Usage (Bash):
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-${0}}")" && pwd)"
#   source "${SCRIPT_DIR}/node-path-setup.sh"
# Usage (Zsh):
#   SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
#   source "${SCRIPT_DIR}/node-path-setup.sh"
# -------------------------------------------------------------

# Store original PATH to avoid duplicates
ORIGINAL_PATH="$PATH"

# Function to add to PATH only if not already present
add_to_path() {
    local new_path="$1"
    if [ -d "$new_path" ] && [[ ":$PATH:" != *":$new_path:"* ]]; then
        export PATH="$new_path:$PATH"
    fi
}

# Function to check if we have a working node
has_working_node() {
    command -v node >/dev/null 2>&1 && node --version >/dev/null 2>&1
}

# 1. HOMEBREW (Highest Priority)
# Homebrew provides the most stable builds for macOS
# Apple Silicon Homebrew first (most modern)
add_to_path "/opt/homebrew/bin"
add_to_path "/opt/homebrew/sbin"

# Check if we have Apple Silicon Homebrew node and it works
if has_working_node; then
    CURRENT_NODE="$(which node)"
    if [[ "$CURRENT_NODE" == "/opt/homebrew/bin/node" ]]; then
        # Perfect! We have Apple Silicon Homebrew node working
        add_to_path "$HOME/Library/pnpm"
        add_to_path "$HOME/.bun/bin"
        return 0 2>/dev/null || exit 0
    fi
fi

# Intel Homebrew as fallback
add_to_path "/usr/local/bin"
add_to_path "/usr/local/sbin"

# Check if Intel Homebrew node is working
if has_working_node; then
    CURRENT_NODE="$(which node)"
    if [[ "$CURRENT_NODE" == "/usr/local/bin/node" ]]; then
        # We have Intel Homebrew node working
        add_to_path "$HOME/Library/pnpm"
        add_to_path "$HOME/.bun/bin"
        return 0 2>/dev/null || exit 0
    fi
fi

# 2. VOLTA (Second Priority)
# Volta is explicit and reliable
if [ -d "$HOME/.volta/bin" ]; then
    add_to_path "$HOME/.volta/bin"
    if has_working_node; then
        add_to_path "$HOME/Library/pnpm"
        add_to_path "$HOME/.bun/bin"
        return 0 2>/dev/null || exit 0
    fi
fi

# 3. FNM (Third Priority)
# fnm is fast but less common
if command -v fnm >/dev/null 2>&1; then
    # Disable fnm auto-switching in CI environments to avoid version conflicts
    if [ "$CI" = "true" ] || [ -n "$XCODE_VERSION_ACTUAL" ]; then
        export FNM_AUTO_SWITCH=false
    fi
    eval "$(fnm env --use-on-cd=false 2>/dev/null || fnm env 2>/dev/null)" || true
    if has_working_node; then
        add_to_path "$HOME/Library/pnpm"
        add_to_path "$HOME/.bun/bin"
        return 0 2>/dev/null || exit 0
    fi
fi

# 4. NVM (Lowest Priority)
# NVM can be slow and sometimes interferes with system node
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    
    # In CI/Xcode environments, try to use system default instead of auto-switching
    if [ "$CI" = "true" ] || [ -n "$XCODE_VERSION_ACTUAL" ]; then
        # Load NVM but don't auto-switch versions
        export NVM_AUTO_SWITCH=false
        . "$NVM_DIR/nvm.sh" --no-use
        # Use system default or latest installed
        nvm use system 2>/dev/null || nvm use default 2>/dev/null || nvm use node 2>/dev/null || true
    else
        . "$NVM_DIR/nvm.sh"
    fi
fi

# 5. Final additions
add_to_path "$HOME/Library/pnpm"
add_to_path "$HOME/.bun/bin"

# Verify we have a working Node.js installation
if ! has_working_node; then
    echo "error: No working Node.js installation found after loading all managers" >&2
    echo "error: Searched in PATH: $PATH" >&2
    echo "error: Please install Node.js via Homebrew: brew install node" >&2
    
    # Try one last desperate attempt to find any node
    for potential_node in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
        if [ -x "$potential_node" ]; then
            echo "warning: Found node at $potential_node, attempting to use it" >&2
            export PATH="$(dirname "$potential_node"):$PATH"
            if has_working_node; then
                echo "warning: Successfully using $potential_node" >&2
                break
            fi
        fi
    done
    
    # Final check
    if ! has_working_node; then
        echo "error: Still no working Node.js found. Build will likely fail." >&2
        # Don't restore PATH - let it fail fast rather than silently
        exit 1
    fi
else
    # Success! Log what we're using for debugging
    NODE_PATH="$(which node)"
    NODE_VERSION="$(node --version)"
    echo "# Node.js setup complete: $NODE_PATH ($NODE_VERSION)" >&2
fi
