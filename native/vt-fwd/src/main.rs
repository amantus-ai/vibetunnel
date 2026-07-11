#[cfg(target_os = "windows")]
compile_error!("vibetunnel-fwd does not support Windows");

mod asciinema;
mod control_socket;
mod git;
mod logger;
mod pty;
mod session;
mod title;
mod title_filter;

use std::collections::BTreeMap;
use std::env;
use std::error::Error;
use std::ffi::{CString, OsStr, OsString};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::mem::MaybeUninit;
use std::os::fd::RawFd;
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::os::unix::fs::{FileTypeExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use asciinema::AsciinemaWriter;
use control_socket::{Handler, Server};
use logger::{Level, Logger};
use nix::libc;
use pty::{Pty, Winsize, get_winsize_from_fd};
use session::SessionInfo;
use title_filter::TitleFilter;

const USAGE: &str = "VibeTunnel Forward (vibetunnel-fwd)\n\
\n\
Usage:\n\
  vibetunnel-fwd [--session-id <id>] [--title-mode <mode>] [--verbosity <level>] <command> [args...]\n\
\n\
Options:\n\
  --session-id <id>       Use a pre-generated session ID\n\
  --title-mode <mode>     none, filter, static\n\
  --update-title <title>  Update session title and exit (requires --session-id)\n\
  --verbosity <level>     silent, error, warn, info, verbose, debug\n\
  --log-file <path>       Override default log file path\n\
  -q/-v/-vv/-vvv          Quick verbosity\n";

type AnyError = Box<dyn Error + Send + Sync>;
const WORKER_STACK_BYTES: usize = 2 * 1024 * 1024;
const PTY_WRITE_POLL_MS: libc::c_int = 50;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum TitleMode {
    #[default]
    None,
    Filter,
    Static,
}

#[derive(Clone, Debug)]
struct Options {
    session_id: Option<String>,
    title_mode: TitleMode,
    update_title: Option<OsString>,
    verbosity: Level,
    log_file: Option<PathBuf>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            session_id: None,
            title_mode: TitleMode::None,
            update_title: None,
            verbosity: Level::Error,
            log_file: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct EnvDefaults {
    title_mode: Option<TitleMode>,
    verbosity: Option<Level>,
}

impl EnvDefaults {
    fn load() -> Self {
        let mut defaults = Self::default();
        if let Ok(value) = env::var("VIBETUNNEL_TITLE_MODE") {
            defaults.title_mode = parse_title_mode(&value);
        }
        if let Ok(value) = env::var("VIBETUNNEL_LOG_LEVEL") {
            defaults.verbosity = logger::parse_level(&value);
        }
        if env::var("VIBETUNNEL_DEBUG").is_ok_and(|value| is_truthy(&value)) {
            defaults.verbosity = Some(Level::Debug);
        }
        defaults
    }
}

#[derive(Debug)]
struct ParsedArgs {
    options: Options,
    command: Vec<OsString>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ParseError {
    Help,
    InvalidArguments,
}

#[derive(Clone, Copy, Debug)]
struct SizeInfo {
    cols: u16,
    rows: u16,
    has_size: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ExitInfo {
    exit_code: i32,
    signal: Option<u8>,
}

struct SessionContext {
    running: Arc<AtomicBool>,
    child_pid: AtomicI32,
    pty: Arc<Pty>,
    pty_mutex: Mutex<()>,
    stdout_mutex: Mutex<()>,
    session_name: Mutex<String>,
    asciinema: Arc<AsciinemaWriter>,
    title_mode: TitleMode,
    session_json_path: PathBuf,
    cwd: String,
    command: Vec<String>,
    home: String,
    last_cols: u16,
    last_rows: u16,
}

impl Handler for SessionContext {
    fn on_stdin(&self, data: &[u8]) {
        write_to_pty(self, data, true);
    }

    fn on_resize(&self, cols: u16, rows: u16) {
        resize_pty(self, cols, rows);
    }

    fn on_reset_size(&self) {
        if !is_tty(libc::STDOUT_FILENO) {
            return;
        }
        if let Ok(size) = get_winsize_from_fd(libc::STDOUT_FILENO) {
            resize_pty(self, size.ws_col, size.ws_row);
        }
    }

    fn on_kill(&self, signal: Option<i32>) {
        let pid = self.child_pid.load(Ordering::Acquire);
        if pid <= 0 {
            return;
        }
        let signal = signal.unwrap_or(libc::SIGTERM);
        // SAFETY: a negative pid addresses the child's process group.
        unsafe {
            libc::kill(-pid, signal);
        }
        self.running.store(false, Ordering::Release);
    }

    fn on_update_title(&self, raw_title: &str) {
        let sanitized = title::sanitize_title(raw_title.as_bytes());
        let _ = session::update_session_name(&self.session_json_path, &sanitized);
        replace_session_name(self, sanitized);
    }
}

fn main() {
    let exit_code = match run() {
        Ok(exit_code) => exit_code,
        Err(error) => {
            eprintln!("vibetunnel-fwd: {error}");
            1
        }
    };
    std::process::exit(exit_code);
}

fn run() -> Result<i32, AnyError> {
    mark_forwarder_started();

    let raw_args: Vec<OsString> = env::args_os().collect();
    let parsed = match parse_args(&raw_args[1..], EnvDefaults::load()) {
        Ok(parsed) => parsed,
        Err(ParseError::Help) => {
            show_usage();
            return Ok(0);
        }
        Err(ParseError::InvalidArguments) => {
            return Err(invalid_arguments("invalid arguments").into());
        }
    };
    let Options {
        session_id: requested_session_id,
        title_mode,
        update_title,
        verbosity,
        log_file,
    } = parsed.options;
    let raw_command = parsed.command;
    let command: Vec<String> = raw_command
        .iter()
        .map(|argument| argument.to_string_lossy().into_owned())
        .collect();

    if raw_args.len() <= 1 || (command.is_empty() && update_title.is_none()) {
        show_usage();
        return Ok(0);
    }

    let home_path = env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let home = home_path.to_string_lossy().into_owned();
    let default_log_path = default_log_path(&home_path);
    let logger = Arc::new(Logger::new(
        verbosity,
        Some(log_file.as_deref().unwrap_or(&default_log_path)),
    ));

    if let Some(raw_title) = update_title {
        let Some(session_id) = requested_session_id else {
            logger.error("--update-title requires --session-id");
            return Err(invalid_arguments("--update-title requires --session-id").into());
        };
        if !is_valid_session_id(&session_id) {
            logger.error(format_args!("invalid session id: {session_id}"));
            return Err(invalid_arguments("invalid session id").into());
        }

        let path = control_path(&home_path)
            .join(&session_id)
            .join("session.json");
        let sanitized = title::sanitize_title(raw_title.as_bytes());
        if let Err(error) = session::update_session_name(&path, &sanitized) {
            logger.error(format_args!("failed to update session title: {error}"));
            return Err(Box::new(error));
        }
        return Ok(0);
    }

    if command.is_empty() {
        logger.error("no command specified");
        show_usage();
        return Err(invalid_arguments("no command specified").into());
    }

    let cwd_path = env::current_dir()?;
    let cwd = cwd_path.to_string_lossy().into_owned();
    let control_path = control_path(&home_path);
    let session_id = requested_session_id.unwrap_or_else(generate_session_id);
    if !is_valid_session_id(&session_id) {
        logger.error(format_args!("invalid session id: {session_id}"));
        return Err(invalid_arguments("invalid session id").into());
    }

    let session_dir = control_path.join(&session_id);
    fs::create_dir_all(&session_dir)?;
    fs::set_permissions(&session_dir, fs::Permissions::from_mode(0o700))?;

    let session_json_path = session_dir.join("session.json");
    let stdout_path = session_dir.join("stdout");
    let stdin_path = session_dir.join("stdin");
    let ipc_path = session_dir.join("ipc.sock");
    ensure_stdin_pipe(&stdin_path)?;

    let dimensions = determine_initial_size();
    let initial_cols = dimensions.cols;
    let initial_rows = dimensions.rows;
    let session_name = title::generate_session_name(&command, &cwd, &home);
    let started_at = iso_timestamp();
    let git_info = git::detect_git_info(&cwd_path);

    let mut session_info = SessionInfo {
        id: session_id.clone(),
        name: session_name.clone(),
        command: command.clone(),
        working_dir: cwd.clone(),
        status: "starting".to_owned(),
        exit_code: None,
        started_at,
        pid: None,
        initial_cols: dimensions.has_size.then_some(initial_cols),
        initial_rows: dimensions.has_size.then_some(initial_rows),
        last_clear_offset: Some(0),
        version: Some(
            option_env!("VIBETUNNEL_VERSION")
                .unwrap_or("unknown")
                .to_owned(),
        ),
        git_repo_path: git_info.git_repo_path,
        git_branch: git_info.git_branch,
        git_ahead_count: git_info.git_ahead_count,
        git_behind_count: git_info.git_behind_count,
        git_has_changes: git_info.git_has_changes,
        git_is_worktree: git_info.git_is_worktree,
        git_main_repo_path: git_info.git_main_repo_path,
        attached_via_vt: env::var_os("VIBETUNNEL_SESSION_ID").map(|_| true),
    };
    session::write_session_info(&session_json_path, &session_info)?;

    let command_string = command.join(" ");
    let asciinema = Arc::new(AsciinemaWriter::new(
        &stdout_path,
        initial_cols,
        initial_rows,
        &command_string,
        &session_name,
    )?);
    let mut pty = Pty::open(Winsize {
        ws_col: initial_cols,
        ws_row: initial_rows,
        ws_xpixel: 0,
        ws_ypixel: 0,
    })?;

    // Build every CString and pointer vector before forking. The child branch
    // performs only async-signal-safe libc calls and never allocates.
    let exec_data = ExecData::build(&raw_command, &session_id)?;
    let cwd_c = cstring_from_os(cwd_path.as_os_str())?;
    let master_fd = pty.master_fd();
    let slave_fd = pty
        .slave_fd()
        .ok_or_else(|| invalid_arguments("PTY has no slave descriptor"))?;
    // SAFETY: no other code runs in the child before `execve`/`_exit`.
    let pid = unsafe { libc::fork() };
    if pid < 0 {
        logger.error("failed to fork");
        return Err(io::Error::last_os_error().into());
    }
    if pid == 0 {
        // SAFETY: all pointers/fds were prepared before fork and remain live.
        unsafe { exec_child(master_fd, slave_fd, &cwd_c, &exec_data) };
    }
    drop(exec_data);
    drop(cwd_c);
    pty.close_slave();

    let mut child_guard = ChildGuard::new(pid);
    let running = Arc::new(AtomicBool::new(true));
    let received_signal = Arc::new(AtomicI32::new(0));
    install_signal_handlers(running.clone(), received_signal.clone())?;

    session_info.pid = Some(pid);
    session_info.status = "running".to_owned();
    session::write_session_info(&session_json_path, &session_info)?;

    let context = Arc::new(SessionContext {
        running: running.clone(),
        child_pid: AtomicI32::new(pid),
        pty: Arc::new(pty),
        pty_mutex: Mutex::new(()),
        stdout_mutex: Mutex::new(()),
        session_name: Mutex::new(session_name),
        asciinema: asciinema.clone(),
        title_mode,
        session_json_path: session_json_path.clone(),
        cwd,
        command,
        home,
        last_cols: initial_cols,
        last_rows: initial_rows,
    });

    if title_mode == TitleMode::Static {
        let name = lock_unpoisoned(&context.session_name).clone();
        let _ = update_local_title(&context, &name);
    }

    let mut control_server = Server::start(&ipc_path, context.clone())?;
    let session_context = context.clone();
    let session_thread = thread::Builder::new()
        .name("vt-fwd-session-watcher".to_owned())
        .stack_size(WORKER_STACK_BYTES)
        .spawn(move || session_watcher_thread(&session_context))?;
    let resize_context = context.clone();
    let resize_thread = thread::Builder::new()
        .name("vt-fwd-resize-watcher".to_owned())
        .stack_size(WORKER_STACK_BYTES)
        .spawn(move || resize_watcher_thread(&resize_context))?;

    let mut raw_mode = if is_tty(libc::STDIN_FILENO) {
        RawMode::enable(libc::STDIN_FILENO).ok()
    } else {
        None
    };

    let main_loop_error = main_loop(&context, libc::STDIN_FILENO).err();
    if let Some(error) = &main_loop_error {
        logger.error(format_args!("main loop error: {error}"));
    }

    running.store(false, Ordering::Release);
    if !forward_pending_signal(pid, received_signal.as_ref()) && main_loop_error.is_some() {
        terminate_child(pid);
    }
    if let Some(mode) = raw_mode.as_mut() {
        mode.restore();
    }
    control_server.stop();
    let _ = control_server.join();
    let _ = session_thread.join();
    let _ = resize_thread.join();

    let exit_info = match wait_for_child_forwarding_signals(pid, received_signal.as_ref()) {
        Ok(info) => info,
        Err(error) => {
            logger.error(format_args!("waitpid failed: {error}"));
            ExitInfo {
                exit_code: 1,
                signal: None,
            }
        }
    };
    child_guard.disarm();

    let _ = asciinema.write_exit(exit_info.exit_code, &session_id);
    session_info.name = lock_unpoisoned(&context.session_name).clone();
    session_info.status = "exited".to_owned();
    session_info.exit_code = Some(exit_info.exit_code);
    let _ = session::write_session_info(&session_json_path, &session_info);

    Ok(exit_info.exit_code)
}

fn mark_forwarder_started() {
    let Some(path) = env::var_os("VIBETUNNEL_FWD_STARTED_FILE") else {
        return;
    };
    let _ = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path);
}

fn parse_args(args: &[OsString], defaults: EnvDefaults) -> Result<ParsedArgs, ParseError> {
    let mut options = Options::default();
    if let Some(mode) = defaults.title_mode {
        options.title_mode = mode;
    }
    if let Some(level) = defaults.verbosity {
        options.verbosity = level;
    }

    let mut index = 0;
    while index < args.len() {
        match args[index].as_os_str().as_bytes() {
            b"--help" | b"-h" => return Err(ParseError::Help),
            b"--session-id" => {
                options.session_id = Some(utf8_option_value(args, index)?.to_owned());
                index += 2;
            }
            b"--title-mode" => {
                options.title_mode = parse_title_mode(utf8_option_value(args, index)?)
                    .ok_or(ParseError::InvalidArguments)?;
                index += 2;
            }
            b"--update-title" => {
                options.update_title = Some(option_value(args, index)?.to_owned());
                index += 2;
            }
            b"--verbosity" => {
                options.verbosity = logger::parse_level(utf8_option_value(args, index)?)
                    .ok_or(ParseError::InvalidArguments)?;
                index += 2;
            }
            b"--log-file" => {
                options.log_file = Some(PathBuf::from(option_value(args, index)?));
                index += 2;
            }
            b"-q" => {
                options.verbosity = Level::Silent;
                index += 1;
            }
            b"-v" => {
                options.verbosity = Level::Info;
                index += 1;
            }
            b"-vv" => {
                options.verbosity = Level::Verbose;
                index += 1;
            }
            b"-vvv" => {
                options.verbosity = Level::Debug;
                index += 1;
            }
            b"--" => {
                index += 1;
                break;
            }
            argument if argument.starts_with(b"--") => {
                return Err(ParseError::InvalidArguments);
            }
            _ => break,
        }
    }

    let mut command = args[index..].to_vec();
    if command
        .first()
        .is_some_and(|argument| argument.as_os_str().as_bytes() == b"--")
    {
        command.remove(0);
    }
    Ok(ParsedArgs { options, command })
}

fn option_value(args: &[OsString], index: usize) -> Result<&OsStr, ParseError> {
    args.get(index + 1)
        .map(OsString::as_os_str)
        .ok_or(ParseError::InvalidArguments)
}

fn utf8_option_value(args: &[OsString], index: usize) -> Result<&str, ParseError> {
    option_value(args, index)?
        .to_str()
        .ok_or(ParseError::InvalidArguments)
}

fn show_usage() {
    let mut stdout = io::stdout().lock();
    let _ = stdout.write_all(USAGE.as_bytes());
    let _ = stdout.flush();
}

fn parse_title_mode(value: &str) -> Option<TitleMode> {
    if value.eq_ignore_ascii_case("none") {
        Some(TitleMode::None)
    } else if value.eq_ignore_ascii_case("filter") {
        Some(TitleMode::Filter)
    } else if value.eq_ignore_ascii_case("static") {
        Some(TitleMode::Static)
    } else {
        None
    }
}

fn is_truthy(value: &str) -> bool {
    value.eq_ignore_ascii_case("1") || value.eq_ignore_ascii_case("true")
}

fn default_log_path(home: &Path) -> PathBuf {
    if home.as_os_str().is_empty() {
        PathBuf::from("./.vibetunnel/log.txt")
    } else {
        home.join(".vibetunnel/log.txt")
    }
}

fn control_path(home: &Path) -> PathBuf {
    if let Some(path) = env::var_os("VIBETUNNEL_CONTROL_DIR") {
        return PathBuf::from(path);
    }
    if home.as_os_str().is_empty() {
        PathBuf::from("./.vibetunnel/control")
    } else {
        home.join(".vibetunnel/control")
    }
}

fn generate_session_id() -> String {
    let milliseconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("fwd_{milliseconds}_{}", std::process::id())
}

fn is_valid_session_id(session_id: &str) -> bool {
    !session_id.is_empty()
        && session_id.len() <= 64
        && session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn determine_initial_size() -> SizeInfo {
    let external = env::var_os("VIBETUNNEL_SESSION_ID").is_some();
    if external {
        thread::sleep(Duration::from_millis(100));
        if is_tty(libc::STDOUT_FILENO) {
            return get_winsize_from_fd(libc::STDOUT_FILENO).map_or(
                SizeInfo {
                    cols: 80,
                    rows: 24,
                    has_size: false,
                },
                |size| SizeInfo {
                    cols: size.ws_col,
                    rows: size.ws_row,
                    has_size: true,
                },
            );
        }
        return SizeInfo {
            cols: 80,
            rows: 24,
            has_size: false,
        };
    }

    if is_tty(libc::STDOUT_FILENO) {
        return get_winsize_from_fd(libc::STDOUT_FILENO).map_or(
            SizeInfo {
                cols: 120,
                rows: 40,
                has_size: true,
            },
            |size| SizeInfo {
                cols: size.ws_col,
                rows: size.ws_row,
                has_size: true,
            },
        );
    }

    SizeInfo {
        cols: 120,
        rows: 40,
        has_size: true,
    }
}

fn ensure_stdin_pipe(path: &Path) -> io::Result<()> {
    match fs::metadata(path) {
        Ok(metadata) if metadata.file_type().is_fifo() => return Ok(()),
        Ok(_) => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "stdin artifact exists but is not a named pipe",
            ));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    let path = cstring_from_os(path.as_os_str())?;
    // SAFETY: `path` is NUL-terminated and points to live memory.
    if unsafe { libc::mkfifo(path.as_ptr(), 0o600) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn iso_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let timestamp: libc::time_t = seconds.try_into().unwrap_or(libc::time_t::MAX);
    let mut broken_down = MaybeUninit::<libc::tm>::uninit();
    // SAFETY: both pointers are valid; `gmtime_r` initializes the output when
    // it returns non-null.
    let result = unsafe { libc::gmtime_r(&timestamp, broken_down.as_mut_ptr()) };
    if result.is_null() {
        return "1970-01-01T00:00:00Z".to_owned();
    }
    // SAFETY: `gmtime_r` succeeded.
    let time = unsafe { broken_down.assume_init() };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        time.tm_year + 1900,
        time.tm_mon + 1,
        time.tm_mday,
        time.tm_hour,
        time.tm_min,
        time.tm_sec
    )
}

fn is_tty(fd: RawFd) -> bool {
    // SAFETY: isatty only inspects the descriptor.
    unsafe { libc::isatty(fd) == 1 }
}

fn invalid_arguments(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

fn cstring_from_os(value: &OsStr) -> io::Result<CString> {
    CString::new(value.as_bytes())
        .map_err(|_| invalid_arguments("argument or path contains an embedded NUL"))
}

struct ExecData {
    executable: CString,
    _argv_storage: Vec<CString>,
    argv: Vec<*const libc::c_char>,
    _env_storage: Vec<CString>,
    envp: Vec<*const libc::c_char>,
}

impl ExecData {
    fn build(command: &[OsString], session_id: &str) -> io::Result<Self> {
        let executable_name = command
            .first()
            .ok_or_else(|| invalid_arguments("empty command"))?;
        let argv_storage: Vec<CString> = command
            .iter()
            .map(|argument| CString::new(argument.as_bytes()))
            .collect::<Result<_, _>>()
            .map_err(|_| invalid_arguments("command argument contains an embedded NUL"))?;
        let mut argv: Vec<*const libc::c_char> = argv_storage
            .iter()
            .map(|argument| argument.as_ptr())
            .collect();
        argv.push(std::ptr::null());

        let mut environment: BTreeMap<OsString, OsString> = env::vars_os().collect();
        environment.remove(OsStr::new("VIBETUNNEL_FWD_STARTED_FILE"));
        environment.insert(OsString::from("TERM"), OsString::from("xterm-256color"));
        environment.insert(
            OsString::from("VIBETUNNEL_SESSION_ID"),
            OsString::from(session_id),
        );

        let path = environment
            .get(OsStr::new("PATH"))
            .cloned()
            .unwrap_or_else(|| OsString::from("/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"));
        let executable = resolve_executable(executable_name, &path)?;

        let env_storage: Vec<CString> = environment
            .into_iter()
            .map(|(key, value)| {
                let mut entry = key.into_vec();
                entry.push(b'=');
                entry.extend_from_slice(value.as_bytes());
                CString::new(entry)
                    .map_err(|_| invalid_arguments("environment contains an embedded NUL"))
            })
            .collect::<Result<_, _>>()?;
        let mut envp: Vec<*const libc::c_char> =
            env_storage.iter().map(|entry| entry.as_ptr()).collect();
        envp.push(std::ptr::null());

        Ok(Self {
            executable,
            _argv_storage: argv_storage,
            argv,
            _env_storage: env_storage,
            envp,
        })
    }
}

fn resolve_executable(executable: &OsStr, path: &OsStr) -> io::Result<CString> {
    if executable.as_bytes().contains(&b'/') {
        return CString::new(executable.as_bytes())
            .map_err(|_| invalid_arguments("executable contains an embedded NUL"));
    }

    for directory in env::split_paths(path) {
        let directory = if directory.as_os_str().is_empty() {
            Path::new(".")
        } else {
            directory.as_path()
        };
        let candidate = directory.join(executable);
        let candidate_c = cstring_from_os(candidate.as_os_str())?;
        // SAFETY: the candidate is a valid C string.
        if unsafe { libc::access(candidate_c.as_ptr(), libc::X_OK) } == 0 {
            return Ok(candidate_c);
        }
    }

    CString::new(executable.as_bytes())
        .map_err(|_| invalid_arguments("executable contains an embedded NUL"))
}

unsafe fn exec_child(master_fd: RawFd, slave_fd: RawFd, cwd: &CString, exec_data: &ExecData) -> ! {
    // Keep this branch allocation-free: after fork the inherited allocator and
    // synchronization state may be held by another vanished thread.
    // SAFETY: raw syscalls use prevalidated fds and C strings.
    if unsafe { libc::signal(libc::SIGPIPE, libc::SIG_DFL) } == libc::SIG_ERR
        || unsafe { libc::close(master_fd) } != 0
        || unsafe { libc::setsid() } < 0
        || unsafe { libc::ioctl(slave_fd, libc::TIOCSCTTY as _, 0) } < 0
        || unsafe { libc::dup2(slave_fd, libc::STDIN_FILENO) } < 0
        || unsafe { libc::dup2(slave_fd, libc::STDOUT_FILENO) } < 0
        || unsafe { libc::dup2(slave_fd, libc::STDERR_FILENO) } < 0
        || unsafe { libc::close(slave_fd) } != 0
        || unsafe { libc::chdir(cwd.as_ptr()) } != 0
    {
        unsafe { libc::_exit(126) };
    }

    unsafe {
        libc::execve(
            exec_data.executable.as_ptr(),
            exec_data.argv.as_ptr(),
            exec_data.envp.as_ptr(),
        );
        libc::_exit(127);
    }
}

fn install_signal_handlers(
    running: Arc<AtomicBool>,
    received_signal: Arc<AtomicI32>,
) -> io::Result<()> {
    for signal in [libc::SIGINT, libc::SIGTERM] {
        let running = running.clone();
        let received_signal = received_signal.clone();
        // SAFETY: the registered action performs only lock-free atomic stores,
        // which are async-signal-safe and cannot unwind.
        unsafe {
            signal_hook::low_level::register(signal, move || {
                received_signal.store(signal, Ordering::Release);
                running.store(false, Ordering::Release);
            })?;
        }
    }
    Ok(())
}

struct RawMode {
    fd: RawFd,
    original: libc::termios,
    restored: bool,
}

impl RawMode {
    fn enable(fd: RawFd) -> io::Result<Self> {
        let mut original = MaybeUninit::<libc::termios>::uninit();
        // SAFETY: tcgetattr initializes `original` on success.
        if unsafe { libc::tcgetattr(fd, original.as_mut_ptr()) } != 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: tcgetattr succeeded.
        let original = unsafe { original.assume_init() };
        let mut raw = original;
        // SAFETY: `raw` is a fully initialized termios value.
        unsafe { libc::cfmakeraw(&mut raw) };
        // SAFETY: `raw` remains alive for the call.
        if unsafe { libc::tcsetattr(fd, libc::TCSANOW, &raw) } != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self {
            fd,
            original,
            restored: false,
        })
    }

    fn restore(&mut self) {
        if self.restored {
            return;
        }
        // SAFETY: `original` was captured from this descriptor.
        unsafe {
            libc::tcsetattr(self.fd, libc::TCSANOW, &self.original);
        }
        self.restored = true;
    }
}

impl Drop for RawMode {
    fn drop(&mut self) {
        self.restore();
    }
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn write_to_pty(context: &SessionContext, data: &[u8], record_input: bool) {
    let _guard = lock_unpoisoned(&context.pty_mutex);
    if write_pty_all(context, data).is_err() {
        return;
    }
    if record_input {
        let _ = context.asciinema.write_input(data);
    }
}

fn write_pty_all(context: &SessionContext, data: &[u8]) -> io::Result<()> {
    let fd = context.pty.master_fd();
    let mut offset = 0;
    while offset < data.len() {
        if !context.running.load(Ordering::Acquire) {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "forwarder is shutting down",
            ));
        }

        // SAFETY: the remaining slice is valid for the duration of `write`.
        let written = unsafe {
            libc::write(
                fd,
                data[offset..].as_ptr().cast::<libc::c_void>(),
                data.len() - offset,
            )
        };
        if written > 0 {
            offset += written as usize;
            continue;
        }
        if written == 0 {
            return Err(io::Error::new(
                io::ErrorKind::WriteZero,
                "PTY write returned zero",
            ));
        }

        let error = io::Error::last_os_error();
        if error.kind() == io::ErrorKind::Interrupted {
            continue;
        }
        if error.kind() != io::ErrorKind::WouldBlock {
            return Err(error);
        }

        let mut poll_fd = libc::pollfd {
            fd,
            events: libc::POLLOUT,
            revents: 0,
        };
        // SAFETY: poll_fd remains valid throughout the call.
        let ready = unsafe { libc::poll(&raw mut poll_fd, 1, PTY_WRITE_POLL_MS) };
        if ready < 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error);
        }
        if ready > 0 && poll_fd.revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0 {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "PTY closed while waiting to write",
            ));
        }
    }
    Ok(())
}

fn write_fd_all(fd: RawFd, data: &[u8]) -> io::Result<()> {
    let mut offset = 0;
    while offset < data.len() {
        // SAFETY: the remaining slice is valid for the duration of `write`.
        let written = unsafe {
            libc::write(
                fd,
                data[offset..].as_ptr().cast::<libc::c_void>(),
                data.len() - offset,
            )
        };
        if written < 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EINTR) {
                continue;
            }
            return Err(error);
        }
        if written == 0 {
            return Err(io::Error::new(
                io::ErrorKind::WriteZero,
                "descriptor write returned zero",
            ));
        }
        // Partial writes must resume at the first byte the kernel did not consume.
        offset += written as usize;
    }
    Ok(())
}

fn resize_pty(context: &SessionContext, cols: u16, rows: u16) {
    if cols == 0 || rows == 0 {
        return;
    }
    let _ = context.pty.set_size(Winsize {
        ws_col: cols,
        ws_row: rows,
        ws_xpixel: 0,
        ws_ypixel: 0,
    });
    let _ = context.asciinema.write_resize(cols, rows);
}

fn update_local_title(context: &SessionContext, name: &str) -> io::Result<()> {
    let safe_name = title::sanitize_title(name.as_bytes());
    let sequence = match context.title_mode {
        TitleMode::None | TitleMode::Filter => format!("\x1b]2;{safe_name}\x07"),
        TitleMode::Static => title::generate_title_sequence(
            &context.cwd,
            &context.command,
            Some(&safe_name),
            &context.home,
        ),
    };

    let _guard = lock_unpoisoned(&context.stdout_mutex);
    write_fd_all(libc::STDOUT_FILENO, sequence.as_bytes())
}

fn replace_session_name(context: &SessionContext, name: String) {
    let mut current_name = lock_unpoisoned(&context.session_name);
    if *current_name == name {
        return;
    }
    *current_name = name;
    let _ = update_local_title(context, &current_name);
}

fn session_watcher_thread(context: &SessionContext) {
    let mut last_modified = fs::metadata(&context.session_json_path)
        .and_then(|metadata| metadata.modified())
        .ok();

    while context.running.load(Ordering::Acquire) {
        thread::sleep(Duration::from_millis(500));
        let Ok(modified) =
            fs::metadata(&context.session_json_path).and_then(|metadata| metadata.modified())
        else {
            continue;
        };
        if last_modified == Some(modified) {
            continue;
        }
        last_modified = Some(modified);
        if let Some(name) = session::read_session_name(&context.session_json_path) {
            replace_session_name(context, name);
        }
    }
}

fn resize_watcher_thread(context: &SessionContext) {
    if !is_tty(libc::STDOUT_FILENO) {
        return;
    }
    let mut last_cols = context.last_cols;
    let mut last_rows = context.last_rows;

    while context.running.load(Ordering::Acquire) {
        thread::sleep(Duration::from_millis(200));
        let Ok(size) = get_winsize_from_fd(libc::STDOUT_FILENO) else {
            continue;
        };
        if size.ws_col == last_cols && size.ws_row == last_rows {
            continue;
        }
        last_cols = size.ws_col;
        last_rows = size.ws_row;
        resize_pty(context, size.ws_col, size.ws_row);
    }
}

fn main_loop(context: &SessionContext, stdin_fd: RawFd) -> io::Result<()> {
    let mut stdin_active = true;
    let mut poll_fds = [
        libc::pollfd {
            fd: context.pty.master_fd(),
            events: libc::POLLIN,
            revents: 0,
        },
        libc::pollfd {
            fd: stdin_fd,
            events: libc::POLLIN,
            revents: 0,
        },
    ];
    let mut buffer = [0_u8; 8192];
    let mut filtered = Vec::new();
    let mut title_filter = TitleFilter::new();

    while context.running.load(Ordering::Acquire) {
        if !stdin_active {
            poll_fds[1].fd = -1;
            poll_fds[1].events = 0;
        }
        poll_fds[0].revents = 0;
        poll_fds[1].revents = 0;
        // SAFETY: the fixed-size pollfd array remains valid throughout `poll`.
        let ready = unsafe { libc::poll(poll_fds.as_mut_ptr(), poll_fds.len() as _, 200) };
        if ready < 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EINTR) {
                continue;
            }
            return Err(error);
        }
        if ready == 0 {
            continue;
        }

        if poll_fds[0].revents & libc::POLLIN != 0 {
            // SAFETY: `buffer` is writable for its full length.
            let read = unsafe {
                libc::read(
                    context.pty.master_fd(),
                    buffer.as_mut_ptr().cast::<libc::c_void>(),
                    buffer.len(),
                )
            };
            if read < 0 {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::WouldBlock {
                    continue;
                }
                match error.raw_os_error() {
                    Some(libc::EINTR) => continue,
                    Some(libc::EIO) => break,
                    _ => return Err(error),
                }
            }
            if read == 0 {
                break;
            }

            let chunk = &buffer[..read as usize];
            let output = if context.title_mode == TitleMode::None {
                chunk
            } else {
                filtered.clear();
                title_filter.filter(chunk, &mut filtered);
                filtered.as_slice()
            };
            if !output.is_empty() {
                let _ = context.asciinema.write_output(output);
                let _guard = lock_unpoisoned(&context.stdout_mutex);
                let _ = write_fd_all(libc::STDOUT_FILENO, output);
            }
        }

        if poll_fds[0].revents & libc::POLLIN == 0
            && poll_fds[0].revents & (libc::POLLHUP | libc::POLLERR | libc::POLLNVAL) != 0
        {
            break;
        }

        if stdin_active
            && poll_fds[1].revents & (libc::POLLHUP | libc::POLLERR | libc::POLLNVAL) != 0
        {
            stdin_active = false;
        } else if stdin_active && poll_fds[1].revents & libc::POLLIN != 0 {
            // SAFETY: `buffer` is writable for its full length.
            let read = unsafe {
                libc::read(
                    stdin_fd,
                    buffer.as_mut_ptr().cast::<libc::c_void>(),
                    buffer.len(),
                )
            };
            if read < 0 {
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(libc::EINTR) {
                    continue;
                }
                return Err(error);
            }
            if read == 0 {
                stdin_active = false;
            } else {
                write_to_pty(context, &buffer[..read as usize], true);
            }
        }
    }
    Ok(())
}

fn decode_exit_status(status: u32) -> ExitInfo {
    if status & 0x7f == 0 {
        ExitInfo {
            exit_code: ((status >> 8) & 0xff) as i32,
            signal: None,
        }
    } else {
        let signal = (status & 0x7f) as u8;
        ExitInfo {
            exit_code: 128 + i32::from(signal),
            signal: Some(signal),
        }
    }
}

fn signal_process_group(pid: libc::pid_t, signal: i32) {
    if pid > 0 {
        // SAFETY: negative pid targets the process group created by setsid.
        unsafe {
            libc::kill(-pid, signal);
        }
    }
}

fn forward_pending_signal(pid: libc::pid_t, received_signal: &AtomicI32) -> bool {
    let signal = received_signal.swap(0, Ordering::AcqRel);
    if signal == 0 {
        return false;
    }
    signal_process_group(pid, signal);
    true
}

fn terminate_child(pid: libc::pid_t) {
    signal_process_group(pid, libc::SIGTERM);
}

fn wait_for_child(pid: libc::pid_t) -> io::Result<ExitInfo> {
    loop {
        let mut status = 0;
        // SAFETY: status points to valid writable storage.
        let result = unsafe { libc::waitpid(pid, &mut status, 0) };
        if result == pid {
            return Ok(decode_exit_status(status as u32));
        }
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::EINTR) {
            continue;
        }
        return Err(error);
    }
}

fn wait_for_child_forwarding_signals(
    pid: libc::pid_t,
    received_signal: &AtomicI32,
) -> io::Result<ExitInfo> {
    loop {
        forward_pending_signal(pid, received_signal);
        let mut status = 0;
        // WNOHANG keeps signal delivery race-free: every pending signal is
        // drained before the next bounded wait for child exit.
        let result = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
        if result == pid {
            return Ok(decode_exit_status(status as u32));
        }
        if result == 0 {
            thread::sleep(Duration::from_millis(25));
            continue;
        }
        let error = io::Error::last_os_error();
        if error.kind() == io::ErrorKind::Interrupted {
            continue;
        }
        return Err(error);
    }
}

struct ChildGuard {
    pid: libc::pid_t,
    active: bool,
}

impl ChildGuard {
    fn new(pid: libc::pid_t) -> Self {
        Self { pid, active: true }
    }

    fn disarm(&mut self) {
        self.active = false;
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.active {
            terminate_child(self.pid);
            let _ = wait_for_child(self.pid);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::ffi::OsStringExt;

    fn os_strings(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    #[test]
    fn parse_args_handles_verbosity_and_command_boundaries() {
        let parsed = parse_args(
            &os_strings(&["-q", "echo", "hello"]),
            EnvDefaults::default(),
        )
        .expect("parse arguments");
        assert_eq!(parsed.options.verbosity, Level::Silent);
        assert_eq!(parsed.command, os_strings(&["echo", "hello"]));

        let parsed = parse_args(
            &os_strings(&["--", "--", "echo", "hello"]),
            EnvDefaults::default(),
        )
        .expect("parse doubled boundary");
        assert_eq!(parsed.command, os_strings(&["echo", "hello"]));
    }

    #[test]
    fn parse_args_applies_environment_defaults_and_cli_overrides() {
        let defaults = EnvDefaults {
            title_mode: Some(TitleMode::Filter),
            verbosity: Some(Level::Debug),
        };
        let parsed = parse_args(
            &os_strings(&["--title-mode", "static", "-v", "bash"]),
            defaults,
        )
        .expect("parse overrides");
        assert_eq!(parsed.options.title_mode, TitleMode::Static);
        assert_eq!(parsed.options.verbosity, Level::Info);
        assert_eq!(parsed.command, os_strings(&["bash"]));
    }

    #[test]
    fn parse_args_rejects_missing_values_unknown_options_and_invalid_values() {
        assert_eq!(
            parse_args(&os_strings(&["--session-id"]), EnvDefaults::default()).unwrap_err(),
            ParseError::InvalidArguments
        );
        assert_eq!(
            parse_args(&os_strings(&["--unknown"]), EnvDefaults::default()).unwrap_err(),
            ParseError::InvalidArguments
        );
        assert_eq!(
            parse_args(
                &os_strings(&["--title-mode", "dynamic", "bash"]),
                EnvDefaults::default()
            )
            .unwrap_err(),
            ParseError::InvalidArguments
        );
    }

    #[test]
    fn parse_args_preserves_non_utf8_path_and_title_values() {
        let log_path = OsString::from_vec(b"/tmp/log-\xff".to_vec());
        let title = OsString::from_vec(b"title-\xff".to_vec());
        let args = vec![
            OsString::from("--log-file"),
            log_path.clone(),
            OsString::from("--update-title"),
            title.clone(),
        ];

        let parsed = parse_args(&args, EnvDefaults::default()).expect("parse raw option values");
        assert_eq!(parsed.options.log_file, Some(PathBuf::from(log_path)));
        assert_eq!(parsed.options.update_title, Some(title));
    }

    #[test]
    fn session_ids_are_bounded_and_path_safe() {
        assert!(is_valid_session_id("fwd_123_456"));
        assert!(is_valid_session_id("a-Z_09"));
        assert!(!is_valid_session_id(""));
        assert!(!is_valid_session_id("../escape"));
        assert!(!is_valid_session_id(&"a".repeat(65)));
    }

    #[test]
    fn exit_status_decoding_matches_shell_conventions() {
        assert_eq!(
            decode_exit_status(7 << 8),
            ExitInfo {
                exit_code: 7,
                signal: None
            }
        );
        assert_eq!(
            decode_exit_status(15),
            ExitInfo {
                exit_code: 143,
                signal: Some(15)
            }
        );
    }

    #[test]
    fn exec_data_preserves_non_utf8_command_arguments() {
        let command = vec![OsString::from("/bin/echo"), OsString::from_vec(vec![0xff])];
        let data = ExecData::build(&command, "test-session").expect("build exec data");
        assert_eq!(data._argv_storage[1].as_bytes(), &[0xff]);
    }

    #[test]
    fn default_paths_preserve_non_utf8_home() {
        let home = PathBuf::from(OsString::from_vec(b"/tmp/home-\xff".to_vec()));
        assert_eq!(default_log_path(&home), home.join(".vibetunnel/log.txt"));
    }
}
