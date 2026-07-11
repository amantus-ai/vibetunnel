#!/bin/sh
set -eu

exec node /app/bin/vibetunnel --bind 0.0.0.0 "$@"
