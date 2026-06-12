#!/bin/bash
set -euo pipefail

pnpm exec oxlint --config ./.oxlintrc.json --deny-warnings src

# The native preview compiler no longer supports the server's CommonJS
# node10 resolution. Keep the stable compiler for that target and use the
# preview compiler with bundler resolution for browser targets.
pnpm exec tsc --noEmit --project tsconfig.server.json
pnpm exec tsgo --noEmit --project tsconfig.client.json --moduleResolution bundler
pnpm exec tsgo --noEmit --project tsconfig.sw.json --moduleResolution bundler
