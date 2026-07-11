#!/usr/bin/env python3

import json
import os
from pathlib import Path
import signal
import shutil
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import time


MAX_PAYLOAD = 1024 * 1024


def wait_for(predicate, label, timeout=8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(0.03)
    raise AssertionError(f"timed out waiting for {label}")


def frame(kind, payload=b""):
    return bytes([kind]) + struct.pack(">I", len(payload)) + payload


def read_cast(path):
    text = path.read_text(encoding="utf-8")
    rows = [json.loads(line) for line in text.splitlines() if line]
    assert rows and rows[0]["version"] == 2
    return rows


def main():
    binary = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory(prefix="vt-", dir="/tmp") as root:
        home = Path(root)
        control_dir = home / "custom-control"
        env = os.environ.copy()
        env["HOME"] = str(home)
        env["VIBETUNNEL_CONTROL_DIR"] = str(control_dir)
        env["VIBETUNNEL_LOG_LEVEL"] = "debug"

        test_exit_and_artifacts(binary, control_dir, env)
        test_non_utf8_option_values(binary, control_dir, env)
        test_rust_min_stack_is_child_only(binary, env)
        test_child_sigpipe(binary, control_dir, env)
        test_binary_output(binary, control_dir, env)
        test_ipc(binary, control_dir, env)

        log_path = home / ".vibetunnel/log.txt"
        assert stat.S_IMODE(log_path.stat().st_mode) == 0o600


def test_exit_and_artifacts(binary, control_dir, env):
    session_id = "basic_exit"
    proc = subprocess.Popen(
        [binary, "--session-id", session_id, "/bin/sh", "-c", 'printf "hello\\n"; exit 7'],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    output, stderr = proc.communicate(timeout=10)
    assert proc.returncode == 7, (proc.returncode, stderr)
    assert b"hello" in output

    session_dir = control_dir / session_id
    info = json.loads((session_dir / "session.json").read_text())
    assert info["status"] == "exited" and info["exitCode"] == 7
    assert read_cast(session_dir / "stdout")[-1] == ["exit", 7, session_id]
    assert stat.S_IMODE(session_dir.stat().st_mode) == 0o700
    assert stat.S_IMODE((session_dir / "session.json").stat().st_mode) == 0o600
    assert stat.S_IMODE((session_dir / "stdout").stat().st_mode) == 0o600
    assert stat.S_ISFIFO((session_dir / "stdin").stat().st_mode)
    assert stat.S_IMODE((session_dir / "stdin").stat().st_mode) == 0o600
    assert not (session_dir / "ipc.sock").exists()


def test_binary_output(binary, control_dir, env):
    session_id = "binary_output"
    code = 'import os; os.write(1, bytes(range(256)) + b"\\nDONE\\n")'
    proc = subprocess.Popen(
        [binary, "--session-id", session_id, sys.executable, "-c", code],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    output, stderr = proc.communicate(timeout=10)
    assert proc.returncode == 0, (proc.returncode, stderr)
    assert b"DONE" in output and len(output) >= 256

    rows = read_cast(control_dir / session_id / "stdout")
    assert rows[-1] == ["exit", 0, session_id]
    output_text = "".join(
        row[2] for row in rows if isinstance(row, list) and len(row) == 3 and row[1] == "o"
    )
    assert "DONE" in output_text and "\ufffd" in output_text


def test_non_utf8_option_values(binary, control_dir, env):
    session_id = b"raw_options"
    raw_log_path = os.fsencode(control_dir.parent / "log-") + b"\xff"
    raw_binary = os.fsencode(binary)
    true_binary = shutil.which("true")
    assert true_binary is not None
    proc = subprocess.run(
        [
            raw_binary,
            b"--session-id",
            session_id,
            b"--log-file",
            raw_log_path,
            os.fsencode(true_binary),
        ],
        env=env,
        capture_output=True,
        timeout=10,
    )
    assert proc.returncode == 0, (proc.returncode, proc.stderr)
    replacement_log_path = raw_log_path[:-1] + "\ufffd".encode()
    assert not os.path.exists(replacement_log_path)
    if sys.platform == "darwin":
        # APFS rejects malformed UTF-8 path components with EILSEQ. The
        # important parity check here is that no replacement path is created.
        assert not os.path.exists(raw_log_path)
    else:
        assert os.path.exists(raw_log_path)

    updater = subprocess.run(
        [
            raw_binary,
            b"--session-id",
            session_id,
            b"--update-title",
            b"raw\xfftitle",
        ],
        env=env,
        capture_output=True,
        timeout=10,
    )
    assert updater.returncode == 0, (updater.returncode, updater.stderr)
    info = json.loads((control_dir / os.fsdecode(session_id) / "session.json").read_text())
    assert info["name"] == "rawtitle"


def test_child_sigpipe(binary, control_dir, env):
    session_id = "child_sigpipe"
    proc = subprocess.Popen(
        [binary, "--session-id", session_id, "/bin/sleep", "30"],
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    session_path = control_dir / session_id / "session.json"
    child_pid = None

    def session_is_running():
        nonlocal child_pid
        try:
            info = json.loads(session_path.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return False
        child_pid = info.get("pid")
        return info.get("status") == "running" and isinstance(child_pid, int)

    wait_for(session_is_running, "SIGPIPE child pid")
    os.kill(child_pid, signal.SIGPIPE)
    _, stderr = proc.communicate(timeout=10)
    assert proc.returncode == 141, (proc.returncode, stderr)
    info = json.loads(session_path.read_text())
    assert info["status"] == "exited" and info["exitCode"] == 141


def test_rust_min_stack_is_child_only(binary, env):
    child_env = env.copy()
    child_env["RUST_MIN_STACK"] = "9000000000000000000"
    true_binary = shutil.which("true")
    assert true_binary is not None
    proc = subprocess.run(
        [binary, "--session-id", "rust_min_stack", true_binary],
        env=child_env,
        capture_output=True,
        timeout=10,
    )
    assert proc.returncode == 0, (proc.returncode, proc.stderr)


def test_ipc(binary, control_dir, env):
    session_id = "ipc_control"
    session_dir = control_dir / session_id
    proc = subprocess.Popen(
        [
            binary,
            "--session-id",
            session_id,
            "/bin/sh",
            "-c",
            'read line; printf "got:%s\\n" "$line"; sleep 30',
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    socket_path = session_dir / "ipc.sock"
    wait_for(socket_path.exists, "IPC socket")
    assert stat.S_ISSOCK(socket_path.stat().st_mode)
    assert stat.S_IMODE(socket_path.stat().st_mode) == 0o600

    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.connect(str(socket_path))
    heartbeat = frame(4)
    for byte in heartbeat:
        client.sendall(bytes([byte]))
    assert client.recv(5) == heartbeat

    client.sendall(bytes([2]) + struct.pack(">I", MAX_PAYLOAD + 1))
    client.settimeout(3)
    assert client.recv(1) == b""
    client.close()

    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.connect(str(socket_path))
    client.sendall(frame(0xFF, b"ignored") + heartbeat)
    assert client.recv(5) == heartbeat

    client.sendall(frame(2, json.dumps({"cmd": "kill", "signal": "NOPE"}).encode()))
    time.sleep(0.2)
    assert proc.poll() is None

    resize = json.dumps({"cmd": "resize", "cols": 100, "rows": 40}).encode()
    title = json.dumps({"cmd": "update-title", "title": "IPC\x1b]2;unsafe"}).encode()
    client.sendall(frame(2, resize) + frame(2, title) + frame(1, b"hello\n"))
    cast_path = session_dir / "stdout"
    wait_for(lambda: "got:hello" in cast_path.read_text(encoding="utf-8"), "stdin echo")

    updater = subprocess.run(
        [binary, "--session-id", session_id, "--update-title", "CLI\nTitle"],
        env=env,
        capture_output=True,
        timeout=10,
    )
    assert updater.returncode == 0, updater.stderr
    session_path = session_dir / "session.json"
    wait_for(lambda: json.loads(session_path.read_text())["name"] == "CLITitle", "title update")

    kill = json.dumps({"cmd": "kill", "signal": "SIGTERM"}).encode()
    client.sendall(frame(2, kill))
    client.close()
    _, stderr = proc.communicate(timeout=10)
    assert proc.returncode in (42, 143), (proc.returncode, stderr)

    info = json.loads(session_path.read_text())
    assert info["status"] == "exited" and info["name"] == "CLITitle"
    rows = read_cast(cast_path)
    assert any(row[1:] == ["r", "100x40"] for row in rows if isinstance(row, list))
    assert any(row[1:] == ["i", "hello\n"] for row in rows if isinstance(row, list))
    assert not socket_path.exists()


if __name__ == "__main__":
    main()
