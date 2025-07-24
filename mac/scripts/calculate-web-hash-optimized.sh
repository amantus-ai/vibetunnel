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

# Optimization 1: Use parallel processing with xargs
# Optimization 2: Focus only on src directory and key config files
# Optimization 3: Use tar to efficiently process files
# Optimization 4: Avoid echoing individual file names

CONTENT_HASH=$(( \
    # Hash source files in src directory
    find src -type f \( -name "*.ts" -o -name "*.js" -o -name "*.css" -o -name "*.html" -o -name "*.json" \) 2>/dev/null | \
    sort | \
    xargs -P 8 -I {} sh -c 'cat "{}" 2>/dev/null || true' | \
    shasum -a 256; \
    # Hash key config files that affect the build
    cat package.json 2>/dev/null || true; \
    cat tsconfig.json 2>/dev/null || true; \
    cat vite.config.ts 2>/dev/null || true; \
    cat .env 2>/dev/null || true; \
    cat .env.local 2>/dev/null || true; \
) | shasum -a 256 | cut -d' ' -f1)

echo "Web content hash: ${CONTENT_HASH}"

# Create directory for hash file if it doesn't exist
mkdir -p "$(dirname "${HASH_FILE}")"

# Write the hash to file
echo "${CONTENT_HASH}" > "${HASH_FILE}"