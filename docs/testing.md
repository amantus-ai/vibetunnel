<!-- Updated: 2025-12-19 -->

# Testing

Short, reliable gate + forwarder E2E.

## Full Gate (required before handoff)

```bash
./scripts/validate-docs.sh

cd native/vt-fwd && zig build

cd web && pnpm run build
cd web && pnpm run check
cd web && pnpm run test
```

Notes:
- `web/scripts/check-all.sh` runs format:check, lint, lint:typeaware, typecheck, test:vt in parallel.
- `pnpm run test` runs Vitest suites.

## Zig Formatting + Linting

Zig has a formatter (`zig fmt`) and no official linter. Use formatting + compiler warnings.

```bash
zig fmt native/vt-fwd/build.zig native/vt-fwd/src/*.zig
cd native/vt-fwd && zig build
```

## Zig Forwarder E2E (random binary → disk artifacts)

Goal: verify `session.json`, `stdout`, `stdin` FIFO, `ipc.sock` exist; stdout has bytes; session exits cleanly.

```bash
cat > /tmp/vt-randout.c <<'EOF'
#include <fcntl.h>
#include <unistd.h>
int main(void){int fd=open("/dev/urandom",O_RDONLY);unsigned char b[256];
ssize_t n=read(fd,b,sizeof(b)); if(n>0) write(1,b,(size_t)n);
write(1,"\nDONE\n",6); sleep(1); return 0;}
EOF
cc /tmp/vt-randout.c -o /tmp/vt-randout

SESSION_ID="zigtest_$(date +%s)"
CONTROL_DIR="$HOME/.vibetunnel/control/$SESSION_ID"

native/vt-fwd/zig-out/bin/vibetunnel-fwd --session-id "$SESSION_ID" /tmp/vt-randout > /dev/null &
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
rm -rf "$HOME/.vibetunnel/control/zigtest_*"
```
