<!-- Updated: 2025-12-19 -->

# Testing

Short, reliable gate + forwarder E2E.

## Full Gate (required before handoff)

```bash
./scripts/validate-docs.sh

(
  cd native/vt-fwd
  cargo fmt --all -- --check
  cargo clippy --all-targets --all-features --locked -- -D warnings
  cargo test --all-targets --all-features --locked
  cargo build --release --locked
  python3 test/e2e.py target/release/vibetunnel-fwd
)

(
  cd web
  pnpm run build
  pnpm run check
  pnpm run test:ci
)
```

Notes:
- `web/scripts/check-all.sh` runs format:check, lint, lint:typeaware, typecheck, test:vt in parallel.
- `pnpm run test:ci` runs the Vitest suites once with the verbose reporter.

## Rust Formatting + Linting

Rustup installs the pinned formatter and linter components from `native/vt-fwd/rust-toolchain.toml`.

```bash
cd native/vt-fwd
cargo fmt --all -- --check
cargo clippy --all-targets --all-features --locked -- -D warnings
cargo test --all-targets --all-features --locked
```

## Rust Forwarder E2E (random binary → disk artifacts)

Goal: verify `session.json`, `stdout`, `stdin` FIFO, `ipc.sock` exist; stdout has bytes; session exits cleanly.

```bash
cd native/vt-fwd
cargo build --release --locked
python3 test/e2e.py target/release/vibetunnel-fwd
```

The Unix-only Python 3 test covers exit propagation, private artifact permissions, random binary output, valid cast JSON, fragmented and oversized IPC frames, heartbeat, resize, stdin, title updates, malformed signals, and process-group termination.

Manual artifact inspection requires a C compiler:

```bash
cat > /tmp/vt-randout.c <<'EOF'
#include <fcntl.h>
#include <unistd.h>
int main(void){int fd=open("/dev/urandom",O_RDONLY);unsigned char b[256];
ssize_t n=read(fd,b,sizeof(b)); if(n>0) write(1,b,(size_t)n);
write(1,"\nDONE\n",6); sleep(1); return 0;}
EOF
cc /tmp/vt-randout.c -o /tmp/vt-randout

SESSION_ID="rusttest_$(date +%s)"
CONTROL_DIR="$HOME/.vibetunnel/control/$SESSION_ID"

native/vt-fwd/target/release/vibetunnel-fwd --session-id "$SESSION_ID" /tmp/vt-randout > /dev/null &
FWD_PID=$!

# wait for artifacts
for i in {1..50}; do [ -f "$CONTROL_DIR/session.json" ] && break; sleep 0.1; done

ls -la "$CONTROL_DIR"

# artifact checks
test -f "$CONTROL_DIR/session.json"
test -f "$CONTROL_DIR/stdout"
test -p "$CONTROL_DIR/stdin"
test -S "$CONTROL_DIR/ipc.sock"

wait $FWD_PID

# post-exit checks
wc -c "$CONTROL_DIR/stdout"
tail -n 1 "$CONTROL_DIR/session.json"
```

Expectations:
- `stdout` > 0 bytes.
- `session.json` ends with `}` and includes `status: "exited"` + `exitCode`.

## Web E2E (Playwright)

```bash
cd web
pnpm run test:e2e
```

Optional variants:
```bash
pnpm run test:e2e:headed
pnpm run test:e2e:debug
```

## macOS Tests

```bash
cd mac
./scripts/lint.sh
xcodebuild test
```

## iOS Tests

```bash
cd ios
./scripts/test-with-coverage.sh
```

## Cleanup

```bash
rm -rf "$HOME/.vibetunnel/control/rusttest_*"
```
