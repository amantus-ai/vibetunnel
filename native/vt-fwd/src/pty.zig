const std = @import("std");
const builtin = @import("builtin");
const posix = std.posix;

comptime {
    if (builtin.os.tag == .windows) {
        @compileError("vibetunnel-fwd does not support Windows.");
    }
}

pub const winsize = extern struct {
    ws_row: u16 = 100,
    ws_col: u16 = 80,
    ws_xpixel: u16 = 800,
    ws_ypixel: u16 = 600,
};

const c = switch (builtin.os.tag) {
    .macos => @cImport({
        @cInclude("sys/ioctl.h");
        @cInclude("util.h");
        @cInclude("termios.h");
    }),
    .linux => @cImport({
        @cInclude("sys/ioctl.h");
        @cInclude("pty.h");
        @cInclude("termios.h");
    }),
    else => @compileError("Unsupported OS for PTY support."),
};

pub const TIOCSCTTY = if (builtin.os.tag == .macos) 536900705 else c.TIOCSCTTY;
const TIOCSWINSZ = if (builtin.os.tag == .macos) 2148037735 else c.TIOCSWINSZ;
const TIOCGWINSZ = if (builtin.os.tag == .macos) 1074295912 else c.TIOCGWINSZ;
extern "c" fn setsid() std.c.pid_t;

pub const Pty = struct {
    pub const Fd = posix.fd_t;
    pub const OpenError = error{OpenptyFailed};
    pub const SetSizeError = error{IoctlFailed};
    pub const GetSizeError = error{IoctlFailed};
    pub const ChildPreExecError = error{ ProcessGroupFailed, SetControllingTerminalFailed };

    master: Fd,
    slave: Fd,

    pub fn open(size: winsize) OpenError!Pty {
        var size_copy = size;
        var master_fd: Fd = undefined;
        var slave_fd: Fd = undefined;
        if (c.openpty(&master_fd, &slave_fd, null, null, @ptrCast(&size_copy)) < 0) {
            return error.OpenptyFailed;
        }
        errdefer {
            _ = posix.close(master_fd);
            _ = posix.close(slave_fd);
        }

        // Set CLOEXEC on the master fd, only slave should be inherited.
        const flags = posix.fcntl(master_fd, posix.F.GETFD, 0) catch null;
        if (flags) |fd_flags| {
            _ = posix.fcntl(master_fd, posix.F.SETFD, fd_flags | posix.FD_CLOEXEC) catch {};
        }

        // Ensure UTF-8 mode is enabled.
        var attrs: c.termios = undefined;
        if (c.tcgetattr(master_fd, &attrs) != 0) return error.OpenptyFailed;
        attrs.c_iflag |= c.IUTF8;
        if (c.tcsetattr(master_fd, c.TCSANOW, &attrs) != 0) return error.OpenptyFailed;

        return .{
            .master = master_fd,
            .slave = slave_fd,
        };
    }

    pub fn deinit(self: *Pty) void {
        if (self.master >= 0) {
            _ = posix.close(self.master);
            self.master = -1;
        }
        if (self.slave >= 0) {
            _ = posix.close(self.slave);
            self.slave = -1;
        }
        self.* = undefined;
    }

    pub fn setSize(self: *Pty, size: winsize) SetSizeError!void {
        if (c.ioctl(self.master, TIOCSWINSZ, @intFromPtr(&size)) < 0) {
            return error.IoctlFailed;
        }
    }

    pub fn getSize(self: Pty) GetSizeError!winsize {
        var ws: winsize = undefined;
        if (c.ioctl(self.master, TIOCGWINSZ, @intFromPtr(&ws)) < 0) {
            return error.IoctlFailed;
        }
        return ws;
    }

    pub fn childPreExec(self: Pty) ChildPreExecError!void {
        var sa: posix.Sigaction = .{
            .handler = .{ .handler = posix.SIG.DFL },
            .mask = posix.sigemptyset(),
            .flags = 0,
        };
        posix.sigaction(posix.SIG.ABRT, &sa, null);
        posix.sigaction(posix.SIG.ALRM, &sa, null);
        posix.sigaction(posix.SIG.BUS, &sa, null);
        posix.sigaction(posix.SIG.CHLD, &sa, null);
        posix.sigaction(posix.SIG.FPE, &sa, null);
        posix.sigaction(posix.SIG.HUP, &sa, null);
        posix.sigaction(posix.SIG.ILL, &sa, null);
        posix.sigaction(posix.SIG.INT, &sa, null);
        posix.sigaction(posix.SIG.PIPE, &sa, null);
        posix.sigaction(posix.SIG.SEGV, &sa, null);
        posix.sigaction(posix.SIG.TERM, &sa, null);
        posix.sigaction(posix.SIG.QUIT, &sa, null);

        if (setsid() < 0) return error.ProcessGroupFailed;

        switch (posix.errno(c.ioctl(self.slave, TIOCSCTTY, @as(c_ulong, 0)))) {
            .SUCCESS => {},
            else => return error.SetControllingTerminalFailed,
        }

        _ = posix.close(self.slave);
        _ = posix.close(self.master);
    }
};

pub fn getWinsizeFromFd(fd: posix.fd_t) Pty.GetSizeError!winsize {
    var ws: winsize = undefined;
    if (c.ioctl(fd, TIOCGWINSZ, @intFromPtr(&ws)) < 0) {
        return error.IoctlFailed;
    }
    return ws;
}
