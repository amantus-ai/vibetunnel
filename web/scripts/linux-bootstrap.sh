#!/usr/bin/env bash
set -euo pipefail

# Ubuntu-focused bootstrap for VibeTunnel web build on Linux

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    echo "sudo required (or run as root)"
    exit 1
  fi
fi

${SUDO} apt-get update -qq
${SUDO} apt-get install -y -qq \
  curl \
  ca-certificates \
  xz-utils \
  python3 \
  make \
  g++ \
  git \
  libpam0g-dev \
  > /dev/null

# Node.js 24.x via NodeSource if missing or too old
need_node=1
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  node_minor="$(node -p 'process.versions.node.split(".")[1]')"
  if [ "$node_major" -gt 22 ] || { [ "$node_major" -eq 22 ] && [ "$node_minor" -ge 12 ]; }; then
    need_node=0
  fi
fi

if [ "$need_node" -eq 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | ${SUDO} bash - >/dev/null
  ${SUDO} apt-get install -y -qq nodejs > /dev/null
fi

# Zig (latest stable) if missing
if ! command -v zig >/dev/null 2>&1; then
  arch="$(uname -m)"
  case "$arch" in
    aarch64|arm64) export ZIG_TARGET="aarch64-linux";;
    x86_64|amd64) export ZIG_TARGET="x86_64-linux";;
    *) echo "unsupported arch: $arch"; exit 1;;
  esac

  zig_url="$(python3 - <<'PY'
import json, urllib.request, os, sys

target = os.environ.get('ZIG_TARGET')
data = json.load(urllib.request.urlopen('https://ziglang.org/download/index.json'))
versions = [k for k in data.keys() if k and k[0].isdigit()]

def parse(v):
  try:
    return tuple(int(x) for x in v.split('.'))
  except Exception:
    return (0,)

versions.sort(key=parse, reverse=True)
for v in versions:
  entry = data[v]
  if target in entry:
    print(entry[target]['tarball'])
    sys.exit(0)
print('')
PY
)"

  if [ -z "$zig_url" ]; then
    echo "failed to resolve Zig download URL"
    exit 1
  fi

  zig_root="$HOME/.local/zig"
  zig_bin="$HOME/.local/bin"
  if [ -n "$SUDO" ]; then
    zig_root="/usr/local/zig"
    zig_bin="/usr/local/bin"
  fi

  ${SUDO} mkdir -p "$zig_root"
  ${SUDO} mkdir -p "$zig_bin"
  curl -sL "$zig_url" -o /tmp/zig.tar.xz
  ${SUDO} tar -xf /tmp/zig.tar.xz -C "$zig_root" --strip-components=1
  ${SUDO} ln -sf "$zig_root/zig" "$zig_bin/zig"
fi

node -v
npm -v
zig version

echo "\nNext steps:"
echo "  cd web"
echo "  npm install"
echo "  npm run build"
