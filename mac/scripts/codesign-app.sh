#!/usr/bin/env bash
# codesign-app.sh - Code signing script for VibeTunnel (Sparkle-safe; no --deep)

set -euo pipefail

APP_BUNDLE="${1:-build/Build/Products/Release/VibeTunnel.app}"
SIGN_IDENTITY="${2:-${SIGN_IDENTITY:-}}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

if [[ ! -d "$APP_BUNDLE" ]]; then
  fail "App bundle not found: $APP_BUNDLE"
fi

select_identity() {
  local preferred available first

  preferred="$(security find-identity -p codesigning -v 2>/dev/null \
    | awk -F'\"' '/Developer ID Application/ { print $2; exit }')"
  if [[ -n "$preferred" ]]; then
    printf '%s\n' "$preferred"
    return 0
  fi

  available="$(security find-identity -p codesigning -v 2>/dev/null | sed -n 's/.*\"\\(.*\\)\"/\\1/p')"
  if [[ -n "$available" ]]; then
    first="$(printf '%s\n' "$available" | head -n1)"
    printf '%s\n' "$first"
    return 0
  fi

  return 1
}

if [[ -z "$SIGN_IDENTITY" ]]; then
  if SIGN_IDENTITY="$(select_identity)"; then
    log "Using signing identity: $SIGN_IDENTITY"
  else
    SIGN_IDENTITY="-"
    log "No signing identity found; falling back to ad-hoc signing (-)"
  fi
else
  log "Using signing identity (explicit): $SIGN_IDENTITY"
fi

TIMESTAMP_FLAG="--timestamp=none"
if [[ "${CODESIGN_TIMESTAMP:-}" == "1" ]]; then
  TIMESTAMP_FLAG="--timestamp"
fi
if [[ "$SIGN_IDENTITY" == "-" ]]; then
  TIMESTAMP_FLAG="--timestamp=none"
fi

KEYCHAIN_OPTS=""
if [[ -n "${KEYCHAIN_NAME:-}" ]]; then
  KEYCHAIN_OPTS="--keychain $KEYCHAIN_NAME"
  log "Using keychain: $KEYCHAIN_NAME"
fi

ENTITLEMENTS_FILE="VibeTunnel/VibeTunnel.entitlements"
TMP_ENTITLEMENTS="$(mktemp -t vibetunnel-entitlements.XXXXXX)"

BUNDLE_ID="$(defaults read "$APP_BUNDLE/Contents/Info.plist" CFBundleIdentifier 2>/dev/null || echo "sh.vibetunnel.vibetunnel")"
log "Bundle identifier: $BUNDLE_ID"

if [[ -f "$ENTITLEMENTS_FILE" ]]; then
  sed -e 's/$(PRODUCT_BUNDLE_IDENTIFIER)/'"$BUNDLE_ID"'/g' "$ENTITLEMENTS_FILE" > "$TMP_ENTITLEMENTS"
else
  fail "Entitlements file not found: $ENTITLEMENTS_FILE"
fi

log "Preparing bundle for signing (xattr -cr)"
xattr -cr "$APP_BUNDLE" 2>/dev/null || true

sign_plain() {
  local target="$1"
  codesign --force --options runtime $TIMESTAMP_FLAG --sign "$SIGN_IDENTITY" $KEYCHAIN_OPTS "$target"
}

sign_with_entitlements() {
  local target="$1"
  codesign --force --options runtime $TIMESTAMP_FLAG --entitlements "$TMP_ENTITLEMENTS" --sign "$SIGN_IDENTITY" $KEYCHAIN_OPTS "$target"
}

# Sparkle: sign nested code explicitly (avoid --deep).
SPARKLE="$APP_BUNDLE/Contents/Frameworks/Sparkle.framework"
if [[ -d "$SPARKLE" ]]; then
  log "Signing Sparkle framework + helpers"
  sign_plain "$SPARKLE/Versions/B/Sparkle"
  sign_plain "$SPARKLE/Versions/B/Autoupdate"
  sign_plain "$SPARKLE/Versions/B/Updater.app/Contents/MacOS/Updater"
  sign_plain "$SPARKLE/Versions/B/Updater.app"
  sign_plain "$SPARKLE/Versions/B/XPCServices/Downloader.xpc/Contents/MacOS/Downloader"
  sign_plain "$SPARKLE/Versions/B/XPCServices/Downloader.xpc"
  sign_plain "$SPARKLE/Versions/B/XPCServices/Installer.xpc/Contents/MacOS/Installer"
  sign_plain "$SPARKLE/Versions/B/XPCServices/Installer.xpc"
  sign_plain "$SPARKLE/Versions/B"
  sign_plain "$SPARKLE"
fi

if [[ -d "$APP_BUNDLE/Contents/Frameworks" ]]; then
  log "Signing embedded frameworks/dylibs"
  find "$APP_BUNDLE/Contents/Frameworks" \( -name "*.framework" -o -name "*.dylib" \) ! -path "*Sparkle.framework*" -print0 \
    | while IFS= read -r -d '' item; do
      sign_plain "$item"
    done
fi

if [[ -d "$APP_BUNDLE/Contents/Resources" ]]; then
  VIBETUNNEL_ENTITLEMENTS="$(dirname "$0")/../VibeTunnel/vibetunnel-binary.entitlements"

  if [[ -f "$APP_BUNDLE/Contents/Resources/vibetunnel" ]]; then
    log "Signing embedded vibetunnel binary with JIT entitlements"
    codesign --force --options runtime $TIMESTAMP_FLAG --sign "$SIGN_IDENTITY" --entitlements "$VIBETUNNEL_ENTITLEMENTS" $KEYCHAIN_OPTS "$APP_BUNDLE/Contents/Resources/vibetunnel"
  fi

  if [[ -f "$APP_BUNDLE/Contents/Resources/vibetunnel-fwd" ]]; then
    log "Signing vibetunnel-fwd with entitlements"
    codesign --force --options runtime $TIMESTAMP_FLAG --sign "$SIGN_IDENTITY" --entitlements "$VIBETUNNEL_ENTITLEMENTS" $KEYCHAIN_OPTS "$APP_BUNDLE/Contents/Resources/vibetunnel-fwd"
  fi
fi

log "Signing main executable"
sign_with_entitlements "$APP_BUNDLE/Contents/MacOS/VibeTunnel"

log "Signing app bundle (no --deep)"
sign_with_entitlements "$APP_BUNDLE"

log "Verifying code signature"
codesign --verify --verbose=2 "$APP_BUNDLE" >/dev/null 2>&1 || fail "codesign verify failed"

rm -f "$TMP_ENTITLEMENTS"
log "Codesign complete for $APP_BUNDLE"
