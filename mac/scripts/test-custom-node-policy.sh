#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/custom-node-policy.sh"

assert_action() {
    local expected="$1"
    shift
    local actual
    actual="$(vibetunnel_custom_node_action "$@")"
    if [[ "$actual" != "$expected" ]]; then
        echo "Expected '$expected', got '$actual' for: $*"
        exit 1
    fi
}

missing_node="/definitely/missing/vibetunnel-custom-node"
existing_node="/bin/sh"

assert_action use Release true false "$existing_node"
assert_action use Release false false "$existing_node"
assert_action prepare Release false false "$missing_node"
assert_action prepare Release true true "$missing_node"
assert_action prepare Release true true "$existing_node"
assert_action system Release true false "$missing_node"
assert_action use Debug true false "$existing_node"
assert_action system Debug false true "$missing_node"

echo "Custom Node policy tests passed"
