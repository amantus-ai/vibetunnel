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

echo "Calculating web content hash..."
cd "${WEB_DIR}"

# Use tar to create a single stream of all files for fast hashing
# This avoids spawning processes for each file
CONTENT_HASH=$(find . \
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
    -not -name "package-lock.json" | \
    sort | \
    tar -cf - -T - 2>/dev/null | \
    shasum -a 256 | \
    cut -d' ' -f1)

echo "Web content hash: ${CONTENT_HASH}"

# Create directory for hash file if it doesn't exist
mkdir -p "$(dirname "${HASH_FILE}")"

# Write the hash to file
echo "${CONTENT_HASH}" > "${HASH_FILE}"