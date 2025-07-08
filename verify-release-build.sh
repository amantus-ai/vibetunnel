#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "VibeTunnel Release Build Verification"
echo "====================================="

# Check if an app path was provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 /path/to/VibeTunnel.app"
    echo "Example: $0 /Applications/VibeTunnel.app"
    exit 1
fi

APP_PATH="$1"
ERRORS=0
WARNINGS=0

# Verify the app exists
if [ ! -d "$APP_PATH" ]; then
    echo -e "${RED}❌ ERROR: App not found at $APP_PATH${NC}"
    exit 1
fi

echo "Checking: $APP_PATH"
echo ""

# Function to check a binary for issues
check_binary() {
    local binary_path="$1"
    local binary_name=$(basename "$binary_path")
    
    echo "Checking $binary_name..."
    
    # Check for Thread Sanitizer
    if otool -L "$binary_path" 2>/dev/null | grep -q "libclang_rt.tsan"; then
        echo -e "${RED}❌ ERROR: Thread Sanitizer library found in $binary_name${NC}"
        ((ERRORS++))
    fi
    
    # Check for Address Sanitizer
    if otool -L "$binary_path" 2>/dev/null | grep -q "libclang_rt.asan"; then
        echo -e "${RED}❌ ERROR: Address Sanitizer library found in $binary_name${NC}"
        ((ERRORS++))
    fi
    
    # Check for Undefined Behavior Sanitizer
    if otool -L "$binary_path" 2>/dev/null | grep -q "libclang_rt.ubsan"; then
        echo -e "${RED}❌ ERROR: Undefined Behavior Sanitizer library found in $binary_name${NC}"
        ((ERRORS++))
    fi
    
    # Check for Homebrew dependencies
    local homebrew_deps=$(otool -L "$binary_path" 2>/dev/null | grep -E "/opt/homebrew|/usr/local/Cellar" || true)
    if [ -n "$homebrew_deps" ]; then
        echo -e "${RED}❌ ERROR: Homebrew dependencies found in $binary_name:${NC}"
        echo "$homebrew_deps"
        ((ERRORS++))
    fi
    
    # Check for debug symbols (for main app binary)
    if [[ "$binary_name" == "VibeTunnel" ]]; then
        # Check if binary was built with debug configuration
        if nm -a "$binary_path" 2>/dev/null | grep -q "_NSZombieEnabled"; then
            echo -e "${YELLOW}⚠️  WARNING: Binary may contain debug code (NSZombie references found)${NC}"
            ((WARNINGS++))
        fi
    fi
}

# 1. Check main app binary
echo "1. Main App Binary"
echo "------------------"
MAIN_BINARY="$APP_PATH/Contents/MacOS/VibeTunnel"
if [ -f "$MAIN_BINARY" ]; then
    check_binary "$MAIN_BINARY"
else
    echo -e "${RED}❌ ERROR: Main binary not found${NC}"
    ((ERRORS++))
fi

# 2. Check for sanitizer libraries in Frameworks
echo ""
echo "2. Checking Frameworks"
echo "---------------------"
FRAMEWORKS_DIR="$APP_PATH/Contents/Frameworks"
if [ -d "$FRAMEWORKS_DIR" ]; then
    SANITIZER_LIBS=$(find "$FRAMEWORKS_DIR" -name "*clang_rt*san*" -o -name "*asan*" -o -name "*tsan*" -o -name "*ubsan*" 2>/dev/null || true)
    if [ -n "$SANITIZER_LIBS" ]; then
        echo -e "${RED}❌ ERROR: Sanitizer libraries found in Frameworks:${NC}"
        echo "$SANITIZER_LIBS"
        ((ERRORS++))
    else
        echo -e "${GREEN}✅ No sanitizer libraries in Frameworks${NC}"
    fi
else
    echo "No Frameworks directory found"
fi

# 3. Check vibetunnel server binary
echo ""
echo "3. VibeTunnel Server Binary"
echo "--------------------------"
SERVER_BINARY="$APP_PATH/Contents/Resources/vibetunnel"
if [ -f "$SERVER_BINARY" ]; then
    check_binary "$SERVER_BINARY"
    
    # Check size (debug builds are often larger)
    SIZE_MB=$(ls -lh "$SERVER_BINARY" | awk '{print $5}')
    echo "Binary size: $SIZE_MB"
    
    # Get size in bytes for comparison
    SIZE_BYTES=$(stat -f%z "$SERVER_BINARY" 2>/dev/null || stat -c%s "$SERVER_BINARY" 2>/dev/null)
    if [ "$SIZE_BYTES" -gt 157286400 ]; then  # 150 MB
        echo -e "${YELLOW}⚠️  WARNING: Binary size exceeds 150MB, might be a debug build${NC}"
        ((WARNINGS++))
    fi
else
    echo -e "${RED}❌ ERROR: Server binary not found${NC}"
    ((ERRORS++))
fi

# 4. Check native modules
echo ""
echo "4. Native Modules"
echo "----------------"
for module in pty.node authenticate_pam.node spawn-helper; do
    MODULE_PATH="$APP_PATH/Contents/Resources/$module"
    if [ -f "$MODULE_PATH" ]; then
        check_binary "$MODULE_PATH"
    else
        echo -e "${YELLOW}⚠️  WARNING: $module not found${NC}"
        ((WARNINGS++))
    fi
done

# 5. Check build configuration (if Info.plist contains debug info)
echo ""
echo "5. Build Configuration"
echo "--------------------"
INFO_PLIST="$APP_PATH/Contents/Info.plist"
if [ -f "$INFO_PLIST" ]; then
    # Check for common debug keys
    if plutil -p "$INFO_PLIST" 2>/dev/null | grep -qi "debug"; then
        echo -e "${YELLOW}⚠️  WARNING: Info.plist may contain debug configuration${NC}"
        ((WARNINGS++))
    else
        echo -e "${GREEN}✅ No obvious debug configuration in Info.plist${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  WARNING: Info.plist not found${NC}"
    ((WARNINGS++))
fi

# 6. Check code signature
echo ""
echo "6. Code Signature"
echo "----------------"
CODESIGN_INFO=$(codesign -dvvv "$APP_PATH" 2>&1 || true)
if echo "$CODESIGN_INFO" | grep -q "Authority="; then
    echo -e "${GREEN}✅ App is signed${NC}"
    # Check if it's a development certificate
    if echo "$CODESIGN_INFO" | grep -q "Developer ID"; then
        echo -e "${GREEN}✅ Signed with Developer ID (release)${NC}"
    elif echo "$CODESIGN_INFO" | grep -q "Apple Development"; then
        echo -e "${YELLOW}⚠️  WARNING: Signed with development certificate${NC}"
        ((WARNINGS++))
    fi
else
    echo -e "${YELLOW}⚠️  WARNING: App is not signed${NC}"
    ((WARNINGS++))
fi

# Summary
echo ""
echo "====================================="
echo "Verification Summary"
echo "====================================="

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✅ All checks passed! This appears to be a valid release build.${NC}"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠️  Build has $WARNINGS warning(s) but no critical errors.${NC}"
    echo "Review the warnings above to ensure they're acceptable."
    exit 0
else
    echo -e "${RED}❌ Build has $ERRORS error(s) and $WARNINGS warning(s).${NC}"
    echo "This build should NOT be released!"
    exit 1
fi