#!/bin/bash

# Script to check Xcode project settings for potential release issues

echo "Checking Xcode Project Settings"
echo "==============================="

ERRORS=0
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Check for Thread Sanitizer in xcscheme files
echo "1. Checking for Thread Sanitizer..."
SCHEME_FILES=$(find "$PROJECT_DIR" -name "*.xcscheme" 2>/dev/null)

for scheme in $SCHEME_FILES; do
    if grep -q "enableThreadSanitizer.*YES" "$scheme" 2>/dev/null; then
        echo "❌ ERROR: Thread Sanitizer is enabled in $(basename "$scheme")"
        echo "   File: $scheme"
        ((ERRORS++))
    fi
done

if [ $ERRORS -eq 0 ]; then
    echo "✅ Thread Sanitizer is not enabled"
fi

# Check for Address Sanitizer
echo ""
echo "2. Checking for Address Sanitizer..."
ASAN_ERRORS=0
for scheme in $SCHEME_FILES; do
    if grep -q "enableAddressSanitizer.*YES" "$scheme" 2>/dev/null; then
        echo "❌ ERROR: Address Sanitizer is enabled in $(basename "$scheme")"
        echo "   File: $scheme"
        ((ASAN_ERRORS++))
    fi
    if grep -q "enableASanStackUseAfterReturn.*YES" "$scheme" 2>/dev/null; then
        echo "❌ ERROR: ASan Stack Use After Return is enabled in $(basename "$scheme")"
        echo "   File: $scheme"
        ((ASAN_ERRORS++))
    fi
done

ERRORS=$((ERRORS + ASAN_ERRORS))
if [ $ASAN_ERRORS -eq 0 ]; then
    echo "✅ Address Sanitizer is not enabled"
fi

# Check for UB Sanitizer
echo ""
echo "3. Checking for Undefined Behavior Sanitizer..."
UBSAN_ERRORS=0
for scheme in $SCHEME_FILES; do
    if grep -q "enableUBSanitizer.*YES" "$scheme" 2>/dev/null; then
        echo "❌ ERROR: Undefined Behavior Sanitizer is enabled in $(basename "$scheme")"
        echo "   File: $scheme"
        ((UBSAN_ERRORS++))
    fi
done

ERRORS=$((ERRORS + UBSAN_ERRORS))
if [ $UBSAN_ERRORS -eq 0 ]; then
    echo "✅ Undefined Behavior Sanitizer is not enabled"
fi

# Check for NSZombie
echo ""
echo "4. Checking for NSZombieEnabled..."
ZOMBIE_ERRORS=0
for scheme in $SCHEME_FILES; do
    if grep -q "NSZombieEnabled.*YES" "$scheme" 2>/dev/null; then
        echo "❌ ERROR: NSZombieEnabled is set in $(basename "$scheme")"
        echo "   File: $scheme"
        ((ZOMBIE_ERRORS++))
    fi
done

ERRORS=$((ERRORS + ZOMBIE_ERRORS))
if [ $ZOMBIE_ERRORS -eq 0 ]; then
    echo "✅ NSZombieEnabled is not set"
fi

# Check build configuration in project.pbxproj
echo ""
echo "5. Checking Release configuration..."
PBXPROJ="$PROJECT_DIR/VibeTunnel.xcodeproj/project.pbxproj"

if [ -f "$PBXPROJ" ]; then
    # This is a simple check - a more thorough check would parse the file properly
    if grep -q "ENABLE_TESTABILITY.*YES.*Release" "$PBXPROJ" 2>/dev/null; then
        echo "⚠️  WARNING: Testability might be enabled in Release configuration"
    else
        echo "✅ Release configuration looks OK"
    fi
else
    echo "⚠️  WARNING: Could not find project.pbxproj"
fi

# Summary
echo ""
echo "==============================="
if [ $ERRORS -eq 0 ]; then
    echo "✅ All Xcode settings checks passed!"
    exit 0
else
    echo "❌ Found $ERRORS error(s) in Xcode settings!"
    echo "These settings must be disabled for release builds."
    exit 1
fi