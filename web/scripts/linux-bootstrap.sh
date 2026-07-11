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
if command -v node >/dev/null 2>&1 \
  && command -v npm >/dev/null 2>&1 \
  && command -v corepack >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  node_minor="$(node -p 'process.versions.node.split(".")[1]')"
  if { [ "$node_major" -gt 22 ] && [ "$node_major" -le 24 ]; } \
    || { [ "$node_major" -eq 22 ] && [ "$node_minor" -ge 12 ]; }; then
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

# Enable the repository-pinned pnpm version. Node is installed under /usr/local,
# so creating Corepack's command links requires the same elevated access.
${SUDO} corepack enable
corepack prepare pnpm@10.15.0 --activate

# Install the pinned Rust toolchain for the invoking user.
export RUST_VERSION="${RUST_VERSION:-1.97.0}"
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
export PATH="$CARGO_HOME/bin:$PATH"
if ! command -v rustup >/dev/null 2>&1; then
  RUSTUP_VERSION="1.29.0"
  arch="$(uname -m)"
  case "$arch" in
    aarch64|arm64)
      rust_target="aarch64-unknown-linux-gnu"
      rustup_sha="9732d6c5e2a098d3521fca8145d826ae0aaa067ef2385ead08e6feac88fa5792"
      ;;
    x86_64|amd64)
      rust_target="x86_64-unknown-linux-gnu"
      rustup_sha="4acc9acc76d5079515b46346a485974457b5a79893cfb01112423c89aeb5aa10"
      ;;
    *) echo "unsupported arch: $arch"; exit 1;;
  esac
  rustup_url="https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/${rust_target}/rustup-init"
  curl --proto '=https' --tlsv1.2 -fsSL "$rustup_url" -o /tmp/rustup-init
  echo "${rustup_sha}  /tmp/rustup-init" | sha256sum -c -
  chmod +x /tmp/rustup-init
  /tmp/rustup-init \
    -y \
    --no-modify-path \
    --profile minimal \
    --default-toolchain "$RUST_VERSION"
  rm /tmp/rustup-init
fi
rustup toolchain install "$RUST_VERSION" --profile minimal --no-self-update
host_target="$(rustc +"$RUST_VERSION" -vV | sed -n 's/^host: //p')"
rustup target add --toolchain "$RUST_VERSION" "$host_target"

if [ -n "${GITHUB_PATH:-}" ]; then
  printf '%s\n' "$CARGO_HOME/bin" >> "$GITHUB_PATH"
fi

node -v
npm -v
pnpm -v
rustc +"$RUST_VERSION" --version | grep -F "rustc $RUST_VERSION "
cargo +"$RUST_VERSION" --version

printf '\nNext steps:\n'
echo "  cd web"
echo "  pnpm install --frozen-lockfile"
echo "  pnpm build"
