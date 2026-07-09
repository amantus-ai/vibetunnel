#!/bin/bash
set -euo pipefail

pnpm exec oxlint --config ./.oxlintrc.json --deny-warnings src

# TypeScript 7 no longer supports the server's CommonJS node10 resolution.
# Keep the TypeScript 6 compatibility compiler for that target and use the
# stable native compiler with bundler resolution for browser targets.
pnpm exec tsc6 --noEmit --project tsconfig.server.json
pnpm exec tsc --noEmit --project tsconfig.client.json --moduleResolution bundler
pnpm exec tsc --noEmit --project tsconfig.sw.json --moduleResolution bundler
