const std = @import("std");

pub const Level = enum(u8) {
    silent = 0,
    @"error" = 1,
    warn = 2,
    info = 3,
    verbose = 4,
    debug = 5,
};

pub fn parseLevel(value: []const u8) ?Level {
    if (std.ascii.eqlIgnoreCase(value, "silent")) return .silent;
    if (std.ascii.eqlIgnoreCase(value, "error")) return .@"error";
    if (std.ascii.eqlIgnoreCase(value, "warn")) return .warn;
    if (std.ascii.eqlIgnoreCase(value, "info")) return .info;
    if (std.ascii.eqlIgnoreCase(value, "verbose")) return .verbose;
    if (std.ascii.eqlIgnoreCase(value, "debug")) return .debug;
    return null;
}

pub const Logger = struct {
    level: Level,
    file: ?std.fs.File = null,

    pub fn init(level: Level, log_path: ?[]const u8) Logger {
        var logger = Logger{ .level = level };
        if (log_path) |path| {
            if (std.fs.path.dirname(path)) |dir| {
                std.fs.cwd().makePath(dir) catch {};
            }
            logger.file = std.fs.cwd().createFile(path, .{ .truncate = false, .read = false, .mode = 0o644 }) catch null;
        }
        return logger;
    }

    pub fn deinit(self: *Logger) void {
        if (self.file) |*file| {
            file.close();
            self.file = null;
        }
    }

    pub fn logError(self: *Logger, comptime fmt: []const u8, args: anytype) void {
        self.log(.@"error", "ERROR", fmt, args);
    }

    pub fn warn(self: *Logger, comptime fmt: []const u8, args: anytype) void {
        self.log(.warn, "WARN", fmt, args);
    }

    pub fn info(self: *Logger, comptime fmt: []const u8, args: anytype) void {
        self.log(.info, "INFO", fmt, args);
    }

    pub fn verbose(self: *Logger, comptime fmt: []const u8, args: anytype) void {
        self.log(.verbose, "VERBOSE", fmt, args);
    }

    pub fn debug(self: *Logger, comptime fmt: []const u8, args: anytype) void {
        self.log(.debug, "DEBUG", fmt, args);
    }

    fn log(self: *Logger, level: Level, comptime label: []const u8, comptime fmt: []const u8, args: anytype) void {
        if (@intFromEnum(self.level) < @intFromEnum(level)) return;

        var buf: [512]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, fmt, args) catch return;
        const stderr = std.fs.File.stderr().deprecatedWriter();
        _ = stderr.print("[{s}] {s}\n", .{ label, msg }) catch {};

        if (self.file) |*file| {
            _ = file.writeAll(msg) catch {};
            _ = file.writeAll("\n") catch {};
        }
    }
};

test "parseLevel is case-insensitive" {
    try std.testing.expect(parseLevel("INFO") == .info);
    try std.testing.expect(parseLevel("warn") == .warn);
    try std.testing.expect(parseLevel("DEBUG") == .debug);
    try std.testing.expect(parseLevel("nope") == null);
}
