# Zig Forwarder Refactor Plan

## Goals
- Per-process Zig forwarder replaces Node `fwd` path; minimal latency + RSS.
- Unix/macOS only; no daemon.
- Node web server stays optional; consumes same session files + IPC.
- No Claude activity detection feature (removed).

## Non-Goals
- Windows support.
- New UI features.
- Server-managed PTY rewrite in this phase.

## Current State (vt / fwd)
- `vt` wrapper → `vibetunnel fwd` (Node) → node-pty.
- Writes `~/.vibetunnel/control/<id>/session.json` + `stdout` (asciinema v2).
- IPC via `ipc.sock` with framed protocol (stdin/resize/kill/update-title).
- Dynamic title mode is legacy alias of static (no activity tracking).

## Target Architecture (per-process)
```
vt -> vibetunnel-fwd (zig) -> PTY + stdout file + ipc.sock + session.json
                         ^ Node server watches control dir + sends IPC
```

## Compatibility Contracts
- Control dir layout: `~/.vibetunnel/control/<id>/`
  - `session.json`, `stdout` (asciinema v2), `stdin` (FIFO), `ipc.sock`.
- Session JSON schema: `web/src/shared/types.ts` `SessionInfo`.
- IPC framing: `web/src/server/pty/socket-protocol.ts`
  - 1 byte type + 4 byte BE length + payload.
  - `STDIN_DATA` raw bytes (utf8), `CONTROL_CMD` JSON.
- CLI flags: `--session-id`, `--title-mode`, `--verbosity`, `--update-title`, `--log-file`, `--`.
- Env: `VIBETUNNEL_SESSION_ID`, `VIBETUNNEL_TITLE_MODE`, `VIBETUNNEL_LOG_LEVEL`.

## Claude Activity Detection Removal (explicit)
Done:
- Removed `ActivityDetector` and `claude-turn` event path.
- Removed config toggle + UI setting + push notification type.
- Title mode `dynamic` is alias of `static` (no activity).
- Deleted tests tied to `claude-turn` and activity detection.

## Refactor Phases

### Phase 0: Repo Layout + Scaffolding
- New Zig package: `native/vt-fwd/` (or `zig/vt-fwd/`).
- Copy minimal Ghostty POSIX PTY code:
  - `src/pty.zig` (POSIX branch only).
  - Keep MIT header + attribution.
- Build outputs:
  - `web/bin/vibetunnel-fwd` (npm).
  - `mac/VibeTunnel/Resources/vibetunnel-fwd` (app bundle).

### Phase 1: Core PTY + Process Spawn
- PTY open: `openpty`, `setsid`, `TIOCSCTTY`, `ioctl` for size.
- Spawn command with PTY slave as stdio.
- Capture master fd for read/write.
- Env: set `TERM`, `VIBETUNNEL_SESSION_ID`.
- Graceful shutdown on SIGTERM/SIGINT.

### Phase 2: Session Files + Asciinema v2
- Create control dir + FIFO (`stdin`) like `SessionManager`.
- Write `session.json` initial: `starting`, pid, cwd, command, title mode.
- Asciinema v2 writer:
  - Header line JSON.
  - Output events: `[time,"o","..."]`.
  - Input events: `[time,"i","..."]` (for stdin echo).
  - Resize events: `[time,"r","COLSxROWS"]`.
  - Exit event: `["exit", code, sessionId]`.
- Update `session.json` on exit: `status`, `exitCode`, `pid`.
- `lastClearOffset`: start `0`; optional later pruning detection.

### Phase 3: IPC Socket Server
- Create `ipc.sock` in session dir; enforce macOS path length limit.
- Accept multiple clients; parse frames.
- Handle:
  - `STDIN_DATA`: write to PTY, write input event.
  - `CONTROL_CMD`:
    - `resize`: PTY resize + asciinema resize event.
    - `kill`: send signal to child.
    - `reset-size`: set to current terminal size if TTY.
    - `update-title`: update `session.json` name; local title update.
- Backpressure: queue writes; avoid partial frame parsing errors.

### Phase 4: Title Modes (no activity)
- `none`: pass through, no title updates.
- `filter`: strip OSC title sequences from output before writing.
- `static`: set title on start + on `update-title`.
- `dynamic`: alias `static`.
- Keep `vt title` semantics via `--update-title` client path.

### Phase 5: Integration + Switch
- Update `web/bin/vt` to prefer `vibetunnel-fwd` if present.
- `vibetunnel fwd` path:
  - Option A: exec `vibetunnel-fwd` directly.
  - Option B: keep Node `fwd` as fallback behind env flag.
- Packaging:
  - `web/scripts/build-npm.js`: include Zig binary.
  - `mac/scripts/build-web-frontend.sh`: copy Zig binary into app bundle.

### Phase 6: Cleanup (post-forwarder)
- Ensure STATUS_UPDATE is ignored end-to-end.
- Keep docs + tests aligned with legacy dynamic title mode.

## Test Plan
- Zig unit tests: frame parser, asciinema writer, PTY resize.
- Integration:
  - `vibetunnel-fwd echo hi` → session.json + stdout + exit event.
  - IPC stdin write → output appears.
  - Resize command → asciinema resize event.
- Web server:
  - stream watcher reads Zig stdout file.
  - `vt title` updates session name.
- Verified no `claude-turn` tests remain.

## Rollout Plan
- Feature flag: `VIBETUNNEL_USE_ZIG_FWD=1`.
- Dual-path fallback until stable.
- Metrics: start latency, RSS, failures in `vt` integration tests.

## Risks + Mitigations
- PTY edge cases (macOS TTY size): guard + fallback cols/rows.
- Encoding issues: strict UTF-8; preserve escape sequences.
- Socket path length: short session IDs.
- Crash cleanup: handle signals; remove `ipc.sock`; update status.

## Open Questions
- Final binary name + path?
- Keep `dynamic` title mode exposed?
- Pruning detection parity now or later?
