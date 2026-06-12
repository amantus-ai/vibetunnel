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

# Install the pinned Zig release for vibetunnel-fwd builds.
SHELL ["/bin/bash", "-c"]
ARG ZIG_VERSION=0.15.2
ARG ZIG_AMD64_SHA256=02aa270f183da276e5b5920b1dac44a63f1a49e55050ebde3aecc9eb82f93239
ARG ZIG_ARM64_SHA256=958ed7d1e00d0ea76590d27666efbf7a932281b3d7ba0c6b01b0ff26498f667f
RUN set -euo pipefail; \
    arch="$(uname -m)"; \
    case "$arch" in \
      aarch64|arm64) zig_arch="aarch64-linux"; zig_sha="$ZIG_ARM64_SHA256";; \
      x86_64|amd64) zig_arch="x86_64-linux"; zig_sha="$ZIG_AMD64_SHA256";; \
      *) echo "unsupported arch: $arch" >&2; exit 1;; \
    esac; \
    zig_url="https://ziglang.org/download/${ZIG_VERSION}/zig-${zig_arch}-${ZIG_VERSION}.tar.xz"; \
    curl -fsSL "$zig_url" -o /tmp/zig.tar.xz; \
    echo "${zig_sha}  /tmp/zig.tar.xz" | sha256sum -c -; \
    mkdir -p /usr/local/zig /usr/local/bin; \
    tar -xf /tmp/zig.tar.xz -C /usr/local/zig --strip-components=1; \
    ln -sf /usr/local/zig/zig /usr/local/bin/zig

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY node-pty/package.json ./node-pty/

# Install the package-manager version declared by package.json.
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

# Copy all source code first (needed for postinstall scripts)
COPY . .

# The web-only Docker context excludes the repository-level forwarder sources.
ARG VT_FWD_COMMIT=586a728d4138a96338b05943f05576a25f0679d7
RUN git init /tmp/vt-src \
    && git -C /tmp/vt-src remote add origin https://github.com/amantus-ai/vibetunnel.git \
    && git -C /tmp/vt-src fetch --depth 1 origin "$VT_FWD_COMMIT" \
    && git -C /tmp/vt-src checkout --detach FETCH_HEAD \
    && mkdir -p /app/native \
    && cp -R /tmp/vt-src/native/vt-fwd /app/native/vt-fwd \
    && rm -rf /tmp/vt-src

# Install dependencies
RUN pnpm install --frozen-lockfile

# Skip build for now - just test with source files
# RUN pnpm run build:npm

# Expose the default port
EXPOSE 4020

# Default command for testing
CMD ["pnpm", "run", "test:ci"]
