#!/bin/zsh
set -e  # Exit on any error

# Get the project directory
if [ -z "${SRCROOT}" ]; then
    # If SRCROOT is not set (running outside Xcode), determine it from script location
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
else
    PROJECT_DIR="${SRCROOT}"
fi

WEB_DIR="${PROJECT_DIR}/../web"

# Set hash file location - use BUILT_PRODUCTS_DIR if available, otherwise use temp location
if [ -n "${BUILT_PRODUCTS_DIR}" ]; then
    HASH_FILE="${BUILT_PRODUCTS_DIR}/.web-content-hash"
else
    # When running outside Xcode, use a temp location
    HASH_FILE="${PROJECT_DIR}/build/.web-content-hash"
fi

# Check if web directory exists
if [ ! -d "${WEB_DIR}" ]; then
    echo "error: Web directory not found at ${WEB_DIR}"
    exit 1
fi

echo "Calculating web content hash..."
cd "${WEB_DIR}"

HASH_PATHS=(
    'src/'
    'bin/vt'
    'scripts/build-fwd-rust.js'
    'package.json'
    'tsconfig.json'
    'vite.config.ts'
    '.env'
    '.env.local'
    '../native/vt-fwd/src/'
    '../native/vt-fwd/Cargo.toml'
    '../native/vt-fwd/Cargo.lock'
    '../native/vt-fwd/rust-toolchain.toml'
)

# Ultra-fast approach: Use git to get hash of tracked files if possible
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    # Use git to hash all tracked web and Rust forwarder inputs.
    # This is extremely fast as git already has file hashes
    CONTENT_HASH=$(
        git ls-tree -r HEAD -- "${HASH_PATHS[@]}" 2>/dev/null | \
        awk '{print $3}' | \
        sort | \
        shasum -a 256 | \
        cut -d' ' -f1
    )
    
    # If there are uncommitted changes, append a hash of the diff
    if ! git diff --quiet HEAD -- "${HASH_PATHS[@]}" 2>/dev/null; then
        DIFF_HASH=$(git diff HEAD -- "${HASH_PATHS[@]}" 2>/dev/null | shasum -a 256 | cut -d' ' -f1)
        CONTENT_HASH="${CONTENT_HASH}-${DIFF_HASH:0:8}"
    fi
    
    # Also check for untracked web or Rust forwarder inputs.
    UNTRACKED_FILES=$(git ls-files --others --exclude-standard -- "${HASH_PATHS[@]}" 2>/dev/null)
    if [ -n "$UNTRACKED_FILES" ]; then
        UNTRACKED_HASH=$(echo "$UNTRACKED_FILES" | xargs -I {} cat {} 2>/dev/null | shasum -a 256 | cut -d' ' -f1)
        CONTENT_HASH="${CONTENT_HASH}-untracked-${UNTRACKED_HASH:0:8}"
    fi
else
    # Fallback to direct file hashing if git is not available
    # Use a single tar command to process all files at once - much faster than individual cats
    CONTENT_HASH=$(
        tar cf - \
            --exclude='*/node_modules' \
            --exclude='*/dist' \
            --exclude='*/build' \
            --exclude='*/target' \
            "${HASH_PATHS[@]}" \
            2>/dev/null | \
        shasum -a 256 | \
        cut -d' ' -f1
    )
fi

# Local environment files are commonly gitignored, so hash them directly.
LOCAL_ENV_HASH=$(
    for file in .env .env.local; do
        if [ -f "$file" ]; then
            printf '%s\0' "$file"
            cat "$file"
        fi
    done | shasum -a 256 | cut -d' ' -f1
)
CONTENT_HASH="${CONTENT_HASH}-env-${LOCAL_ENV_HASH:0:8}"

# The Rust helper emits a universal binary only when both Apple architectures
# are requested. Keep thin and universal artifacts in separate cache states.
NORMALIZED_ARCHS=$(
    printf '%s' "${ARCHS:-}" | tr '[:space:]' '\n' | sed '/^$/d' | sort -u | paste -sd ' ' -
)
ARCHS_HASH=$(printf '%s' "${NORMALIZED_ARCHS}" | shasum -a 256 | cut -d' ' -f1)
CONTENT_HASH="${CONTENT_HASH}-archs-${ARCHS_HASH:0:8}"

echo "Web content hash: ${CONTENT_HASH}"

# Create directory for hash file if it doesn't exist
mkdir -p "$(dirname "${HASH_FILE}")"

# Write the hash to file
echo "${CONTENT_HASH}" > "${HASH_FILE}"
