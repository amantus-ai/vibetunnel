# Linux (Ubuntu) Development + NPM Usage

## Goals
- One command to bootstrap Linux dev
- npm install/build works without pnpm
- Avoid SEA on Linux by default (Node CLI path is more reliable)

## Quickstart (Ubuntu 24.04)
```bash
web/scripts/linux-bootstrap.sh
cd web
npm install
npm run build
```

## What the bootstrap does
- Installs system deps: `curl`, `ca-certificates`, `xz-utils`, `python3`, `make`, `g++`, `git`
- Installs `libpam0g-dev` for PAM auth native module
- Installs Node.js 24.x (NodeSource) if missing or too old
- Installs Zig (latest stable)

## SEA on Linux (disabled by default)
SEA builds are skipped on Linux unless explicitly enabled.

Enable if you want to test SEA (not recommended on Linux):
```bash
VIBETUNNEL_BUILD_SEA=1 npm run build
# or
npm run build -- --build-sea
```

## PAM Authentication (optional)
- `authenticate-pam` is an optional dependency.
- If `libpam0g-dev` is present during install, PAM auth will be built and used.
- If it’s missing, VibeTunnel still runs; auth falls back to env/SSH methods.

To force PAM after installing deps:
```bash
cd web
npm rebuild authenticate-pam
```

## npmjs (global install)
```bash
npm install -g vibetunnel@beta
vibetunnel --help
```

Linux npm package runs the Node CLI wrapper (no SEA).
Systemd support is available:
```bash
vibetunnel systemd install
systemctl --user start vibetunnel
systemctl --user status vibetunnel
```

## Troubleshooting
- `pnpm` missing during build: use npm (`npm install && npm run build`) or install pnpm.
- `zig` missing: rerun `web/scripts/linux-bootstrap.sh`.
- `pam_appl.h` missing: `sudo apt-get install -y libpam0g-dev`.
