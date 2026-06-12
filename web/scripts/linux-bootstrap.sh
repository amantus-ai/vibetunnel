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

# Checksum-verified Node.js 24.x release if missing or too old.
need_node=1
if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  node_minor="$(node -p 'process.versions.node.split(".")[1]')"
  if [ "$node_major" -gt 22 ] || { [ "$node_major" -eq 22 ] && [ "$node_minor" -ge 12 ]; }; then
    need_node=0
  fi
fi

if [ "$need_node" -eq 1 ]; then
  NODE_VERSION="24.16.0"
  arch="$(uname -m)"
  case "$arch" in
    aarch64|arm64)
      node_arch="arm64"
      node_sha="524659219d6a207a7400f2bde15d19ba060ffbe0d32a8643319ad67e3bb64c78"
      ;;
    x86_64|amd64)
      node_arch="x64"
      node_sha="d804845d34eddc21dc1092b519d643ef40b1f58ec5dec5c22b1f4bd8fabde6c9"
      ;;
    *) echo "unsupported arch: $arch"; exit 1;;
  esac

  node_archive="/tmp/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
  node_root="/usr/local/lib/nodejs"
  node_dir="${node_root}/node-v${NODE_VERSION}-linux-${node_arch}"
  curl -fsSL \
    "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
    -o "$node_archive"
  echo "${node_sha}  ${node_archive}" | sha256sum -c -
  ${SUDO} mkdir -p "$node_root" /usr/local/bin
  ${SUDO} tar -xf "$node_archive" -C "$node_root"
  for executable in node npm npx corepack; do
    ${SUDO} ln -sf "${node_dir}/bin/${executable}" "/usr/local/bin/${executable}"
  done
fi

# Zig if missing. Keep this aligned with CI and Dockerfile.standalone.
export ZIG_VERSION="${ZIG_VERSION:-0.15.2}"
need_zig=1
if command -v zig >/dev/null 2>&1 && [ "$(zig version)" = "$ZIG_VERSION" ]; then
  need_zig=0
fi
if [ "$need_zig" -eq 1 ]; then
  arch="$(uname -m)"
  case "$arch" in
    aarch64|arm64)
      ZIG_TARGET="aarch64-linux"
      zig_sha="958ed7d1e00d0ea76590d27666efbf7a932281b3d7ba0c6b01b0ff26498f667f"
      ;;
    x86_64|amd64)
      ZIG_TARGET="x86_64-linux"
      zig_sha="02aa270f183da276e5b5920b1dac44a63f1a49e55050ebde3aecc9eb82f93239"
      ;;
    *) echo "unsupported arch: $arch"; exit 1;;
  esac

  zig_url="https://ziglang.org/download/${ZIG_VERSION}/zig-${ZIG_TARGET}-${ZIG_VERSION}.tar.xz"

  zig_root="/usr/local/zig"
  zig_bin="/usr/local/bin"

  ${SUDO} mkdir -p "$zig_root"
  ${SUDO} mkdir -p "$zig_bin"
  curl -fsSL "$zig_url" -o /tmp/zig.tar.xz
  echo "${zig_sha}  /tmp/zig.tar.xz" | sha256sum -c -
  ${SUDO} tar -xf /tmp/zig.tar.xz -C "$zig_root" --strip-components=1
  ${SUDO} ln -sf "$zig_root/zig" "$zig_bin/zig"
fi

node -v
npm -v
zig version

printf '\nNext steps:\n'
echo "  cd web"
echo "  npm install"
echo "  npm run build"
