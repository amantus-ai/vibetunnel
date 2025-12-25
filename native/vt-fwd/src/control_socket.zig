const std = @import("std");
const logger_mod = @import("logger.zig");

const posix = std.posix;

const c = @cImport({
    @cInclude("sys/socket.h");
    @cInclude("sys/un.h");
});

pub const MessageType = enum(u8) {
    stdin_data = 0x01,
    control_cmd = 0x02,
    status_update = 0x03,
    heartbeat = 0x04,
    @"error" = 0x05,
};

pub const Handler = struct {
    context: *anyopaque,
    logger: *logger_mod.Logger,
    on_stdin: *const fn (context: *anyopaque, data: []const u8) void,
    on_resize: *const fn (context: *anyopaque, cols: u16, rows: u16) void,
    on_reset_size: *const fn (context: *anyopaque) void,
    on_kill: *const fn (context: *anyopaque, signal: ?i32) void,
    on_update_title: *const fn (context: *anyopaque, title: []const u8) void,
};

pub const Server = struct {
    fd: posix.fd_t,
    socket_path: []const u8,
    allocator: std.mem.Allocator,
    handler: Handler,
    running: *std.atomic.Value(bool),

    pub fn init(
        allocator: std.mem.Allocator,
        socket_path: []const u8,
        handler: Handler,
        running: *std.atomic.Value(bool),
    ) !Server {
        _ = std.fs.cwd().deleteFile(socket_path) catch {};

        const fd = try posix.socket(c.AF_UNIX, c.SOCK_STREAM, 0);
        errdefer posix.close(fd);

        var addr: c.sockaddr_un = std.mem.zeroes(c.sockaddr_un);
        addr.sun_family = c.AF_UNIX;
        if (@hasField(c.sockaddr_un, "sun_len")) {
            addr.sun_len = @intCast(@sizeOf(c.sockaddr_un));
        }

        if (socket_path.len >= addr.sun_path.len) {
            return error.PathTooLong;
        }

        std.mem.copyForwards(u8, addr.sun_path[0..socket_path.len], socket_path);
        addr.sun_path[socket_path.len] = 0;

        if (c.bind(fd, @ptrCast(&addr), @intCast(@sizeOf(c.sockaddr_un))) != 0) {
            return error.BindFailed;
        }

        if (c.listen(fd, 8) != 0) {
            return error.ListenFailed;
        }

        return .{
            .fd = fd,
            .socket_path = socket_path,
            .allocator = allocator,
            .handler = handler,
            .running = running,
        };
    }

    pub fn run(self: *Server) void {
        while (self.running.load(.acquire)) {
            const client_fd = posix.accept(self.fd, null, null, 0) catch |err| {
                if (err == error.BadFileDescriptor) return;
                continue;
            };
            self.handleClient(client_fd);
            _ = posix.close(client_fd);
        }
    }

    pub fn stop(self: *Server) void {
        _ = posix.close(self.fd);
        _ = std.fs.cwd().deleteFile(self.socket_path) catch {};
    }

    fn handleClient(self: *Server, fd: posix.fd_t) void {
        var buffer = std.ArrayList(u8).empty;
        defer buffer.deinit(self.allocator);
        var temp: [4096]u8 = undefined;

        while (self.running.load(.acquire)) {
            const read_len = posix.read(fd, &temp) catch break;
            if (read_len == 0) break;
            _ = buffer.appendSlice(self.allocator, temp[0..read_len]) catch break;

            while (buffer.items.len >= 5) {
                const msg_type: MessageType = @enumFromInt(buffer.items[0]);
                const payload_len = std.mem.readInt(u32, buffer.items[1..5], .big);
                if (buffer.items.len < 5 + payload_len) break;
                const payload = buffer.items[5 .. 5 + payload_len];
                self.dispatchMessage(fd, msg_type, payload);
                buffer.replaceRange(self.allocator, 0, 5 + payload_len, &[_]u8{}) catch break;
            }
        }
    }

    fn dispatchMessage(self: *Server, fd: posix.fd_t, msg_type: MessageType, payload: []const u8) void {
        switch (msg_type) {
            .stdin_data => self.handler.on_stdin(self.handler.context, payload),
            .control_cmd => self.handleControl(payload),
            .heartbeat => self.sendHeartbeat(fd),
            else => {},
        }
    }

    fn handleControl(self: *Server, payload: []const u8) void {
        var parsed = std.json.parseFromSlice(std.json.Value, self.allocator, payload, .{}) catch return;
        defer parsed.deinit();

        if (parsed.value != .object) return;
        const cmd_value = parsed.value.object.get("cmd") orelse return;
        if (cmd_value != .string) return;
        const cmd = cmd_value.string;

        if (std.mem.eql(u8, cmd, "resize")) {
            const cols = parseNumber(parsed.value.object.get("cols")) orelse return;
            const rows = parseNumber(parsed.value.object.get("rows")) orelse return;
            self.handler.on_resize(self.handler.context, @intCast(cols), @intCast(rows));
            return;
        }

        if (std.mem.eql(u8, cmd, "reset-size")) {
            self.handler.on_reset_size(self.handler.context);
            return;
        }

        if (std.mem.eql(u8, cmd, "kill")) {
            const signal = parseSignal(parsed.value.object.get("signal"));
            self.handler.on_kill(self.handler.context, signal);
            return;
        }

        if (std.mem.eql(u8, cmd, "update-title")) {
            const title_value = parsed.value.object.get("title") orelse return;
            if (title_value != .string) return;
            self.handler.on_update_title(self.handler.context, title_value.string);
            return;
        }
    }

    fn parseNumber(value_opt: ?std.json.Value) ?i64 {
        const value = value_opt orelse return null;
        switch (value) {
            .integer => |v| return v,
            .float => |v| return @intFromFloat(v),
            else => return null,
        }
    }

    fn parseSignal(value_opt: ?std.json.Value) ?i32 {
        const value = value_opt orelse return null;
        switch (value) {
            .integer => |v| return @intCast(v),
            .float => |v| return @intFromFloat(v),
            .string => |s| return signalFromName(s),
            else => return null,
        }
    }

    fn signalFromName(name: []const u8) ?i32 {
        if (std.ascii.eqlIgnoreCase(name, "SIGTERM")) return @as(i32, @intCast(posix.SIG.TERM));
        if (std.ascii.eqlIgnoreCase(name, "SIGKILL")) return @as(i32, @intCast(posix.SIG.KILL));
        if (std.ascii.eqlIgnoreCase(name, "SIGINT")) return @as(i32, @intCast(posix.SIG.INT));
        if (std.ascii.eqlIgnoreCase(name, "SIGHUP")) return @as(i32, @intCast(posix.SIG.HUP));
        return null;
    }

    fn sendHeartbeat(self: *Server, fd: posix.fd_t) void {
        _ = self;
        var frame: [5]u8 = undefined;
        frame[0] = @intFromEnum(MessageType.heartbeat);
        std.mem.writeInt(u32, frame[1..5], 0, .big);
        _ = writeAll(fd, &frame);
    }
};

fn writeAll(fd: posix.fd_t, data: []const u8) void {
    var offset: usize = 0;
    while (offset < data.len) {
        const written = posix.write(fd, data[offset..]) catch return;
        if (written == 0) return;
        offset += written;
    }
}
