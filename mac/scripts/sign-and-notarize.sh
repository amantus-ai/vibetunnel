#!/bin/bash
# sign-and-notarize.sh - Comprehensive code signing and notarization script for VibeTunnel
# 
# This script handles the full process of:
# 1. Code signing with hardened runtime
# 2. Notarization with Apple
# 3. Stapling the notarization ticket
# 4. Creating distributable ZIP archives

set -euo pipefail

# Get script directory and ensure we're in the right location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." &> /dev/null && pwd)" 
cd "$APP_DIR" || { echo "Error: Failed to change directory to $APP_DIR"; exit 1; }

# Initialize variables with defaults
BUNDLE_DIR="build/Build/Products/Release/VibeTunnel.app"
APP_BUNDLE_PATH="$APP_DIR/$BUNDLE_DIR"
ZIP_PATH="$APP_DIR/build/VibeTunnel-notarize.zip"
FINAL_ZIP_PATH="$APP_DIR/build/VibeTunnel-notarized.zip"
MAX_RETRIES=3
RETRY_DELAY=30
TIMEOUT_MINUTES=30

# Operation flags - what parts of the process to run
DO_SIGNING=true
DO_NOTARIZATION=false
CREATE_ZIP=true
SKIP_STAPLE=false
VERBOSE=false

# Log helper function with timestamp
log() {
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] $1"
}

# Error logging
error() {
    log "❌ ERROR: $1"
    return 1
}

# Success logging
success() {
    log "✅ $1"
}

# Print usage information
print_usage() {
    echo "Sign and Notarize Script for VibeTunnel Mac App"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Authentication Options (required for notarization):"
    echo "  --api-key-p8 KEY        App Store Connect API key content (.p8)"
    echo "  --api-key-id ID         App Store Connect API Key ID"
    echo "  --api-key-issuer ID     App Store Connect API Key Issuer ID"
    echo ""
    echo "Process Control Options:"
    echo "  --sign-only             Only perform code signing, skip notarization"
    echo "  --notarize-only         Skip signing and only perform notarization"
    echo "  --sign-and-notarize     Perform both signing and notarization (default if credentials provided)"
    echo ""
    echo "General Options:"
    echo "  --app-path PATH         Path to the app bundle (default: $BUNDLE_DIR)"
    echo "  --identity ID           Developer ID certificate to use for signing"
    echo "  --skip-staple           Skip stapling the notarization ticket to the app"
    echo "  --no-zip                Skip creating distributable ZIP archive"
    echo "  --timeout MINUTES       Notarization timeout in minutes (default: 30)"
    echo "  --verbose               Enable verbose output"
    echo "  --help                  Show this help message"
}

# Function to read credentials from environment and arguments
read_credentials() {
    # Initialize with existing environment variables
    local api_key_p8="${APP_STORE_CONNECT_API_KEY_P8:-}"
    local api_key_id="${APP_STORE_CONNECT_KEY_ID:-}"
    local api_key_issuer="${APP_STORE_CONNECT_ISSUER_ID:-}"
    local sign_identity="${SIGN_IDENTITY:-Developer ID Application}"
    
    # Save original arguments for explicit flag detection
    local original_args=("$@")
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            # Authentication options
            --api-key-p8)
                api_key_p8="$2"
                shift 2
                ;;
            --api-key-id)
                api_key_id="$2"
                shift 2
                ;;
            --api-key-issuer)
                api_key_issuer="$2"
                shift 2
                ;;
            --identity)
                sign_identity="$2"
                shift 2
                ;;
                
            # Process control options
            --sign-only)
                DO_SIGNING=true
                DO_NOTARIZATION=false
                shift
                ;;
            --notarize-only)
                DO_SIGNING=false
                DO_NOTARIZATION=true
                shift
                ;;
            --sign-and-notarize)
                DO_SIGNING=true
                DO_NOTARIZATION=true
                shift
                ;;
                
            # General options
            --app-path)
                APP_BUNDLE_PATH="$2"
                BUNDLE_DIR="$(basename "$APP_BUNDLE_PATH")"
                shift 2
                ;;
            --skip-staple)
                SKIP_STAPLE=true
                shift
                ;;
            --no-zip)
                CREATE_ZIP=false
                shift
                ;;
            --timeout)
                TIMEOUT_MINUTES="$2"
                shift 2
                ;;
            --verbose)
                VERBOSE=true
                shift
                ;;
            --help)
                print_usage
                exit 0
                ;;
            *)
                shift
                ;;
        esac
    done
    
    # Export as environment variables
    export APP_STORE_CONNECT_API_KEY_P8="$api_key_p8"
    export APP_STORE_CONNECT_KEY_ID="$api_key_id"
    export APP_STORE_CONNECT_ISSUER_ID="$api_key_issuer"
    export SIGN_IDENTITY="$sign_identity"
    
    # If notarization credentials are available and no explicit flags were set, enable notarization
    if [ -n "$api_key_p8" ] && [ -n "$api_key_id" ] && [ -n "$api_key_issuer" ]; then
        # Only auto-enable notarization if no explicit process control flag was provided
        local explicit_flag_provided=false
        for arg in "${original_args[@]}"; do
            case "$arg" in
                --sign-only|--notarize-only|--sign-and-notarize)
                    explicit_flag_provided=true
                    break
                    ;;
            esac
        done
        
        if [ "$explicit_flag_provided" = false ] && [ "$DO_NOTARIZATION" = false ] && [ "$DO_SIGNING" = true ]; then
            DO_NOTARIZATION=true
            log "Notarization credentials detected. Will perform both signing and notarization."
        fi
    fi
}

# Retry function for operations that might fail
retry_operation() {
    local cmd="$1"
    local desc="$2"
    local attempt=1
    local result
    
    while [ $attempt -le $MAX_RETRIES ]; do
        log "Attempt $attempt/$MAX_RETRIES: $desc"
        if result=$(eval "$cmd" 2>&1); then
            echo "$result"
            return 0
        else
            local exit_code=$?
            log "Attempt $attempt failed (exit code: $exit_code)"
            if [ "$VERBOSE" = "true" ]; then
                log "Command output: $result"
            fi
            
            if [ $attempt -lt $MAX_RETRIES ]; then
                log "Retrying in $RETRY_DELAY seconds..."
                sleep $RETRY_DELAY
            fi
        fi
        attempt=$((attempt + 1))
    done
    
    error "Failed after $MAX_RETRIES attempts: $desc"
    echo "$result"
    return 1
}

# Function to perform code signing
perform_signing() {
    log "Starting code signing process for VibeTunnel..."
    
    # Check if the app bundle exists
    if [ ! -d "$APP_BUNDLE_PATH" ]; then
        error "App bundle not found at $APP_BUNDLE_PATH"
        log "Please build the app first by running ./scripts/build.sh"
        exit 1
    fi
    
    log "Found app bundle at $APP_BUNDLE_PATH"
    
    # Call the codesign script
    if ! "$SCRIPT_DIR/codesign-app.sh" "$APP_BUNDLE_PATH" "$SIGN_IDENTITY"; then
        error "Code signing failed"
        exit 1
    fi
    
    success "Code signing completed successfully!"
}

# Function to perform app notarization
perform_notarization() {
    log "Starting notarization process for VibeTunnel..."
    
    # Check for authentication requirements
    MISSING_VARS=()
    [ -z "${APP_STORE_CONNECT_API_KEY_P8:-}" ] && MISSING_VARS+=("APP_STORE_CONNECT_API_KEY_P8")
    [ -z "${APP_STORE_CONNECT_KEY_ID:-}" ] && MISSING_VARS+=("APP_STORE_CONNECT_KEY_ID")
    [ -z "${APP_STORE_CONNECT_ISSUER_ID:-}" ] && MISSING_VARS+=("APP_STORE_CONNECT_ISSUER_ID")
    
    if [ ${#MISSING_VARS[@]} -gt 0 ]; then
        error "Missing required variables for notarization: ${MISSING_VARS[*]}"
        log "Please provide --api-key-p8, --api-key-id, and --api-key-issuer options"
        log "or set the corresponding environment variables."
        exit 1
    fi
    
    # Ensure app is signed if needed
    if [ "$DO_SIGNING" = true ] || ! codesign --verify --verbose=1 "$APP_BUNDLE_PATH" &>/dev/null; then
        log "Signing needs to be performed before notarization..."
        perform_signing
    else
        log "App already properly signed, skipping signing step"
    fi
    
    # Call the notarization script
    if ! "$SCRIPT_DIR/notarize-app.sh" "$APP_BUNDLE_PATH"; then
        error "Notarization failed"
        exit 1
    fi
    
    success "Notarization completed successfully!"
    
    # Create distributable ZIP archive if needed
    if [ "$CREATE_ZIP" = true ]; then
        log "Creating distributable ZIP archive..."
        rm -f "$FINAL_ZIP_PATH" # Remove existing zip if any
        mkdir -p "$(dirname "$FINAL_ZIP_PATH")"
        if ! ditto -c -k --keepParent "$APP_BUNDLE_PATH" "$FINAL_ZIP_PATH"; then
            error "Failed to create ZIP archive"
        else
            success "Distributable ZIP archive created: $FINAL_ZIP_PATH"
            # Calculate file size and hash for verification
            ZIP_SIZE=$(du -h "$FINAL_ZIP_PATH" | cut -f1)
            ZIP_SHA=$(shasum -a 256 "$FINAL_ZIP_PATH" | cut -d' ' -f1)
            log "ZIP archive size: $ZIP_SIZE"
            log "ZIP SHA-256 hash: $ZIP_SHA"
        fi
    fi
}

# Main execution starts here
log "Starting sign and notarize script for VibeTunnel..."

# Read credentials from all possible sources
read_credentials "$@"

# Check if the app bundle exists
if [ ! -d "$APP_BUNDLE_PATH" ]; then
    error "App bundle not found at $APP_BUNDLE_PATH"
    log "Please build the app first by running ./scripts/build.sh"
    exit 1
fi

log "Found app bundle at $APP_BUNDLE_PATH"

# Check if we should do code signing
if [ "$DO_SIGNING" = true ]; then
    perform_signing
else
    log "Skipping code signing as requested"
fi

# Check if we should do notarization
if [ "$DO_NOTARIZATION" = true ]; then
    perform_notarization
else
    log "Skipping notarization as requested"
    
    # Create a simple ZIP file if signing only and zip creation is requested
    if [ "$DO_SIGNING" = true ] && [ "$CREATE_ZIP" = true ]; then
        log "Creating distributable ZIP archive after signing..."
        mkdir -p "$(dirname "$FINAL_ZIP_PATH")"
        if ! ditto -c -k --keepParent "$APP_BUNDLE_PATH" "$FINAL_ZIP_PATH"; then
            error "Failed to create ZIP archive"
        else
            success "Distributable ZIP archive created: $FINAL_ZIP_PATH"
            ZIP_SIZE=$(du -h "$FINAL_ZIP_PATH" | cut -f1)
            ZIP_SHA=$(shasum -a 256 "$FINAL_ZIP_PATH" | cut -d' ' -f1)
            log "ZIP archive size: $ZIP_SIZE"
            log "ZIP SHA-256 hash: $ZIP_SHA"
        fi
    fi
fi

# Print final status summary
log ""
log "Operation summary:"
log "✅ App bundle: $APP_BUNDLE_PATH"
if [ "$DO_SIGNING" = true ]; then
    log "✅ Code signing: Completed"
fi
if [ "$DO_NOTARIZATION" = true ]; then
    log "✅ Notarization: Completed"
    if [ "$SKIP_STAPLE" = false ]; then
        log "✅ Stapling: Completed (users can run without security warnings)"
    else
        log "⚠️ Stapling: Skipped"
    fi
fi
if [ "$CREATE_ZIP" = true ] && [ -f "$FINAL_ZIP_PATH" ]; then
    log "✅ Distributable ZIP archive: $FINAL_ZIP_PATH"
fi

success "Script completed successfully!"