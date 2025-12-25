#!/usr/bin/env bash
# Rebuild + restart VibeTunnel macOS app (signed build).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAC_DIR="${ROOT_DIR}/mac"
APP_NAME="VibeTunnel"
APP_PROCESS_PATTERN="${APP_NAME}.app/Contents/MacOS/${APP_NAME}"

log() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

kill_all_vibetunnel() {
  for _ in {1..10}; do
    pkill -f "${APP_PROCESS_PATTERN}" 2>/dev/null || true
    pkill -x "${APP_NAME}" 2>/dev/null || true
    if ! pgrep -f "${APP_PROCESS_PATTERN}" >/dev/null 2>&1 && ! pgrep -x "${APP_NAME}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.3
  done
}

log "==> Killing existing ${APP_NAME} instances"
kill_all_vibetunnel

log "==> Building (Debug, signed)"
(
  cd "${MAC_DIR}"
  USE_CUSTOM_DERIVED_DATA=true ./scripts/build.sh --configuration Debug
)

APP_BUNDLE="${MAC_DIR}/build/Build/Products/Debug/${APP_NAME}.app"
if [[ ! -d "${APP_BUNDLE}" ]]; then
  fail "App bundle not found: ${APP_BUNDLE}"
fi

log "==> Verifying code signature"
codesign --verify --verbose=2 "${APP_BUNDLE}" >/dev/null 2>&1 || fail "codesign verify failed"

log "==> Launching ${APP_BUNDLE}"
# Avoid leaking huge shell env to LaunchServices.
env -i \
  HOME="${HOME}" \
  USER="${USER:-$(id -un)}" \
  LOGNAME="${LOGNAME:-$(id -un)}" \
  TMPDIR="${TMPDIR:-/tmp}" \
  PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
  LANG="${LANG:-en_US.UTF-8}" \
  /usr/bin/open "${APP_BUNDLE}"

sleep 1.5
if pgrep -f "${APP_PROCESS_PATTERN}" >/dev/null 2>&1; then
  log "OK: ${APP_NAME} is running."
else
  fail "App exited immediately. Check Console.app (User Reports)."
fi

