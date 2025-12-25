#!/bin/zsh
set -e  # Exit on any error
set -o pipefail  # Exit if any command in a pipeline fails

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
PREVIOUS_HASH_FILE="${BUILT_PRODUCTS_DIR}/.web-content-hash.previous"
PUBLIC_DIR="${WEB_DIR}/public"

# Set destination directory
if [ -z "${BUILT_PRODUCTS_DIR}" ]; then
    # Default for testing outside Xcode
    DEST_DIR="/tmp/vibetunnel-web-build"
else
    DEST_DIR="${BUILT_PRODUCTS_DIR}/${CONTENTS_FOLDER_PATH}/Resources/web/public"
fi

APP_RESOURCES="${BUILT_PRODUCTS_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}"

# In CI with pre-built artifacts, skip the entire build process
if [ "${CI}" = "true" ] && [ -f "${WEB_DIR}/dist/server/server.js" ]; then
    echo "✓ CI environment detected with pre-built web artifacts"
    echo "✓ Skipping web frontend build entirely"
    
    # Still need to copy the pre-built files to the app bundle
    # Clean and create destination directory
    echo "Cleaning destination directory..."
    rm -rf "${DEST_DIR}"
    mkdir -p "${DEST_DIR}"
    
    # Copy built files to Resources
    echo "Copying pre-built web files to app bundle..."
    if [ -d "${PUBLIC_DIR}" ]; then
        cp -R "${PUBLIC_DIR}/"* "${DEST_DIR}/"
    fi
    
    # Copy native executable and modules to app bundle if they exist
    NATIVE_DIR="${WEB_DIR}/native"
    
    if [ -f "${NATIVE_DIR}/vibetunnel" ]; then
        echo "Copying native executable to app bundle..."
        cp "${NATIVE_DIR}/vibetunnel" "${APP_RESOURCES}/"
        chmod +x "${APP_RESOURCES}/vibetunnel"
    fi

    if [ -f "${NATIVE_DIR}/vibetunnel-fwd" ]; then
        echo "Copying zig forwarder to app bundle..."
        cp "${NATIVE_DIR}/vibetunnel-fwd" "${APP_RESOURCES}/"
        chmod +x "${APP_RESOURCES}/vibetunnel-fwd"
    else
        echo "error: Zig forwarder not found at ${NATIVE_DIR}/vibetunnel-fwd"
        exit 1
    fi
    
    if [ -f "${NATIVE_DIR}/pty.node" ]; then
        cp "${NATIVE_DIR}/pty.node" "${APP_RESOURCES}/"
    fi
    
    if [ -f "${NATIVE_DIR}/spawn-helper" ]; then
        cp "${NATIVE_DIR}/spawn-helper" "${APP_RESOURCES}/"
        chmod +x "${APP_RESOURCES}/spawn-helper"
    fi
    
    if [ -f "${NATIVE_DIR}/authenticate_pam.node" ]; then
        cp "${NATIVE_DIR}/authenticate_pam.node" "${APP_RESOURCES}/"
    fi
    
    if [ -f "${WEB_DIR}/bin/vt" ]; then
        cp "${WEB_DIR}/bin/vt" "${APP_RESOURCES}/"
        chmod +x "${APP_RESOURCES}/vt"
    fi
    
    echo "✓ Pre-built web artifacts copied successfully"
    exit 0
fi

# Read the current hash
if [ -f "${HASH_FILE}" ]; then
    CURRENT_HASH=$(cat "${HASH_FILE}")
else
    # If hash file doesn't exist, we need to rebuild
    # Generate a unique hash to force rebuild
    CURRENT_HASH="no-hash-file-$(date +%s)"
    echo "Hash file not found at ${HASH_FILE}. Will rebuild..."
fi

# Check if we need to rebuild
NEED_REBUILD=1

# Check if previous hash exists and matches current
if [ -f "${PREVIOUS_HASH_FILE}" ]; then
    PREVIOUS_HASH=$(cat "${PREVIOUS_HASH_FILE}")
    if [ "${CURRENT_HASH}" = "${PREVIOUS_HASH}" ]; then
        # Also check if the built files actually exist
        if [ -d "${DEST_DIR}" ] && [ -f "${APP_RESOURCES}/vibetunnel" ] && [ -f "${APP_RESOURCES}/pty.node" ] && [ -f "${APP_RESOURCES}/spawn-helper" ] && [ -f "${APP_RESOURCES}/vibetunnel-fwd" ]; then
            echo "Web content unchanged and build outputs exist. Skipping rebuild."
            NEED_REBUILD=0
        else
            echo "Web content unchanged but build outputs missing. Rebuilding..."
        fi
    else
        echo "Web content changed. Hash: ${PREVIOUS_HASH} -> ${CURRENT_HASH}"
    fi
else
    echo "No previous build hash found. Building web frontend..."
fi

if [ ${NEED_REBUILD} -eq 0 ]; then
    echo "Skipping web frontend build (no changes detected)"
    exit 0
fi

echo "Building web frontend..."

# Setup Node.js PATH (Homebrew, nvm, Volta, fnm)
SCRIPT_DIR="$( cd "$( dirname "$0" )" && pwd )"
# Set environment variable to use clean build environment
export VIBETUNNEL_BUILD_CLEAN_ENV=true
source "${SCRIPT_DIR}/node-path-setup.sh"

# Export CI to prevent interactive prompts
export CI=true

# Check if pnpm is available (skip in CI when web artifacts are pre-built)
if [ "${SKIP_NODE_CHECK}" = "true" ] && [ "${CI}" = "true" ]; then
    echo "✓ Skipping pnpm check in CI (web artifacts are pre-built)"
    echo "✓ This script should not be running in CI - web build should already be complete"
    exit 0
fi

if ! command -v pnpm &> /dev/null; then
    echo "error: pnpm not found. Please install pnpm"
    exit 1
fi

echo "Using pnpm version: $(pnpm --version)"
echo "Using Node.js version: $(node --version)"

# Check if web directory exists
if [ ! -d "${WEB_DIR}" ]; then
    echo "error: Web directory not found at ${WEB_DIR}"
    exit 1
fi

# Change to web directory
cd "${WEB_DIR}"

# Clean build artifacts
echo "Cleaning build artifacts..."
rm -rf dist public/bundle public/output.css native

# Install dependencies
echo "Installing dependencies..."
# For Xcode builds, ensure C++20 standard for native modules
export MACOSX_DEPLOYMENT_TARGET="14.0"
export CXXFLAGS="-std=c++20 -stdlib=libc++ -mmacosx-version-min=14.0"
export CXX="${CXX:-clang++}"
export CC="${CC:-clang}"

# Filter common non-actionable warnings from build output
filter_build_output() {
    # Allow bypassing filter with VERBOSE_BUILD environment variable
    if [ "${VERBOSE_BUILD:-false}" = "true" ]; then
        cat  # Pass through unfiltered
        return
    fi
    
    local patterns=(
        # C++ compiler warnings from node-gyp builds
        'missing field .* initializer'
        'expanded from macro'
        'converts to incompatible function type'
        'instantiation of function template'
        
        # Deprecation warnings
        'is deprecated.*Use.*instead'
        'has been explicitly marked deprecated'
        
        # npm/pnpm configuration warnings
        'npm warn Unknown.*config'
        
        # Tailwind CSS content configuration warnings
        'warn - Your.*content.*configuration'
        'warn - Pattern:.*\*\.js'
        'warn - See our documentation'
        
        # Build tool information messages
        'gyp info spawn args'
        '\.\.\.\/node_modules\/.*install:'
        
        # ESBuild bundle size warnings
        'exceeds recommended size limit'
        'This can impact web performance'
    )
    
    # Combine patterns with OR operator
    local pattern=$(IFS='|'; echo "${patterns[*]}")
    grep -v -E "$pattern" || true
}

# Run pnpm install with filtered output
pnpm install --frozen-lockfile 2>&1 | filter_build_output

# Determine build configuration
BUILD_CONFIG="${CONFIGURATION:-Debug}"
echo "Build configuration: $BUILD_CONFIG"

# Check for custom Node.js build
echo "Searching for custom Node.js builds..."

# Find all Node build directories
if [ -d "${WEB_DIR}/.node-builds" ]; then
    ALL_NODE_DIRS=$(find "${WEB_DIR}/.node-builds" -name "node-v*-minimal" -type d 2>/dev/null | sort -V)
else
    ALL_NODE_DIRS=""
fi
if [ -n "$ALL_NODE_DIRS" ]; then
    echo "Found Node.js build directories:"
    echo "$ALL_NODE_DIRS" | while read -r dir; do
        if [ -f "$dir/out/Release/node" ]; then
            VERSION=$(basename "$dir" | sed 's/node-v\(.*\)-minimal/\1/')
            echo "  ✓ $VERSION (complete build)"
        else
            VERSION=$(basename "$dir" | sed 's/node-v\(.*\)-minimal/\1/')
            echo "  ✗ $VERSION (incomplete build - missing binary)"
        fi
    done
fi

# Find directories with complete builds (containing the actual node binary)
if [ -d "${WEB_DIR}/.node-builds" ]; then
    CUSTOM_NODE_DIR=$(find "${WEB_DIR}/.node-builds" -name "node-v*-minimal" -type d -exec test -f {}/out/Release/node \; -print 2>/dev/null | sort -V | tail -n1)
else
    CUSTOM_NODE_DIR=""
fi
CUSTOM_NODE_PATH="${CUSTOM_NODE_DIR}/out/Release/node"

if [ -n "$CUSTOM_NODE_DIR" ]; then
    SELECTED_VERSION=$(basename "$CUSTOM_NODE_DIR" | sed 's/node-v\(.*\)-minimal/\1/')
    echo "Selected custom Node.js v$SELECTED_VERSION"
else
    echo "No complete custom Node.js builds found"
fi

# Build the web frontend
if [ "$BUILD_CONFIG" = "Release" ]; then
    echo "Release build - checking for custom Node.js..."
    
    # Skip custom Node.js build in CI to avoid timeout
    if [ "${CI:-false}" = "true" ]; then
        echo "CI environment detected - skipping custom Node.js build to avoid timeout"
        echo "The app will be larger than optimal but will build within CI time limits."
        pnpm run build 2>&1 | filter_build_output
    elif [ ! -f "$CUSTOM_NODE_PATH" ]; then
        echo "Custom Node.js not found, building it for optimal size..."
        echo "This will take 10-20 minutes on first run but will be cached."
        node build-custom-node.js --latest 2>&1 | filter_build_output
        if [ -d "${WEB_DIR}/.node-builds" ]; then
            CUSTOM_NODE_DIR=$(find "${WEB_DIR}/.node-builds" -name "node-v*-minimal" -type d -exec test -f {}/out/Release/node \; -print 2>/dev/null | sort -V | tail -n1)
        else
            CUSTOM_NODE_DIR=""
        fi
        CUSTOM_NODE_PATH="${CUSTOM_NODE_DIR}/out/Release/node"
    fi
    
    if [ "${CI:-false}" != "true" ] && [ -f "$CUSTOM_NODE_PATH" ]; then
        CUSTOM_NODE_VERSION=$("$CUSTOM_NODE_PATH" --version 2>/dev/null || echo "unknown")
        CUSTOM_NODE_SIZE=$(ls -lh "$CUSTOM_NODE_PATH" 2>/dev/null | awk '{print $5}' || echo "unknown")
        echo "Using custom Node.js for release build:"
        echo "  Version: $CUSTOM_NODE_VERSION"
        echo "  Size: $CUSTOM_NODE_SIZE (vs ~110MB for standard Node.js)"
        echo "  Path: $CUSTOM_NODE_PATH"
        pnpm run build -- --custom-node 2>&1 | filter_build_output
    else
        echo "WARNING: Custom Node.js build failed, using system Node.js"
        echo "The app will be larger than optimal."
        pnpm run build 2>&1 | filter_build_output
    fi
else
    # Debug build
    if [ -f "$CUSTOM_NODE_PATH" ]; then
        CUSTOM_NODE_VERSION=$("$CUSTOM_NODE_PATH" --version 2>/dev/null || echo "unknown")
        echo "Debug build - found existing custom Node.js $CUSTOM_NODE_VERSION, using it for consistency"
        pnpm run build -- --custom-node 2>&1 | filter_build_output
    else
        echo "Debug build - using system Node.js for faster builds"
        echo "System Node.js: $(node --version)"
        echo "To use custom Node.js in debug builds, run: cd web && node build-custom-node.js --latest"
        pnpm run build 2>&1 | filter_build_output
    fi
fi

# Clean and create destination directory
echo "Cleaning destination directory..."
rm -rf "${DEST_DIR}"
mkdir -p "${DEST_DIR}"

# Copy built files to Resources
echo "Copying web files to app bundle..."
cp -R "${PUBLIC_DIR}/"* "${DEST_DIR}/"

# Copy native executable and modules to app bundle
NATIVE_DIR="${WEB_DIR}/native"

if [ -f "${NATIVE_DIR}/vibetunnel" ]; then
    echo "Copying native executable to app bundle..."
    EXEC_SIZE=$(ls -lh "${NATIVE_DIR}/vibetunnel" | awk '{print $5}')
    echo "  Executable size: $EXEC_SIZE"
    cp "${NATIVE_DIR}/vibetunnel" "${APP_RESOURCES}/"
    chmod +x "${APP_RESOURCES}/vibetunnel"
else
    echo "error: Native executable not found at ${NATIVE_DIR}/vibetunnel"
    exit 1
fi

if [ -f "${NATIVE_DIR}/vibetunnel-fwd" ]; then
    echo "Copying zig forwarder..."
    cp "${NATIVE_DIR}/vibetunnel-fwd" "${APP_RESOURCES}/"
    chmod +x "${APP_RESOURCES}/vibetunnel-fwd"
else
    echo "error: Zig forwarder not found at ${NATIVE_DIR}/vibetunnel-fwd"
    exit 1
fi

if [ -f "${NATIVE_DIR}/pty.node" ]; then
    echo "Copying pty.node..."
    cp "${NATIVE_DIR}/pty.node" "${APP_RESOURCES}/"
else
    echo "error: pty.node not found"
    exit 1
fi

if [ -f "${NATIVE_DIR}/spawn-helper" ]; then
    echo "Copying spawn-helper..."
    cp "${NATIVE_DIR}/spawn-helper" "${APP_RESOURCES}/"
    chmod +x "${APP_RESOURCES}/spawn-helper"
else
    echo "error: spawn-helper not found"
    exit 1
fi

# Copy authenticate_pam.node if it exists
if [ -f "${NATIVE_DIR}/authenticate_pam.node" ]; then
    echo "Copying authenticate_pam.node..."
    cp "${NATIVE_DIR}/authenticate_pam.node" "${APP_RESOURCES}/"
else
    echo "Warning: authenticate_pam.node not found. PAM authentication may not work."
fi

# Copy unified vt script
if [ -f "${WEB_DIR}/bin/vt" ]; then
    echo "Copying unified vt script..."
    cp "${WEB_DIR}/bin/vt" "${APP_RESOURCES}/"
    chmod +x "${APP_RESOURCES}/vt"
else
    echo "error: Unified vt script not found at ${WEB_DIR}/bin/vt"
    exit 1
fi

echo "✓ Native executable, modules, and vt script copied successfully"

# Sanity check: Verify all required binaries are present in the app bundle
echo "Performing final sanity check..."

MISSING_FILES=()

# Check for vibetunnel executable
if [ ! -f "${APP_RESOURCES}/vibetunnel" ]; then
    MISSING_FILES+=("vibetunnel executable")
fi

# Check for pty.node
if [ ! -f "${APP_RESOURCES}/pty.node" ]; then
    MISSING_FILES+=("pty.node native module")
fi

# Check for spawn-helper (Unix only)
if [ ! -f "${APP_RESOURCES}/spawn-helper" ]; then
    MISSING_FILES+=("spawn-helper")
fi

# Check for zig forwarder
if [ ! -f "${APP_RESOURCES}/vibetunnel-fwd" ]; then
    MISSING_FILES+=("vibetunnel-fwd")
fi

# Check if vibetunnel is executable
if [ -f "${APP_RESOURCES}/vibetunnel" ] && [ ! -x "${APP_RESOURCES}/vibetunnel" ]; then
    MISSING_FILES+=("vibetunnel is not executable")
fi

# Check if spawn-helper is executable
if [ -f "${APP_RESOURCES}/spawn-helper" ] && [ ! -x "${APP_RESOURCES}/spawn-helper" ]; then
    MISSING_FILES+=("spawn-helper is not executable")
fi

# Check if vibetunnel-fwd is executable
if [ -f "${APP_RESOURCES}/vibetunnel-fwd" ] && [ ! -x "${APP_RESOURCES}/vibetunnel-fwd" ]; then
    MISSING_FILES+=("vibetunnel-fwd is not executable")
fi

# Check for vt script
if [ ! -f "${APP_RESOURCES}/vt" ]; then
    MISSING_FILES+=("vt script")
fi

# Check if vt script is executable
if [ -f "${APP_RESOURCES}/vt" ] && [ ! -x "${APP_RESOURCES}/vt" ]; then
    MISSING_FILES+=("vt script is not executable")
fi

# If any files are missing, fail the build
if [ ${#MISSING_FILES[@]} -gt 0 ]; then
    echo "error: Build sanity check failed! Missing required files:"
    for file in "${MISSING_FILES[@]}"; do
        echo "  - $file"
    done
    echo "Build artifacts in ${NATIVE_DIR}:"
    ls -la "${NATIVE_DIR}" || echo "  Directory does not exist"
    echo "App resources in ${APP_RESOURCES}:"
    ls -la "${APP_RESOURCES}/vibetunnel" "${APP_RESOURCES}/pty.node" "${APP_RESOURCES}/spawn-helper" "${APP_RESOURCES}/vt" 2>/dev/null || true
    exit 1
fi

# Verify the executable works
echo "Verifying vibetunnel executable..."
echo "Full path: ${APP_RESOURCES}/vibetunnel"
if "${APP_RESOURCES}/vibetunnel" version &>/dev/null; then
    VERSION_OUTPUT=$("${APP_RESOURCES}/vibetunnel" version 2>&1 | head -1)
    echo "✓ VibeTunnel executable verified: $VERSION_OUTPUT"
else
    echo "error: VibeTunnel executable failed verification (version command failed)"
    echo "Full executable path: ${APP_RESOURCES}/vibetunnel"
    echo "Checking if file exists and is executable:"
    ls -la "${APP_RESOURCES}/vibetunnel" || echo "File not found!"
    echo "Attempting to run with error output:"
    "${APP_RESOURCES}/vibetunnel" version 2>&1 || true
    exit 1
fi

echo "✓ All sanity checks passed"

# Save the current hash as the previous hash for next build
if [ -f "${HASH_FILE}" ]; then
    cp "${HASH_FILE}" "${PREVIOUS_HASH_FILE}"
else
    # If hash file doesn't exist, create it with the current hash value
    echo "${CURRENT_HASH}" > "${PREVIOUS_HASH_FILE}"
fi

echo "Web frontend build completed successfully"
