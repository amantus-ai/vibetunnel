use std::env;
use std::ffi::{CString, OsStr, OsString};
use std::fs::File;
use std::io;
use std::os::fd::{AsFd, BorrowedFd, IntoRawFd, OwnedFd};
use std::os::unix::prelude::{AsRawFd, OpenOptionsExt, OsStrExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::protocol::{
    AsciinemaEvent, AsciinemaEventType, NotificationEvent, NotificationWriter, SessionInfo,
    StreamWriter,
};

use anyhow::Error;
use jiff::Timestamp;
use nix::errno::Errno;
#[cfg(any(
    target_os = "macos",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
use nix::libc::login_tty;
use nix::libc::{O_NONBLOCK, TIOCGWINSZ, TIOCSWINSZ, VEOF};

// Define TIOCSCTTY for platforms where it's not exposed by libc
#[cfg(target_os = "linux")]
const TIOCSCTTY: u64 = 0x540E;
use nix::pty::{openpty, Winsize};
use nix::sys::select::{select, FdSet};
use nix::sys::signal::{killpg, Signal};
use nix::sys::stat::Mode;
use nix::sys::termios::{cfmakeraw, tcgetattr, tcsetattr, LocalFlags, SetArg, Termios};
use nix::sys::time::TimeVal;
use nix::sys::wait::{waitpid, WaitStatus};
use nix::unistd::{
    close, dup2, execvp, fork, mkfifo, read, setsid, tcgetpgrp, write, ForkResult, Pid,
};
use signal_hook::consts::SIGWINCH;
use tempfile::NamedTempFile;

pub const DEFAULT_TERM: &str = "xterm-256color";

/// Cross-platform implementation of `login_tty`
/// On systems with `login_tty`, use it directly. Otherwise, implement manually.
#[cfg(any(
    target_os = "macos",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
unsafe fn login_tty_compat(fd: i32) -> Result<(), Error> {
    if login_tty(fd) == 0 {
        Ok(())
    } else {
        Err(Error::msg("login_tty failed"))
    }
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
)))]
unsafe fn login_tty_compat(fd: i32) -> Result<(), Error> {
    // Manual implementation of login_tty for Linux and other systems

    // Create a new session
    if libc::setsid() == -1 {
        return Err(Error::msg("setsid failed"));
    }

    // Make the tty our controlling terminal
    #[cfg(target_os = "linux")]
    {
        if libc::ioctl(fd, TIOCSCTTY as libc::c_ulong, 0) == -1 {
            // Try without forcing
            if libc::ioctl(fd, TIOCSCTTY as libc::c_ulong, 1) == -1 {
                return Err(Error::msg("ioctl TIOCSCTTY failed"));
            }
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        // Use the libc constant directly on non-Linux platforms
        if libc::ioctl(fd, libc::TIOCSCTTY as libc::c_ulong, 0) == -1 {
            // Try without forcing
            if libc::ioctl(fd, libc::TIOCSCTTY as libc::c_ulong, 1) == -1 {
                return Err(Error::msg("ioctl TIOCSCTTY failed"));
            }
        }
    }

    // Duplicate the tty to stdin/stdout/stderr
    if libc::dup2(fd, 0) == -1 {
        return Err(Error::msg("dup2 stdin failed"));
    }
    if libc::dup2(fd, 1) == -1 {
        return Err(Error::msg("dup2 stdout failed"));
    }
    if libc::dup2(fd, 2) == -1 {
        return Err(Error::msg("dup2 stderr failed"));
    }

    // Close the original fd if it's not one of the standard descriptors
    if fd > 2 {
        libc::close(fd);
    }

    Ok(())
}

/// Creates environment variables for `AsciinemaHeader`
fn create_env_vars(term: &str) -> std::collections::HashMap<String, String> {
    let mut env_vars = std::collections::HashMap::new();
    env_vars.insert("TERM".to_string(), term.to_string());

    // Include other important terminal-related environment variables if they exist
    for var in ["SHELL", "LANG", "LC_ALL", "PATH", "USER", "HOME"] {
        if let Ok(value) = std::env::var(var) {
            env_vars.insert(var.to_string(), value);
        }
    }

    env_vars
}

/// Lets you spawn processes with a TTY connected.
pub struct TtySpawn {
    options: Option<SpawnOptions>,
}

impl TtySpawn {
    /// Alternative way to construct a [`TtySpawn`].
    ///
    /// Takes an iterator of command and arguments.  If the iterator is empty this
    /// panicks.
    ///
    /// # Panicks
    ///
    /// If the iterator is empty, this panics.
    pub fn new_cmdline<S: AsRef<OsStr>, I: Iterator<Item = S>>(mut cmdline: I) -> Self {
        let mut command = vec![cmdline
            .next()
            .expect("empty cmdline")
            .as_ref()
            .to_os_string()];
        command.extend(cmdline.map(|arg| arg.as_ref().to_os_string()));

        Self {
            options: Some(SpawnOptions {
                command,
                stdin_file: None,
                stdout_file: None,
                notification_writer: None,
                session_json_path: None,
                session_name: None,
                detached: false,
                term: DEFAULT_TERM.to_string(),
            }),
        }
    }

    /// Sets a path as input file for stdin.
    pub fn stdin_path<P: AsRef<Path>>(&mut self, path: P) -> Result<&mut Self, Error> {
        let path = path.as_ref();
        mkfifo_atomic(path)?;
        // for the justification for write(true) see the explanation on
        // stdin_file - we need to open for both read and write to prevent
        // polling primitives from reporting ready when no data is available.
        let file = File::options()
            .read(true)
            .write(true)
            .custom_flags(O_NONBLOCK)
            .open(path)?;
        self.options_mut().stdin_file = Some(file);
        Ok(self)
    }

    /// Sets a path as output file for stdout.
    ///
    /// If the `truncate` flag is set to `true` the file will be truncated
    /// first, otherwise it will be appended to.
    pub fn stdout_path<P: AsRef<Path>>(
        &mut self,
        path: P,
        truncate: bool,
    ) -> Result<&mut Self, Error> {
        let file = if truncate {
            File::options()
                .create(true)
                .truncate(true)
                .write(true)
                .open(path)?
        } else {
            File::options().append(true).create(true).open(path)?
        };

        self.options_mut().stdout_file = Some(file);
        Ok(self)
    }

    /// Sets the session JSON path for status updates.
    pub fn session_json_path<P: AsRef<Path>>(&mut self, path: P) -> &mut Self {
        self.options_mut().session_json_path = Some(path.as_ref().to_path_buf());
        self
    }

    /// Sets the session name.
    pub fn session_name<S: Into<String>>(&mut self, name: S) -> &mut Self {
        self.options_mut().session_name = Some(name.into());
        self
    }

    /// Sets the process to run in detached mode (don't connect to current terminal).
    pub const fn detached(&mut self, detached: bool) -> &mut Self {
        self.options_mut().detached = detached;
        self
    }

    /// Sets a path as output file for notifications.
    pub fn notification_path<P: AsRef<Path>>(&mut self, path: P) -> Result<&mut Self, Error> {
        let file = File::options().create(true).append(true).open(path)?;

        let notification_writer = NotificationWriter::new(file);
        self.options_mut().notification_writer = Some(notification_writer);
        Ok(self)
    }

    /// Sets the TERM environment variable for the spawned process.
    pub fn term<S: AsRef<str>>(&mut self, term: S) -> &mut Self {
        self.options_mut().term = term.as_ref().to_string();
        self
    }

    /// Spawns the application in the TTY.
    pub fn spawn(&mut self) -> Result<i32, Error> {
        spawn(self.options.take().expect("builder only works once"))
    }

    const fn options_mut(&mut self) -> &mut SpawnOptions {
        self.options.as_mut().expect("builder only works once")
    }
}

struct SpawnOptions {
    command: Vec<OsString>,
    stdin_file: Option<File>,
    stdout_file: Option<File>,
    notification_writer: Option<NotificationWriter>,
    session_json_path: Option<PathBuf>,
    session_name: Option<String>,
    detached: bool,
    term: String,
}

/// Creates a new session JSON file with the provided information
pub fn create_session_info(
    session_json_path: &Path,
    cmdline: Vec<String>,
    name: String,
    cwd: String,
    term: String,
) -> Result<(), Error> {
    let session_info = SessionInfo {
        cmdline,
        name,
        cwd,
        pid: None,
        status: "starting".to_string(),
        exit_code: None,
        started_at: Some(Timestamp::now()),
        term,
        spawn_type: "socket".to_string(),
    };

    let session_info_str = serde_json::to_string(&session_info)?;

    // Write to temporary file first, then move to final location
    let temp_file =
        NamedTempFile::new_in(session_json_path.parent().unwrap_or_else(|| Path::new(".")))?;
    std::fs::write(temp_file.path(), session_info_str)?;
    temp_file.persist(session_json_path)?;

    Ok(())
}

/// Updates the session status in the JSON file
fn update_session_status(
    session_json_path: &Path,
    pid: Option<u32>,
    status: &str,
    exit_code: Option<i32>,
) -> Result<(), Error> {
    if let Ok(content) = std::fs::read_to_string(session_json_path) {
        if let Ok(mut session_info) = serde_json::from_str::<SessionInfo>(&content) {
            if let Some(pid) = pid {
                session_info.pid = Some(pid);
            }
            session_info.status = status.to_string();
            if let Some(code) = exit_code {
                session_info.exit_code = Some(code);
            }
            let updated_content = serde_json::to_string(&session_info)?;

            // Write to temporary file first, then move to final location
            let temp_file = NamedTempFile::new_in(
                session_json_path.parent().unwrap_or_else(|| Path::new(".")),
            )?;
            std::fs::write(temp_file.path(), updated_content)?;
            temp_file.persist(session_json_path)?;
        }
    }
    Ok(())
}

/// Spawns a process in a PTY in a manor similar to `script`
/// but with separate stdout/stderr.
///
/// It leaves stdin/stdout/stderr connected but also writes events into the
/// optional `out` log file.  Additionally it can retrieve instructions from
/// the given control socket.
fn spawn(mut opts: SpawnOptions) -> Result<i32, Error> {
    // Create session info at the beginning if we have a session JSON path
    if let Some(ref session_json_path) = opts.session_json_path {
        // Get executable name for session name
        let executable_name = opts.command[0]
            .to_string_lossy()
            .split('/')
            .next_back()
            .unwrap_or("unknown")
            .to_string();

        // Get current working directory
        let current_dir = env::current_dir().map_or_else(
            |_| "unknown".to_string(),
            |p| p.to_string_lossy().to_string(),
        );

        let cmdline: Vec<String> = opts
            .command
            .iter()
            .map(|s| s.to_string_lossy().to_string())
            .collect();

        let session_name = opts.session_name.clone().unwrap_or(executable_name);

        create_session_info(
            session_json_path,
            cmdline.clone(),
            session_name.clone(),
            current_dir.clone(),
            opts.term.clone(),
        )?;

        // Send session started notification
        if let Some(ref mut notification_writer) = opts.notification_writer {
            let notification = NotificationEvent {
                timestamp: Timestamp::now(),
                event: "session_started".to_string(),
                data: serde_json::json!({
                    "cmdline": cmdline,
                    "name": session_name,
                    "cwd": current_dir
                }),
            };
            let _ = notification_writer.write_notification(notification);
        }
    }
    // if we can't retrieve the terminal atts we're not directly connected
    // to a pty in which case we won't do any of the terminal related
    // operations. In detached mode, we don't connect to the current terminal.
    let term_attrs = if opts.detached {
        None
    } else {
        tcgetattr(io::stdin()).ok()
    };
    let winsize = if opts.detached {
        Some(Winsize {
            ws_row: 24,
            ws_col: 80,
            ws_xpixel: 0,
            ws_ypixel: 0,
        })
    } else {
        term_attrs
            .as_ref()
            .and_then(|_| get_winsize(io::stdin().as_fd()))
    };

    // Create the outer pty for stdout
    let pty = openpty(&winsize, &term_attrs)?;

    // We always use raw mode since script_mode and no_raw are always false.
    // This switches the terminal to raw mode and restores it on Drop.
    // Unfortunately due to all our shenanigans here we have no real guarantee
    // that `Drop` is called so there will be cases where the term is left in
    // raw state and requires a reset :(
    let _restore_term = term_attrs.as_ref().map(|term_attrs| {
        let mut raw_attrs = term_attrs.clone();
        cfmakeraw(&mut raw_attrs);
        raw_attrs.local_flags.remove(LocalFlags::ECHO);
        tcsetattr(io::stdin(), SetArg::TCSAFLUSH, &raw_attrs).ok();
        RestoreTerm(term_attrs.clone())
    });

    // set some flags after pty has been created.  There are cases where we
    // want to remove the ECHO flag so we don't see ^D and similar things in
    // the output.  Likewise in script mode we want to remove OPOST which will
    // otherwise convert LF to CRLF.
    // Since script_mode and no_echo are always false, we don't need to
    // modify any terminal attributes for the pty master.

    // Fork and establish the communication loop in the parent.  This unfortunately
    // has to merge stdout/stderr since the pseudo terminal only has one stream for
    // both.
    let detached = opts.detached;

    if detached {
        // Use double fork to properly daemonize the process
        match unsafe { fork()? } {
            ForkResult::Parent { child: first_child } => {
                // Wait for the first child to exit immediately
                let _ = waitpid(first_child, None)?;
                drop(pty.slave);

                // Start a monitoring thread that doesn't block the parent
                // We'll monitor the PTY master for activity and session files
                let master_fd = pty.master;
                let session_json_path = opts.session_json_path.clone();
                let notification_writer = opts.notification_writer;
                let stdin_file = opts.stdin_file;

                // Create StreamWriter for detached session if we have an output file
                let stream_writer = if let Some(stdout_file) = opts.stdout_file.take() {
                    StreamWriter::with_params(
                        stdout_file,
                        winsize.as_ref().map_or(80, |x| u32::from(x.ws_col)),
                        winsize.as_ref().map_or(24, |x| u32::from(x.ws_row)),
                        Some(
                            opts.command
                                .iter()
                                .map(|s| s.to_string_lossy().to_string())
                                .collect::<Vec<_>>()
                                .join(" "),
                        ),
                        opts.session_name,
                        Some(create_env_vars(&opts.term)),
                    )
                    .ok()
                } else {
                    None
                };

                std::thread::spawn(move || {
                    // Monitor the session by watching the PTY and session files
                    let _ = monitor_detached_session(
                        master_fd,
                        session_json_path.as_deref(),
                        notification_writer,
                        stream_writer,
                        stdin_file,
                    );
                });

                return Ok(0);
            }
            ForkResult::Child => {
                // First child - fork again and exit immediately
                match unsafe { fork()? } {
                    ForkResult::Parent { .. } => {
                        // First child exits immediately to orphan the grandchild
                        std::process::exit(0);
                    }
                    ForkResult::Child => {
                        // Grandchild - this becomes the daemon
                        // Continue to the child process setup below
                    }
                }
            }
        }
    } else if let ForkResult::Parent { child } = unsafe { fork()? } {
        drop(pty.slave);
        let stderr_pty = None; // Always None since script_mode is always false

        // Update session status to running with PID
        if let Some(ref session_json_path) = opts.session_json_path {
            let _ = update_session_status(
                session_json_path,
                Some(child.as_raw() as u32),
                "running",
                None,
            );
        }

        // Create StreamWriter if we have an output file
        let mut stream_writer = if let Some(stdout_file) = opts.stdout_file.take() {
            StreamWriter::with_params(
                stdout_file,
                winsize.as_ref().map_or(80, |x| u32::from(x.ws_col)),
                winsize.as_ref().map_or(24, |x| u32::from(x.ws_row)),
                Some(
                    opts.command
                        .iter()
                        .map(|s| s.to_string_lossy().to_string())
                        .collect::<Vec<_>>()
                        .join(" "),
                ),
                opts.session_name,
                Some(create_env_vars(&opts.term)),
            )
            .ok()
        } else {
            None
        };

        let exit_code = communication_loop(
            pty.master,
            child,
            term_attrs.is_some() && !opts.detached,
            stream_writer.as_mut(),
            opts.stdin_file.as_mut(),
            stderr_pty,
            true, // flush is always enabled
            opts.notification_writer.as_mut(),
            opts.session_json_path.as_deref(),
        )?;

        // Send exit event to stream before updating session status
        if let Some(ref mut stream_writer) = stream_writer {
            let session_id = opts
                .session_json_path
                .as_ref()
                .and_then(|p| p.file_stem())
                .and_then(|s| s.to_str())
                .unwrap_or("unknown");
            let exit_event = serde_json::json!(["exit", exit_code, session_id]);
            let _ = stream_writer.write_raw_json(&exit_event);
        }

        // Update session status to exited with exit code
        if let Some(ref session_json_path) = opts.session_json_path {
            let _ = update_session_status(session_json_path, None, "exited", Some(exit_code));
        }

        // Send session exited notification
        if let Some(ref mut notification_writer) = opts.notification_writer {
            let notification = NotificationEvent {
                timestamp: Timestamp::now(),
                event: "session_exited".to_string(),
                data: serde_json::json!({
                    "exit_code": exit_code
                }),
            };
            let _ = notification_writer.write_notification(notification);
        }

        return Ok(exit_code);
    }

    // Since no_pager and script_mode are always false, we don't set PAGER.

    // If we reach this point we're the child and we want to turn into the
    // target executable after having set up the tty with `login_tty` which
    // rebinds stdin/stdout/stderr to the pty.
    let args = opts
        .command
        .iter()
        .filter_map(|x| CString::new(x.as_bytes()).ok())
        .collect::<Vec<_>>();

    drop(pty.master);
    if detached {
        // Set TERM environment variable for the child process
        env::set_var("TERM", &opts.term);

        // In detached mode, manually set up file descriptors without login_tty
        // This prevents the child from connecting to the current terminal

        // Create a new session to detach from controlling terminal
        let _ = setsid();

        // Update session status with the actual daemon PID
        if let Some(ref session_json_path) = opts.session_json_path {
            let daemon_pid = std::process::id();
            let _ = update_session_status(session_json_path, Some(daemon_pid), "running", None);
        }

        // Redirect stdin, stdout, stderr to the pty slave
        use std::os::fd::{FromRawFd, OwnedFd};
        let slave_fd = pty.slave.as_raw_fd();

        // Create OwnedFd for slave and standard file descriptors
        let slave_owned_fd = unsafe { OwnedFd::from_raw_fd(slave_fd) };
        let mut stdin_fd = unsafe { OwnedFd::from_raw_fd(0) };
        let mut stdout_fd = unsafe { OwnedFd::from_raw_fd(1) };
        let mut stderr_fd = unsafe { OwnedFd::from_raw_fd(2) };

        dup2(&slave_owned_fd, &mut stdin_fd).expect("Failed to dup2 stdin");
        dup2(&slave_owned_fd, &mut stdout_fd).expect("Failed to dup2 stdout");
        dup2(&slave_owned_fd, &mut stderr_fd).expect("Failed to dup2 stderr");

        // Forget the OwnedFd instances to prevent them from being closed
        std::mem::forget(stdin_fd);
        std::mem::forget(stdout_fd);
        std::mem::forget(stderr_fd);
        std::mem::forget(slave_owned_fd);

        // Close the original slave fd if it's not one of the standard fds
        if slave_fd > 2 {
            close(slave_fd).ok();
        }
    } else {
        unsafe {
            login_tty_compat(pty.slave.into_raw_fd())?;
            // No stderr redirection since script_mode is always false
        }
    }

    // Since this returns Infallible rather than ! due to limitations, we need
    // this dummy match.
    match execvp(&args[0], &args)? {}
}

#[allow(clippy::too_many_arguments)]
fn communication_loop(
    master: OwnedFd,
    child: Pid,
    is_tty: bool,
    mut stream_writer: Option<&mut StreamWriter>,
    in_file: Option<&mut File>,
    stderr: Option<OwnedFd>,
    flush: bool,
    _notification_writer: Option<&mut NotificationWriter>,
    _session_json_path: Option<&Path>,
) -> Result<i32, Error> {
    let mut buf = [0; 4096];
    let mut read_stdin = is_tty;
    let mut done = false;
    let stdin = io::stdin();

    let got_winch = Arc::new(AtomicBool::new(false));
    if is_tty {
        signal_hook::flag::register(SIGWINCH, Arc::clone(&got_winch)).ok();
    }

    while !done {
        if got_winch.load(Ordering::Relaxed) {
            forward_winsize(
                master.as_fd(),
                stderr.as_ref().map(|x| x.as_fd()),
                &mut stream_writer,
            )?;
            got_winch.store(false, Ordering::Relaxed);
        }

        let mut read_fds = FdSet::new();
        let mut timeout = TimeVal::new(0, 100_000); // 100ms timeout
        read_fds.insert(master.as_fd());
        if !read_stdin && is_tty {
            read_stdin = true;
        }
        if read_stdin {
            read_fds.insert(stdin.as_fd());
        }
        if let Some(ref f) = in_file {
            read_fds.insert(f.as_fd());
        }
        if let Some(ref fd) = stderr {
            read_fds.insert(fd.as_fd());
        }
        match select(None, Some(&mut read_fds), None, None, Some(&mut timeout)) {
            Ok(0) => {
                // Timeout occurred - just continue
                continue;
            }
            Err(Errno::EINTR | Errno::EAGAIN) => continue,
            Ok(_) => {}
            Err(err) => return Err(err.into()),
        }

        if read_fds.contains(stdin.as_fd()) {
            match read(&stdin, &mut buf) {
                Ok(0) => {
                    send_eof_sequence(master.as_fd());
                    read_stdin = false;
                }
                Ok(n) => {
                    write_all(master.as_fd(), &buf[..n])?;
                }
                Err(Errno::EINTR | Errno::EAGAIN) => {}
                // on linux a closed tty raises EIO
                Err(Errno::EIO) => {
                    done = true;
                }
                Err(err) => return Err(err.into()),
            }
        }
        if let Some(ref f) = in_file {
            if read_fds.contains(f.as_fd()) {
                // use read() here so that we can handle EAGAIN/EINTR
                // without this we might receive resource temporary unavailable
                // see https://github.com/mitsuhiko/teetty/issues/3
                match read(f, &mut buf) {
                    Ok(0) | Err(Errno::EAGAIN | Errno::EINTR) => {}
                    Err(err) => return Err(err.into()),
                    Ok(n) => {
                        write_all(master.as_fd(), &buf[..n])?;
                    }
                }
            }
        }
        if let Some(ref fd) = stderr {
            if read_fds.contains(fd.as_fd()) {
                match read(fd, &mut buf) {
                    Ok(0) | Err(_) => {}
                    Ok(n) => {
                        forward_and_log(io::stderr().as_fd(), &mut None, &buf[..n], flush)?;
                    }
                }
            }
        }
        if read_fds.contains(master.as_fd()) {
            match read(&master, &mut buf) {
                // on linux a closed tty raises EIO
                Ok(0) | Err(Errno::EIO) => {
                    done = true;
                }
                Ok(n) => {
                    forward_and_log(io::stdout().as_fd(), &mut stream_writer, &buf[..n], flush)?;
                }
                Err(Errno::EAGAIN | Errno::EINTR) => {}
                Err(err) => return Err(err.into()),
            }
        }
    }

    Ok(match waitpid(child, None)? {
        WaitStatus::Exited(_, status) => status,
        WaitStatus::Signaled(_, signal, _) => 128 + signal as i32,
        _ => 1,
    })
}

fn forward_and_log(
    fd: BorrowedFd,
    stream_writer: &mut Option<&mut StreamWriter>,
    buf: &[u8],
    _flush: bool,
) -> Result<(), Error> {
    if let Some(writer) = stream_writer {
        writer.write_output(buf)?;
    }
    write_all(fd, buf)?;
    Ok(())
}

/// Forwards the winsize and emits SIGWINCH
fn forward_winsize(
    master: BorrowedFd,
    stderr_master: Option<BorrowedFd>,
    stream_writer: &mut Option<&mut StreamWriter>,
) -> Result<(), Error> {
    if let Some(winsize) = get_winsize(io::stdin().as_fd()) {
        set_winsize(master, winsize).ok();
        if let Some(second_master) = stderr_master {
            set_winsize(second_master, winsize).ok();
        }
        if let Ok(pgrp) = tcgetpgrp(master) {
            killpg(pgrp, Signal::SIGWINCH).ok();
        }

        // Log resize event to stream writer
        if let Some(writer) = stream_writer {
            let time = writer.elapsed_time();
            let event = AsciinemaEvent {
                time,
                event_type: AsciinemaEventType::Resize,
                data: format!("{col}x{row}", col = winsize.ws_col, row = winsize.ws_row),
            };
            writer.write_event(event)?;
        }
    }
    Ok(())
}

/// If possible, returns the terminal size of the given fd.
fn get_winsize(fd: BorrowedFd) -> Option<Winsize> {
    nix::ioctl_read_bad!(_get_window_size, TIOCGWINSZ, Winsize);
    let mut size: Winsize = unsafe { std::mem::zeroed() };
    unsafe { _get_window_size(fd.as_raw_fd(), &mut size).ok()? };
    Some(size)
}

/// Sets the winsize
fn set_winsize(fd: BorrowedFd, winsize: Winsize) -> Result<(), Error> {
    nix::ioctl_write_ptr_bad!(_set_window_size, TIOCSWINSZ, Winsize);
    unsafe { _set_window_size(fd.as_raw_fd(), &winsize) }?;
    Ok(())
}

/// Sends an EOF signal to the terminal if it's in canonical mode.
fn send_eof_sequence(fd: BorrowedFd) {
    if let Ok(attrs) = tcgetattr(fd) {
        if attrs.local_flags.contains(LocalFlags::ICANON) {
            write(fd, &[attrs.control_chars[VEOF]]).ok();
        }
    }
}

/// Calls write in a loop until it's done.
fn write_all(fd: BorrowedFd, mut buf: &[u8]) -> Result<(), Error> {
    while !buf.is_empty() {
        // we generally assume that EINTR/EAGAIN can't happen on write()
        let n = write(fd, buf)?;
        buf = &buf[n..];
    }
    Ok(())
}

/// Creates a FIFO at the path if the file does not exist yet.
fn mkfifo_atomic(path: &Path) -> Result<(), Error> {
    match mkfifo(path, Mode::S_IRUSR | Mode::S_IWUSR) {
        Ok(()) | Err(Errno::EEXIST) => Ok(()),
        Err(err) => Err(err.into()),
    }
}

struct RestoreTerm(Termios);

impl Drop for RestoreTerm {
    fn drop(&mut self) {
        tcsetattr(io::stdin(), SetArg::TCSAFLUSH, &self.0).ok();
    }
}

/// Monitors a detached session by running a communication loop
fn monitor_detached_session(
    master: OwnedFd,
    session_json_path: Option<&Path>,
    mut notification_writer: Option<NotificationWriter>,
    mut stream_writer: Option<StreamWriter>,
    stdin_file: Option<File>,
) -> Result<(), Error> {
    let mut buf = [0; 4096];
    let mut done = false;

    while !done {
        let mut read_fds = FdSet::new();
        let mut timeout = TimeVal::new(0, 100_000); // 100ms timeout
        read_fds.insert(master.as_fd());

        if let Some(ref f) = stdin_file {
            read_fds.insert(f.as_fd());
        }

        match select(None, Some(&mut read_fds), None, None, Some(&mut timeout)) {
            Ok(0) => {
                // Timeout occurred - just continue
                continue;
            }
            Err(Errno::EINTR | Errno::EAGAIN) => continue,
            Ok(_) => {}
            Err(err) => return Err(err.into()),
        }

        if let Some(ref f) = stdin_file {
            if read_fds.contains(f.as_fd()) {
                match read(f, &mut buf) {
                    Ok(0) | Err(Errno::EAGAIN | Errno::EINTR) => {}
                    Err(err) => return Err(err.into()),
                    Ok(n) => {
                        write_all(master.as_fd(), &buf[..n])?;
                    }
                }
            }
        }

        if read_fds.contains(master.as_fd()) {
            match read(&master, &mut buf) {
                // on linux a closed tty raises EIO
                Ok(0) | Err(Errno::EIO) => {
                    done = true;
                }
                Ok(n) => {
                    // Only log to stream writer, don't write to stdout since we're detached
                    if let Some(writer) = &mut stream_writer {
                        let time = writer.elapsed_time();
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let event = AsciinemaEvent {
                            time,
                            event_type: AsciinemaEventType::Output,
                            data,
                        };
                        writer.write_event(event)?;
                    }
                }
                Err(Errno::EAGAIN | Errno::EINTR) => {}
                Err(err) => return Err(err.into()),
            }
        }
    }

    // Send exit event to stream before updating session status
    if let Some(ref mut stream_writer) = stream_writer {
        let session_id = session_json_path
            .and_then(|p| p.file_stem())
            .and_then(|s| s.to_str())
            .unwrap_or("unknown");
        let exit_event = serde_json::json!(["exit", 0, session_id]);
        let _ = stream_writer.write_raw_json(&exit_event);
    }

    // Update session status to exited
    if let Some(session_json_path) = session_json_path {
        let _ = update_session_status(session_json_path, None, "exited", Some(0));
    }

    // Send session exited notification
    if let Some(ref mut notification_writer) = notification_writer {
        let notification = NotificationEvent {
            timestamp: Timestamp::now(),
            event: "session_exited".to_string(),
            data: serde_json::json!({
                "exit_code": 0
            }),
        };
        let _ = notification_writer.write_notification(notification);
    }

    Ok(())
}
