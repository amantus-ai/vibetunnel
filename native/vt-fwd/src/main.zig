const std = @import("std");
const posix = std.posix;

const asciinema_mod = @import("asciinema.zig");
const control_socket = @import("control_socket.zig");
const git_mod = @import("git.zig");
const logger_mod = @import("logger.zig");
const pty_mod = @import("pty.zig");
const session_mod = @import("session.zig");
const title_mod = @import("title.zig");
const title_filter_mod = @import("title_filter.zig");
const build_options = @import("build_options");

const c = @cImport({
    @cInclude("termios.h");
    @cInclude("signal.h");
    @cInclude("sys/stat.h");
    @cInclude("sys/ioctl.h");
});

const TitleMode = enum {
    none,
    filter,
    static,
    dynamic,
};

const Options = struct {
    session_id: ?[]const u8 = null,
    title_mode: TitleMode = .none,
    update_title: ?[]const u8 = null,
    verbosity: logger_mod.Level = logger_mod.Level.@"error",
    log_file: ?[]const u8 = null,
};

const ParsedArgs = struct {
    options: Options,
    command: []const []const u8,
};

const SessionContext = struct {
    allocator: std.mem.Allocator,
    logger: *logger_mod.Logger,
    running: *std.atomic.Value(bool),
    pty: *pty_mod.Pty,
    pty_mutex: std.Thread.Mutex = .{},
    stdout_mutex: std.Thread.Mutex = .{},
    session_mutex: std.Thread.Mutex = .{},
    asciinema: *asciinema_mod.AsciinemaWriter,
    title_mode: TitleMode,
    title_filter: title_filter_mod.TitleFilter = .{},
    session_id: []const u8,
    session_dir: []const u8,
    session_json_path: []const u8,
    ipc_path: []const u8,
    cwd: []const u8,
    command: []const []const u8,
    home: []const u8,
    session_name: []const u8,
    last_cols: u16,
    last_rows: u16,
};

const RawMode = struct {
    fd: posix.fd_t,
    orig: c.termios,

    fn enable(fd: posix.fd_t) !RawMode {
        var term: c.termios = undefined;
        if (c.tcgetattr(fd, &term) != 0) return error.TermiosFailed;
        var raw = term;
        c.cfmakeraw(&raw);
        if (c.tcsetattr(fd, c.TCSANOW, &raw) != 0) return error.TermiosFailed;
        return .{ .fd = fd, .orig = term };
    }

    fn restore(self: *RawMode) void {
        _ = c.tcsetattr(self.fd, c.TCSANOW, &self.orig);
    }
};

const EnvDefaults = struct {
    title_mode: ?TitleMode = null,
    verbosity: ?logger_mod.Level = null,

    fn load(self: *EnvDefaults) void {
        if (std.posix.getenv("VIBETUNNEL_TITLE_MODE")) |val| {
            if (parseTitleMode(std.mem.sliceTo(val, 0))) |mode| {
                self.title_mode = mode;
            }
        }
        if (std.posix.getenv("VIBETUNNEL_LOG_LEVEL")) |val| {
            if (logger_mod.parseLevel(std.mem.sliceTo(val, 0))) |level| {
                self.verbosity = level;
            }
        }
        if (std.posix.getenv("VIBETUNNEL_DEBUG")) |val| {
            if (isTruthy(std.mem.sliceTo(val, 0))) {
                self.verbosity = .debug;
            }
        }
    }
};

const SizeInfo = struct {
    cols: u16,
    rows: u16,
    has_size: bool,
};

const ExecEnv = struct {
    arena: std.heap.ArenaAllocator,
    argv: [:null]?[*:0]const u8,
    envp: [:null]?[*:0]u8,

    fn deinit(self: *ExecEnv) void {
        self.arena.deinit();
    }
};

const ExitInfo = struct {
    exit_code: i32,
    signal: ?u8,
};

var g_running = std.atomic.Value(bool).init(true);
var g_signal = std.atomic.Value(i32).init(0);
var g_child_pid = std.atomic.Value(i32).init(-1);

fn handleSignal(sig: c_int) callconv(.c) void {
    g_running.store(false, .release);
    g_signal.store(@intCast(sig), .release);
}

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{ .thread_safe = true }){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);

    var args_plain = try allocator.alloc([]const u8, args.len);
    defer allocator.free(args_plain);
    for (args, 0..) |arg, idx| {
        args_plain[idx] = std.mem.sliceTo(arg, 0);
    }

    var defaults = EnvDefaults{};
    defaults.load();

    const parsed = try parseArgs(args_plain[1..], defaults);
    const options = parsed.options;
    const command = parsed.command;

    if (args_plain.len <= 1 or (command.len == 0 and options.update_title == null)) {
        showUsage();
        return;
    }

    const home = getHome();
    const log_path = options.log_file orelse defaultLogPath(allocator, home) catch null;
    var logger = logger_mod.Logger.init(options.verbosity, log_path);
    defer logger.deinit();

    if (options.update_title) |title| {
        if (options.session_id == null) {
            logger.logError("--update-title requires --session-id", .{});
            return error.InvalidArguments;
        }
        const session_id = options.session_id.?;
        if (!isValidSessionId(session_id)) {
            logger.logError("invalid session id: {s}", .{session_id});
            return error.InvalidArguments;
        }
        const control_path = try controlPath(allocator, home);
        const session_json_path = try std.fs.path.join(allocator, &.{ control_path, session_id, "session.json" });
        defer allocator.free(control_path);
        defer allocator.free(session_json_path);

        var arena = std.heap.ArenaAllocator.init(allocator);
        defer arena.deinit();
        const sanitized = try title_mod.sanitizeTitle(arena.allocator(), title);
        session_mod.updateSessionName(arena.allocator(), session_json_path, sanitized) catch |err| {
            logger.logError("failed to update session title: {s}", .{@errorName(err)});
            return err;
        };
        return;
    }

    if (command.len == 0) {
        logger.logError("no command specified", .{});
        showUsage();
        return error.InvalidArguments;
    }

    var title_mode = options.title_mode;
    if (title_mode == .none and containsClaude(command)) {
        title_mode = .dynamic;
    }

    const cwd = try std.process.getCwdAlloc(allocator);

    const control_path = try controlPath(allocator, home);
    const session_id = options.session_id orelse try generateSessionId(allocator);
    if (!isValidSessionId(session_id)) {
        logger.logError("invalid session id: {s}", .{session_id});
        return error.InvalidArguments;
    }

    const session_dir = try std.fs.path.join(allocator, &.{ control_path, session_id });
    try std.fs.cwd().makePath(session_dir);

    const session_json_path = try std.fs.path.join(allocator, &.{ session_dir, "session.json" });
    const stdout_path = try std.fs.path.join(allocator, &.{ session_dir, "stdout" });
    const stdin_path = try std.fs.path.join(allocator, &.{ session_dir, "stdin" });
    const ipc_path = try std.fs.path.join(allocator, &.{ session_dir, "ipc.sock" });

    ensureStdinPipe(stdin_path);

    const dims = try determineInitialSize();
    const initial_cols = dims.cols;
    const initial_rows = dims.rows;

    const session_name = try title_mod.generateSessionName(allocator, command, cwd, home);
    const started_at = try isoTimestamp(allocator);
    const git_info = git_mod.detectGitInfo(allocator, cwd);

    var session_info = session_mod.SessionInfo{
        .id = session_id,
        .name = session_name,
        .command = command,
        .workingDir = cwd,
        .status = "starting",
        .startedAt = started_at,
        .pid = null,
        .initialCols = if (dims.has_size) initial_cols else null,
        .initialRows = if (dims.has_size) initial_rows else null,
        .lastClearOffset = 0,
        .version = build_options.version,
        .gitRepoPath = git_info.gitRepoPath,
        .gitBranch = git_info.gitBranch,
        .gitAheadCount = git_info.gitAheadCount,
        .gitBehindCount = git_info.gitBehindCount,
        .gitHasChanges = git_info.gitHasChanges,
        .gitIsWorktree = git_info.gitIsWorktree,
        .gitMainRepoPath = git_info.gitMainRepoPath,
        .attachedViaVT = if (std.posix.getenv("VIBETUNNEL_SESSION_ID") != null) true else null,
    };

    try session_mod.writeSessionInfo(session_json_path, session_info, allocator);

    const command_string = try joinCommand(allocator, command);
    defer allocator.free(command_string);

    var asciinema_writer = try asciinema_mod.AsciinemaWriter.init(
        allocator,
        stdout_path,
        initial_cols,
        initial_rows,
        command_string,
        session_name,
    );

    const winsize = pty_mod.winsize{ .ws_col = initial_cols, .ws_row = initial_rows, .ws_xpixel = 0, .ws_ypixel = 0 };
    var pty = try pty_mod.Pty.open(winsize);

    var exec_env = try buildExecEnv(allocator, command, session_id);
    const pid = posix.fork() catch |err| {
        logger.logError("failed to fork: {s}", .{@errorName(err)});
        exec_env.deinit();
        return err;
    };

    if (pid == 0) {
        _ = posix.close(pty.master);
        _ = posix.setsid() catch {};
        _ = c.ioctl(pty.slave, pty_mod.TIOCSCTTY, @as(c_ulong, 0));
        _ = posix.dup2(pty.slave, 0) catch {};
        _ = posix.dup2(pty.slave, 1) catch {};
        _ = posix.dup2(pty.slave, 2) catch {};
        _ = posix.close(pty.slave);

        _ = posix.chdir(cwd) catch {};

        _ = posix.execvpeZ(exec_env.argv[0].?, exec_env.argv.ptr, exec_env.envp.ptr) catch {};
        posix.exit(127);
    }

    exec_env.deinit();

    _ = posix.close(pty.slave);
    pty.slave = -1;

    g_running.store(true, .release);
    g_signal.store(0, .release);
    g_child_pid.store(@intCast(pid), .release);

    installSignalHandlers();

    session_info.pid = @intCast(pid);
    session_info.status = "running";
    try session_mod.writeSessionInfo(session_json_path, session_info, allocator);

    var ctx = SessionContext{
        .allocator = allocator,
        .logger = &logger,
        .running = &g_running,
        .pty = &pty,
        .asciinema = &asciinema_writer,
        .title_mode = title_mode,
        .session_id = session_id,
        .session_dir = session_dir,
        .session_json_path = session_json_path,
        .ipc_path = ipc_path,
        .cwd = cwd,
        .command = command,
        .home = home,
        .session_name = session_name,
        .last_cols = initial_cols,
        .last_rows = initial_rows,
    };

    if (title_mode == .static or title_mode == .dynamic) {
        updateLocalTitle(&ctx, session_name) catch {};
    }

    var control_server = try control_socket.Server.init(ctx.allocator, ctx.ipc_path, .{
        .context = &ctx,
        .logger = &logger,
        .on_stdin = handleSocketStdin,
        .on_resize = handleSocketResize,
        .on_reset_size = handleSocketResetSize,
        .on_kill = handleSocketKill,
        .on_update_title = handleSocketUpdateTitle,
    }, &g_running);
    _ = try std.Thread.spawn(.{}, control_socket.Server.run, .{&control_server});

    _ = try std.Thread.spawn(.{}, sessionWatcherThread, .{&ctx});
    _ = try std.Thread.spawn(.{}, resizeWatcherThread, .{&ctx});

    var raw_mode: ?RawMode = null;
    const stdin_fd = std.fs.File.stdin().handle;
    if (posix.isatty(stdin_fd)) {
        raw_mode = RawMode.enable(stdin_fd) catch null;
    }

    mainLoop(&ctx, stdin_fd) catch |err| {
        logger.logError("main loop error: {s}", .{@errorName(err)});
    };

    g_running.store(false, .release);

    const signaled = g_signal.load(.acquire);
    if (signaled != 0) {
        const sig_u8: u8 = @as(u8, @intCast(signaled));
        _ = posix.kill(-pid, sig_u8) catch {};
    }

    const wait = posix.waitpid(pid, 0);
    const exit_info = decodeExitStatus(wait.status);

    asciinema_writer.writeExit(exit_info.exit_code, session_id) catch {};

    session_info.name = ctx.session_name;
    session_info.status = "exited";
    session_info.exitCode = exit_info.exit_code;
    session_mod.writeSessionInfo(session_json_path, session_info, allocator) catch {};

    if (raw_mode) |*mode| mode.restore();
    control_server.stop();
    pty.deinit();
    asciinema_writer.deinit();

    std.process.exit(@intCast(exit_info.exit_code));
}

fn parseArgs(args: []const []const u8, defaults: EnvDefaults) !ParsedArgs {
    var options = Options{};
    if (defaults.title_mode) |mode| options.title_mode = mode;
    if (defaults.verbosity) |level| options.verbosity = level;

    var i: usize = 0;
    while (i < args.len) {
        const arg = args[i];
        if (std.mem.eql(u8, arg, "--help") or std.mem.eql(u8, arg, "-h")) {
            showUsage();
            std.process.exit(0);
        }
        if (std.mem.eql(u8, arg, "--session-id") and i + 1 < args.len) {
            options.session_id = args[i + 1];
            i += 2;
            continue;
        }
        if (std.mem.eql(u8, arg, "--title-mode") and i + 1 < args.len) {
            const mode = parseTitleMode(args[i + 1]) orelse return error.InvalidArguments;
            options.title_mode = mode;
            i += 2;
            continue;
        }
        if (std.mem.eql(u8, arg, "--update-title") and i + 1 < args.len) {
            options.update_title = args[i + 1];
            i += 2;
            continue;
        }
        if (std.mem.eql(u8, arg, "--verbosity") and i + 1 < args.len) {
            const level = logger_mod.parseLevel(args[i + 1]) orelse return error.InvalidArguments;
            options.verbosity = level;
            i += 2;
            continue;
        }
        if (std.mem.eql(u8, arg, "--log-file") and i + 1 < args.len) {
            options.log_file = args[i + 1];
            i += 2;
            continue;
        }
        if (std.mem.eql(u8, arg, "-q")) {
            options.verbosity = .silent;
            i += 1;
            continue;
        }
        if (std.mem.eql(u8, arg, "-v")) {
            options.verbosity = .info;
            i += 1;
            continue;
        }
        if (std.mem.eql(u8, arg, "-vv")) {
            options.verbosity = .verbose;
            i += 1;
            continue;
        }
        if (std.mem.eql(u8, arg, "-vvv")) {
            options.verbosity = .debug;
            i += 1;
            continue;
        }
        if (std.mem.eql(u8, arg, "--")) {
            i += 1;
            break;
        }
        if (std.mem.startsWith(u8, arg, "--")) {
            break;
        }
        break;
    }

    var command = args[i..];
    if (command.len > 0 and std.mem.eql(u8, command[0], "--")) {
        command = command[1..];
    }

    return .{ .options = options, .command = command };
}

fn showUsage() void {
    const out = std.fs.File.stdout().deprecatedWriter();
    _ = out.writeAll("VibeTunnel Forward (vibetunnel-fwd)\n\n") catch {};
    _ = out.writeAll("Usage:\n  vibetunnel-fwd [--session-id <id>] [--title-mode <mode>] [--verbosity <level>] <command> [args...]\n\n") catch {};
    _ = out.writeAll("Options:\n  --session-id <id>       Use a pre-generated session ID\n  --title-mode <mode>     none, filter, static, dynamic\n  --update-title <title>  Update session title and exit (requires --session-id)\n  --verbosity <level>     silent, error, warn, info, verbose, debug\n  --log-file <path>       Override default log file path\n  -q/-v/-vv/-vvv          Quick verbosity\n") catch {};
}

fn parseTitleMode(value: []const u8) ?TitleMode {
    if (std.ascii.eqlIgnoreCase(value, "none")) return .none;
    if (std.ascii.eqlIgnoreCase(value, "filter")) return .filter;
    if (std.ascii.eqlIgnoreCase(value, "static")) return .static;
    if (std.ascii.eqlIgnoreCase(value, "dynamic")) return .dynamic;
    return null;
}

fn isTruthy(value: []const u8) bool {
    return std.ascii.eqlIgnoreCase(value, "1") or std.ascii.eqlIgnoreCase(value, "true");
}

fn containsClaude(command: []const []const u8) bool {
    for (command) |arg| {
        if (containsIgnoreCase(arg, "claude")) return true;
    }
    return false;
}

fn containsIgnoreCase(haystack: []const u8, needle: []const u8) bool {
    if (needle.len == 0 or haystack.len < needle.len) return false;
    var i: usize = 0;
    while (i + needle.len <= haystack.len) : (i += 1) {
        var matched = true;
        var j: usize = 0;
        while (j < needle.len) : (j += 1) {
            if (std.ascii.toLower(haystack[i + j]) != std.ascii.toLower(needle[j])) {
                matched = false;
                break;
            }
        }
        if (matched) return true;
    }
    return false;
}

fn getHome() []const u8 {
    if (std.posix.getenv("HOME")) |val| return std.mem.sliceTo(val, 0);
    return "";
}

fn defaultLogPath(allocator: std.mem.Allocator, home: []const u8) ![]const u8 {
    if (home.len == 0) return allocator.dupe(u8, "./.vibetunnel/log.txt");
    return std.fs.path.join(allocator, &.{ home, ".vibetunnel", "log.txt" });
}

fn controlPath(allocator: std.mem.Allocator, home: []const u8) ![]const u8 {
    if (home.len == 0) return allocator.dupe(u8, "./.vibetunnel/control");
    return std.fs.path.join(allocator, &.{ home, ".vibetunnel", "control" });
}

fn generateSessionId(allocator: std.mem.Allocator) ![]const u8 {
    const ts = std.time.milliTimestamp();
    return std.fmt.allocPrint(allocator, "fwd_{d}", .{ts});
}

fn isValidSessionId(session_id: []const u8) bool {
    if (session_id.len == 0) return false;
    for (session_id) |ch| {
        if (!(std.ascii.isAlphanumeric(ch) or ch == '-' or ch == '_')) return false;
    }
    return true;
}

fn determineInitialSize() !SizeInfo {
    const stdout_fd = std.fs.File.stdout().handle;
    const is_external = std.posix.getenv("VIBETUNNEL_SESSION_ID") != null;

    if (is_external) {
        std.Thread.sleep(100 * std.time.ns_per_ms);
        if (posix.isatty(stdout_fd)) {
            const ws = pty_mod.getWinsizeFromFd(stdout_fd) catch return .{ .cols = 80, .rows = 24, .has_size = false };
            return .{ .cols = ws.ws_col, .rows = ws.ws_row, .has_size = true };
        }
        return .{ .cols = 80, .rows = 24, .has_size = false };
    }

    if (posix.isatty(stdout_fd)) {
        const ws = pty_mod.getWinsizeFromFd(stdout_fd) catch return .{ .cols = 120, .rows = 40, .has_size = true };
        return .{ .cols = ws.ws_col, .rows = ws.ws_row, .has_size = true };
    }

    return .{ .cols = 120, .rows = 40, .has_size = true };
}

fn ensureStdinPipe(path: []const u8) void {
    if (std.fs.cwd().statFile(path)) |_| return else |_| {}

    const path_z = std.heap.c_allocator.dupeZ(u8, path) catch null;
    defer if (path_z) |p| std.heap.c_allocator.free(p);

    if (path_z) |p| {
        if (c.mkfifo(p, 0o600) == 0) return;
    }

    var file = std.fs.cwd().createFile(path, .{ .truncate = false, .read = false, .mode = 0o600 }) catch return;
    file.close();
}

fn isoTimestamp(allocator: std.mem.Allocator) ![]const u8 {
    const secs_signed = std.time.timestamp();
    if (secs_signed < 0) return allocator.dupe(u8, "1970-01-01T00:00:00Z");
    const secs: u64 = @intCast(secs_signed);
    const epoch = std.time.epoch.EpochSeconds{ .secs = secs };
    const day = epoch.getEpochDay().calculateYearDay();
    const month_day = day.calculateMonthDay();
    const day_seconds = epoch.getDaySeconds();

    return std.fmt.allocPrint(
        allocator,
        "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}Z",
        .{
            day.year,
            @intFromEnum(month_day.month),
            month_day.day_index + 1,
            day_seconds.getHoursIntoDay(),
            day_seconds.getMinutesIntoHour(),
            day_seconds.getSecondsIntoMinute(),
        },
    );
}

fn joinCommand(allocator: std.mem.Allocator, command: []const []const u8) ![]const u8 {
    return std.mem.join(allocator, " ", command);
}

fn buildExecEnv(allocator: std.mem.Allocator, command: []const []const u8, session_id: []const u8) !ExecEnv {
    if (command.len == 0) return error.InvalidArguments;
    var env_map = try std.process.getEnvMap(allocator);
    defer env_map.deinit();
    env_map.put("TERM", "xterm-256color") catch {};
    env_map.put("VIBETUNNEL_SESSION_ID", session_id) catch {};

    var arena = std.heap.ArenaAllocator.init(allocator);
    const arena_alloc = arena.allocator();

    const envp = try std.process.createNullDelimitedEnvMap(arena_alloc, &env_map);
    const argv = try buildArgvZ(arena_alloc, command);

    return .{ .arena = arena, .argv = argv, .envp = envp };
}

fn buildArgvZ(allocator: std.mem.Allocator, command: []const []const u8) ![:null]?[*:0]const u8 {
    var argv = try allocator.alloc(?[*:0]const u8, command.len + 1);
    for (command, 0..) |arg, idx| {
        argv[idx] = try allocator.dupeZ(u8, arg);
    }
    argv[command.len] = null;
    return argv[0..command.len :null];
}

fn installSignalHandlers() void {
    var sa = posix.Sigaction{
        .handler = .{ .handler = handleSignal },
        .mask = posix.sigemptyset(),
        .flags = 0,
    };
    _ = posix.sigaction(posix.SIG.INT, &sa, null);
    _ = posix.sigaction(posix.SIG.TERM, &sa, null);
}

fn handleSocketStdin(context: *anyopaque, data: []const u8) void {
    const ctx: *SessionContext = @ptrCast(@alignCast(context));
    writeToPty(ctx, data, true);
}

fn handleSocketResize(context: *anyopaque, cols: u16, rows: u16) void {
    const ctx: *SessionContext = @ptrCast(@alignCast(context));
    resizePty(ctx, cols, rows);
}

fn handleSocketResetSize(context: *anyopaque) void {
    const ctx: *SessionContext = @ptrCast(@alignCast(context));
    const stdout_fd = std.fs.File.stdout().handle;
    if (!posix.isatty(stdout_fd)) return;
    if (pty_mod.getWinsizeFromFd(stdout_fd)) |ws| {
        resizePty(ctx, ws.ws_col, ws.ws_row);
    } else |_| {}
}

fn handleSocketKill(context: *anyopaque, signal: ?i32) void {
    const ctx: *SessionContext = @ptrCast(@alignCast(context));
    const pid = g_child_pid.load(.acquire);
    if (pid <= 0) return;
    const sig = signal orelse @as(i32, @intCast(posix.SIG.TERM));
    const sig_u8: u8 = @as(u8, @intCast(sig));
    _ = posix.kill(-pid, sig_u8) catch {};
    ctx.running.store(false, .release);
}

fn handleSocketUpdateTitle(context: *anyopaque, title: []const u8) void {
    const ctx: *SessionContext = @ptrCast(@alignCast(context));
    var arena = std.heap.ArenaAllocator.init(ctx.allocator);
    defer arena.deinit();
    const sanitized = title_mod.sanitizeTitle(arena.allocator(), title) catch return;
    const name_copy = ctx.allocator.dupe(u8, sanitized) catch return;

    ctx.session_mutex.lock();
    ctx.session_name = name_copy;
    ctx.session_mutex.unlock();

    session_mod.updateSessionName(arena.allocator(), ctx.session_json_path, sanitized) catch {};
    updateLocalTitle(ctx, name_copy) catch {};
}

fn writeToPty(ctx: *SessionContext, data: []const u8, record_input: bool) void {
    ctx.pty_mutex.lock();
    defer ctx.pty_mutex.unlock();

    var offset: usize = 0;
    while (offset < data.len) {
        const written = posix.write(ctx.pty.master, data[offset..]) catch return;
        if (written == 0) break;
        offset += written;
    }

    if (record_input) {
        ctx.asciinema.writeInput(data) catch {};
    }
}

fn resizePty(ctx: *SessionContext, cols: u16, rows: u16) void {
    if (cols == 0 or rows == 0) return;
    const ws = pty_mod.winsize{ .ws_col = cols, .ws_row = rows, .ws_xpixel = 0, .ws_ypixel = 0 };
    ctx.pty.setSize(ws) catch {};
    ctx.asciinema.writeResize(cols, rows) catch {};
    ctx.last_cols = cols;
    ctx.last_rows = rows;
}

fn updateLocalTitle(ctx: *SessionContext, name: []const u8) !void {
    const mode = if (ctx.title_mode == .dynamic) .static else ctx.title_mode;
    const seq = if (mode == .none or mode == .filter)
        try std.fmt.allocPrint(ctx.allocator, "\x1b]2;{s}\x07", .{name})
    else
        try title_mod.generateTitleSequence(ctx.allocator, ctx.cwd, ctx.command, name, ctx.home);
    defer ctx.allocator.free(seq);

    ctx.stdout_mutex.lock();
    defer ctx.stdout_mutex.unlock();
    _ = std.fs.File.stdout().writeAll(seq) catch {};
}

fn sessionWatcherThread(ctx: *SessionContext) void {
    var last_mtime: i128 = 0;
    if (std.fs.cwd().statFile(ctx.session_json_path)) |stat| {
        last_mtime = stat.mtime;
    } else |_| {}

    while (ctx.running.load(.acquire)) {
        std.Thread.sleep(500 * std.time.ns_per_ms);
        const stat = std.fs.cwd().statFile(ctx.session_json_path) catch continue;
        if (stat.mtime == last_mtime) continue;
        last_mtime = stat.mtime;

        var arena = std.heap.ArenaAllocator.init(ctx.allocator);
        defer arena.deinit();
        const name_tmp = session_mod.readSessionName(arena.allocator(), ctx.session_json_path) catch null;
        if (name_tmp == null) continue;
        const name_copy = ctx.allocator.dupe(u8, name_tmp.?) catch continue;

        ctx.session_mutex.lock();
        const should_update = !std.mem.eql(u8, ctx.session_name, name_copy);
        if (should_update) ctx.session_name = name_copy;
        ctx.session_mutex.unlock();

        if (should_update) {
            updateLocalTitle(ctx, name_copy) catch {};
        }
    }
}

fn resizeWatcherThread(ctx: *SessionContext) void {
    const stdout_fd = std.fs.File.stdout().handle;
    if (!posix.isatty(stdout_fd)) return;
    var last_cols = ctx.last_cols;
    var last_rows = ctx.last_rows;

    while (ctx.running.load(.acquire)) {
        std.Thread.sleep(200 * std.time.ns_per_ms);
        const ws = pty_mod.getWinsizeFromFd(stdout_fd) catch continue;
        if (ws.ws_col == last_cols and ws.ws_row == last_rows) continue;
        last_cols = ws.ws_col;
        last_rows = ws.ws_row;
        resizePty(ctx, ws.ws_col, ws.ws_row);
    }
}

fn mainLoop(ctx: *SessionContext, stdin_fd: posix.fd_t) !void {
    var stdin_active = true;
    var poll_fds = [_]posix.pollfd{
        .{ .fd = ctx.pty.master, .events = posix.POLL.IN, .revents = 0 },
        .{ .fd = stdin_fd, .events = posix.POLL.IN, .revents = 0 },
    };

    var buffer: [8192]u8 = undefined;
    var filtered = std.ArrayList(u8).empty;
    defer filtered.deinit(ctx.allocator);

    while (ctx.running.load(.acquire)) {
        if (!stdin_active) {
            poll_fds[1].fd = -1;
            poll_fds[1].events = 0;
        }

        const ready = try posix.poll(&poll_fds, 200);

        if (ready == 0) continue;

        if (poll_fds[0].revents & (posix.POLL.HUP | posix.POLL.ERR | posix.POLL.NVAL) != 0) {
            break;
        }

        if (poll_fds[0].revents & posix.POLL.IN != 0) {
            const read_len = try posix.read(ctx.pty.master, &buffer);
            if (read_len == 0) break;

            const chunk = buffer[0..read_len];
            var output_slice = chunk;
            if (ctx.title_mode != .none) {
                filtered.clearRetainingCapacity();
                ctx.title_filter.filter(ctx.allocator, chunk, &filtered) catch {};
                output_slice = filtered.items;
            }

            if (output_slice.len > 0) {
                ctx.asciinema.writeOutput(output_slice) catch {};
                ctx.stdout_mutex.lock();
                _ = std.fs.File.stdout().writeAll(output_slice) catch {};
                ctx.stdout_mutex.unlock();
            }
        }

        if (stdin_active and poll_fds[1].revents & (posix.POLL.HUP | posix.POLL.ERR | posix.POLL.NVAL) != 0) {
            stdin_active = false;
        } else if (stdin_active and poll_fds[1].revents & posix.POLL.IN != 0) {
            const read_len = try posix.read(stdin_fd, &buffer);
            if (read_len == 0) {
                stdin_active = false;
            } else {
                writeToPty(ctx, buffer[0..read_len], true);
            }
        }
    }
}

fn decodeExitStatus(status: u32) ExitInfo {
    if ((status & 0x7f) == 0) {
        return .{ .exit_code = @intCast((status >> 8) & 0xff), .signal = null };
    }
    const sig: u8 = @intCast(status & 0x7f);
    return .{ .exit_code = 128 + sig, .signal = sig };
}
