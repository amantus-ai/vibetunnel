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
HASH_FILE="${BUILT_PRODUCTS_DIR}/.web-content-hash"

# Check if web directory exists
if [ ! -d "${WEB_DIR}" ]; then
    echo "error: Web directory not found at ${WEB_DIR}"
    exit 1
fi

echo "Calculating web content hash (optimized)..."
cd "${WEB_DIR}"

# Check if xxhsum is available, otherwise fall back to shasum
if command -v xxhsum >/dev/null 2>&1; then
    HASH_CMD="xxhsum -H64"
    HASH_CUT='cut -d" " -f1'
else
    echo "Note: xxhsum not found, using SHA-256 (slower). Install xxHash for 5-10x speedup:"
    echo "  brew install xxhash"
    HASH_CMD="shasum -a 256"
    HASH_CUT='cut -d" " -f1'
fi

# Function to hash a file
hash_file() {
    local file="$1"
    echo "FILE:$file"
    cat "$file" 2>/dev/null || true
    echo ""
}

export -f hash_file
export HASH_CMD

# Find all relevant files
FILES=$(find . \
    -type f \
    \( -name "*.ts" -o -name "*.js" -o -name "*.json" -o -name "*.css" -o -name "*.html" \
       -o -name "*.tsx" -o -name "*.jsx" -o -name "*.vue" -o -name "*.svelte" \
       -o -name "*.yaml" -o -name "*.yml" -o -name "*.toml" -o -name "*.d.ts" \) \
    -not -path "./node_modules/*" \
    -not -path "./dist/*" \
    -not -path "./public/*" \
    -not -path "./.next/*" \
    -not -path "./coverage/*" \
    -not -path "./.cache/*" \
    -not -path "./.node-builds/*" \
    -not -path "./build/*" \
    -not -path "./native/*" \
    -not -path "./node-build-artifacts/*" \
    -not -name "package-lock.json" | \
    sort)

# Use parallel processing if available
if command -v parallel >/dev/null 2>&1; then
    # Process files in parallel (up to number of CPU cores)
    CONTENT_HASH=$(echo "$FILES" | \
        parallel -j+0 --keep-order hash_file | \
        eval "$HASH_CMD" | \
        eval "$HASH_CUT")
else
    # Fall back to sequential processing
    CONTENT_HASH=$(echo "$FILES" | \
        while read file; do
            hash_file "$file"
        done | \
        eval "$HASH_CMD" | \
        eval "$HASH_CUT")
fi

echo "Web content hash: ${CONTENT_HASH}"

# Create directory for hash file if it doesn't exist
mkdir -p "$(dirname "${HASH_FILE}")"

# Write the hash to file
echo "${CONTENT_HASH}" > "${HASH_FILE}"