#!/bin/bash
#
# Validate Sparkle signatures are correct before release
#
# This script helps prevent the "improperly signed" error by verifying
# that signatures in appcast files match the actual DMG files.

set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
SPARKLE_PRIVATE_KEY_PATH="${SPARKLE_PRIVATE_KEY_PATH:-private/sparkle_private_key}"
EXPECTED_PUBLIC_KEY="AGCY8w5vHirVfGGDGc8Szc5iuOqupZSh9pMj/Qs67XI="

# Function to print colored output
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Check if sign_update is available
if ! command -v sign_update >/dev/null 2>&1; then
    print_error "sign_update not found in PATH"
    echo "Please install Sparkle tools or add them to PATH"
    exit 1
fi

# Verify private key exists
if [ ! -f "$SPARKLE_PRIVATE_KEY_PATH" ]; then
    print_error "Sparkle private key not found at: $SPARKLE_PRIVATE_KEY_PATH"
    exit 1
fi

print_info "Using private key at: $SPARKLE_PRIVATE_KEY_PATH"
print_info "Expected public key: $EXPECTED_PUBLIC_KEY"
echo

# Function to validate appcast file
validate_appcast() {
    local appcast_file=$1
    local channel_name=$2
    
    if [ ! -f "$appcast_file" ]; then
        print_warning "$appcast_file not found, skipping"
        return
    fi
    
    print_info "Validating $channel_name channel ($appcast_file)..."
    
    # Extract all DMG URLs and signatures from appcast
    local entries=$(grep -A 5 "<enclosure" "$appcast_file" | grep -E "(url=|sparkle:edSignature=)" | paste -d' ' - - | sed 's/.*url="\([^"]*\)".*/\1/' | sed 's/.*sparkle:edSignature="\([^"]*\)".*/\1/')
    
    local found_issues=0
    
    while IFS=' ' read -r dmg_url signature; do
        [ -z "$dmg_url" ] && continue
        
        # Extract filename from URL
        local dmg_filename=$(basename "$dmg_url")
        
        # Skip if not a DMG URL
        if [[ ! "$dmg_filename" =~ \.dmg$ ]]; then
            continue
        fi
        
        print_info "Checking $dmg_filename..."
        
        # Download DMG if not already present
        if [ ! -f "/tmp/$dmg_filename" ]; then
            print_info "  Downloading from GitHub..."
            if ! curl -sL "$dmg_url" -o "/tmp/$dmg_filename" 2>/dev/null; then
                print_error "  Failed to download $dmg_filename"
                ((found_issues++))
                continue
            fi
        fi
        
        # Generate signature with correct private key
        print_info "  Generating signature with file-based key..."
        local correct_signature=$(sign_update -f "$SPARKLE_PRIVATE_KEY_PATH" "/tmp/$dmg_filename" 2>/dev/null | grep "sparkle:edSignature" | sed 's/.*sparkle:edSignature="\([^"]*\)".*/\1/')
        
        if [ -z "$correct_signature" ]; then
            print_error "  Failed to generate signature for $dmg_filename"
            ((found_issues++))
            continue
        fi
        
        # Compare signatures
        if [ "$signature" = "$correct_signature" ]; then
            print_success "  ✓ Signature is correct"
        else
            print_error "  ✗ Signature mismatch!"
            echo "    Appcast has: $signature"
            echo "    Should be:   $correct_signature"
            ((found_issues++))
        fi
        
        # Clean up
        rm -f "/tmp/$dmg_filename"
    done < <(xmllint --format "$appcast_file" 2>/dev/null | grep -A 1 'url=".*\.dmg"' | grep -E "(url=|sparkle:edSignature=)" | paste -d' ' - - | sed 's/.*url="\([^"]*\)".*/\1 /' | sed 's/.*sparkle:edSignature="\([^"]*\)".*/\1/')
    
    if [ $found_issues -eq 0 ]; then
        print_success "✓ All signatures in $channel_name channel are correct!"
    else
        print_error "✗ Found $found_issues signature issues in $channel_name channel"
        return 1
    fi
}

# Function to test sign_update with different methods
test_signing_methods() {
    print_info "Testing different signing methods..."
    
    # Create a test file
    echo "test" > /tmp/sparkle_test.txt
    
    # Test with file-based key (correct)
    print_info "Testing with file-based key (-f flag)..."
    local file_sig=$(sign_update -f "$SPARKLE_PRIVATE_KEY_PATH" /tmp/sparkle_test.txt 2>/dev/null | grep "sparkle:edSignature" | sed 's/.*sparkle:edSignature="\([^"]*\)".*/\1/')
    
    # Test without -f flag (may use keychain)
    print_info "Testing without -f flag (may use keychain)..."
    local keychain_sig=$(sign_update /tmp/sparkle_test.txt 2>/dev/null | grep "sparkle:edSignature" | sed 's/.*sparkle:edSignature="\([^"]*\)".*/\1/')
    
    rm -f /tmp/sparkle_test.txt
    
    if [ -n "$file_sig" ]; then
        print_success "File-based key produces signature: ${file_sig:0:20}..."
    else
        print_error "Failed to generate signature with file-based key"
    fi
    
    if [ -n "$keychain_sig" ]; then
        print_warning "Keychain key produces signature: ${keychain_sig:0:20}..."
        
        if [ "$file_sig" != "$keychain_sig" ]; then
            print_error "⚠️  WARNING: Keychain has a DIFFERENT key than the file!"
            print_error "⚠️  ALWAYS use the -f flag to ensure correct signatures!"
        else
            print_info "Keychain and file keys match (this is good)"
        fi
    else
        print_info "No keychain key found (this is fine)"
    fi
    
    echo
}

# Main execution
main() {
    echo "=== Sparkle Signature Validation Tool ==="
    echo
    
    # Test signing methods
    test_signing_methods
    
    # Validate appcast files
    local exit_code=0
    
    if ! validate_appcast "../appcast.xml" "Stable"; then
        exit_code=1
    fi
    
    echo
    
    if ! validate_appcast "../appcast-prerelease.xml" "Pre-release"; then
        exit_code=1
    fi
    
    echo
    echo "=== Summary ==="
    
    if [ $exit_code -eq 0 ]; then
        print_success "All signatures are valid! ✅"
        print_info "Your appcast files are correctly signed."
    else
        print_error "Signature validation failed! ❌"
        print_warning "To fix:"
        echo "1. Download the DMG files from GitHub"
        echo "2. Generate correct signatures with:"
        echo "   sign_update -f $SPARKLE_PRIVATE_KEY_PATH [dmg-file]"
        echo "3. Update the appcast XML files with the correct signatures"
        echo "4. Commit and push the updated appcast files"
    fi
    
    exit $exit_code
}

# Run main function
main "$@"