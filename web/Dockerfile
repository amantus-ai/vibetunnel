# Use Node.js 22 as base image to support npm beta
FROM node:22-slim

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Install system dependencies required for node-pty and other native modules
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    build-essential \
    git \
    curl \
    xz-utils \
    libpam0g-dev \
    && rm -rf /var/lib/apt/lists/*

# Install the pinned Rust toolchain for vibetunnel-fwd builds.
SHELL ["/bin/bash", "-c"]
ARG RUST_VERSION=1.97.0
ARG RUSTUP_VERSION=1.29.0
ARG RUSTUP_AMD64_SHA256=4acc9acc76d5079515b46346a485974457b5a79893cfb01112423c89aeb5aa10
ARG RUSTUP_ARM64_SHA256=9732d6c5e2a098d3521fca8145d826ae0aaa067ef2385ead08e6feac88fa5792
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo
ENV PATH=/usr/local/cargo/bin:${PATH}
RUN set -euo pipefail; \
    arch="$(uname -m)"; \
    case "$arch" in \
      aarch64|arm64) rust_target="aarch64-unknown-linux-gnu"; rustup_sha="$RUSTUP_ARM64_SHA256";; \
      x86_64|amd64) rust_target="x86_64-unknown-linux-gnu"; rustup_sha="$RUSTUP_AMD64_SHA256";; \
      *) echo "unsupported arch: $arch" >&2; exit 1;; \
    esac; \
    rustup_url="https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/${rust_target}/rustup-init"; \
    curl --proto '=https' --tlsv1.2 -fsSL "$rustup_url" -o /tmp/rustup-init; \
    echo "${rustup_sha}  /tmp/rustup-init" | sha256sum -c -; \
    chmod +x /tmp/rustup-init; \
    /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain "$RUST_VERSION"; \
    rm /tmp/rustup-init; \
    host_target="$(rustc +"$RUST_VERSION" -vV | sed -n 's/^host: //p')"; \
    rustup target add --toolchain "$RUST_VERSION" "$host_target"; \
    rustc +"$RUST_VERSION" --version | grep -F "rustc $RUST_VERSION "

# Set working directory
WORKDIR /app

# Copy package files
COPY web/package.json web/pnpm-lock.yaml ./
COPY web/node-pty/package.json ./node-pty/

# Install the package-manager version declared by package.json.
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

# Copy all source code first (needed for postinstall scripts)
COPY web/. .
COPY native/vt-fwd ./native/vt-fwd

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build and install the native forwarder with Cargo.
RUN set -euo pipefail; \
    version="$(node -p 'require("./package.json").version')"; \
    VIBETUNNEL_VERSION="$version" \
      cargo +"$RUST_VERSION" build --locked --release \
        --manifest-path native/vt-fwd/Cargo.toml; \
    mkdir -p native bin; \
    install -m 0755 native/vt-fwd/target/release/vibetunnel-fwd native/vibetunnel-fwd; \
    install -m 0755 native/vt-fwd/target/release/vibetunnel-fwd bin/vibetunnel-fwd

# Skip build for now - just test with source files
# RUN pnpm run build:npm

# Expose the default port
EXPOSE 4020

# Default command for testing
CMD ["pnpm", "run", "test:ci"]
