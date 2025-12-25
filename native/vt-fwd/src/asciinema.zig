const std = @import("std");

pub const AsciinemaWriter = struct {
    file: std.fs.File,
    writer: std.fs.File.Writer,
    writer_buf: [4096]u8 = undefined,
    timer: std.time.Timer,
    mutex: std.Thread.Mutex = .{},
    allocator: std.mem.Allocator,
    utf8_buffer: std.ArrayList(u8),

    pub fn init(
        allocator: std.mem.Allocator,
        path: []const u8,
        width: u16,
        height: u16,
        command: []const u8,
        title: []const u8,
    ) !AsciinemaWriter {
        if (std.fs.path.dirname(path)) |dir| {
            std.fs.cwd().makePath(dir) catch {};
        }

        const file = try std.fs.cwd().createFile(path, .{ .truncate = true, .read = false, .mode = 0o644 });
        var writer = AsciinemaWriter{
            .file = file,
            .writer = undefined,
            .timer = try std.time.Timer.start(),
            .allocator = allocator,
            .utf8_buffer = std.ArrayList(u8).empty,
        };
        writer.writer = file.writer(&writer.writer_buf);
        try writer.writeHeader(width, height, command, title);
        return writer;
    }

    pub fn deinit(self: *AsciinemaWriter) void {
        self.utf8_buffer.deinit(self.allocator);
        _ = self.writer.end() catch {};
        self.file.close();
    }

    pub fn writeOutput(self: *AsciinemaWriter, data: []const u8) !void {
        var combined = std.ArrayList(u8).empty;
        defer combined.deinit(self.allocator);
        try combined.appendSlice(self.allocator, self.utf8_buffer.items);
        try combined.appendSlice(self.allocator, data);

        const valid_len = validUtf8PrefixLen(combined.items);
        const valid = combined.items[0..valid_len];
        const remainder = combined.items[valid_len..];
        self.utf8_buffer.clearRetainingCapacity();
        try self.utf8_buffer.appendSlice(self.allocator, remainder);

        if (valid.len == 0) return;
        try self.writeEvent('o', valid);
    }

    pub fn writeInput(self: *AsciinemaWriter, data: []const u8) !void {
        try self.writeEvent('i', data);
    }

    pub fn writeResize(self: *AsciinemaWriter, cols: u16, rows: u16) !void {
        var buf: [32]u8 = undefined;
        const size = try std.fmt.bufPrint(&buf, "{d}x{d}", .{ cols, rows });
        try self.writeEvent('r', size);
    }

    pub fn writeExit(self: *AsciinemaWriter, exit_code: i32, session_id: []const u8) !void {
        var file_writer = &self.writer;
        self.mutex.lock();
        defer self.mutex.unlock();

        try file_writer.interface.writeAll("[\"exit\",");
        try file_writer.interface.print("{}", .{exit_code});
        try file_writer.interface.writeAll(",");
        try std.json.Stringify.value(session_id, .{}, &file_writer.interface);
        try file_writer.interface.writeAll("]\n");
        try file_writer.interface.flush();
    }

    fn writeHeader(self: *AsciinemaWriter, width: u16, height: u16, command: []const u8, title: []const u8) !void {
        const header = Header{
            .version = 2,
            .width = width,
            .height = height,
            .timestamp = @intCast(std.time.timestamp()),
            .command = if (command.len > 0) command else null,
            .title = if (title.len > 0) title else null,
        };
        var file_writer = &self.writer;
        self.mutex.lock();
        defer self.mutex.unlock();
        try std.json.Stringify.value(header, .{ .emit_null_optional_fields = false }, &file_writer.interface);
        try file_writer.interface.writeAll("\n");
        try file_writer.interface.flush();
    }

    fn writeEvent(self: *AsciinemaWriter, event_type: u8, data: []const u8) !void {
        var file_writer = &self.writer;
        const elapsed_ns = self.timer.read();
        const elapsed = @as(f64, @floatFromInt(elapsed_ns)) / 1_000_000_000.0;

        self.mutex.lock();
        defer self.mutex.unlock();

        try file_writer.interface.writeAll("[");
        try file_writer.interface.print("{d:.6}", .{elapsed});
        try file_writer.interface.writeAll(",\"");
        try file_writer.interface.writeByte(event_type);
        try file_writer.interface.writeAll("\",");
        try std.json.Stringify.value(data, .{}, &file_writer.interface);
        try file_writer.interface.writeAll("]\n");
        try file_writer.interface.flush();
    }
};

const Header = struct {
    version: u8,
    width: u16,
    height: u16,
    timestamp: i64,
    command: ?[]const u8 = null,
    title: ?[]const u8 = null,
};

fn validUtf8PrefixLen(data: []const u8) usize {
    if (data.len == 0) return 0;
    if (std.unicode.utf8ValidateSlice(data)) return data.len;
    var end = data.len;
    while (end > 0) {
        end -= 1;
        if (std.unicode.utf8ValidateSlice(data[0..end])) return end;
    }
    return 0;
}

test "validUtf8PrefixLen handles partial sequences" {
    const full = [_]u8{ 0xE2, 0x82, 0xAC };
    try std.testing.expectEqual(@as(usize, 3), validUtf8PrefixLen(full[0..]));

    const partial = [_]u8{ 0xE2, 0x82 };
    try std.testing.expectEqual(@as(usize, 0), validUtf8PrefixLen(partial[0..]));

    const mixed = [_]u8{ 'A', 0xE2, 0x82 };
    try std.testing.expectEqual(@as(usize, 1), validUtf8PrefixLen(mixed[0..]));
}
