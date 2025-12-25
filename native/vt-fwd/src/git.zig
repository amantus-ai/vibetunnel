const std = @import("std");

pub const GitInfo = struct {
    gitRepoPath: ?[]const u8 = null,
    gitBranch: ?[]const u8 = null,
    gitAheadCount: ?i32 = null,
    gitBehindCount: ?i32 = null,
    gitHasChanges: ?bool = null,
    gitIsWorktree: ?bool = null,
    gitMainRepoPath: ?[]const u8 = null,
};

pub fn detectGitInfo(allocator: std.mem.Allocator, working_dir: []const u8) GitInfo {
    var info = GitInfo{};
    var env = std.process.getEnvMap(allocator) catch return info;
    defer env.deinit();
    env.put("GIT_TERMINAL_PROMPT", "0") catch {};

    const repo_path = runGit(allocator, working_dir, &env, &.{ "git", "rev-parse", "--show-toplevel" }) orelse return info;
    defer allocator.free(repo_path);
    info.gitRepoPath = repo_path;

    if (runGit(allocator, working_dir, &env, &.{ "git", "branch", "--show-current" })) |branch| {
        defer allocator.free(branch);
        info.gitBranch = branch;
    } else {
        info.gitBranch = "";
    }

    const git_file_path = std.fs.path.join(allocator, &.{ working_dir, ".git" }) catch null;
    if (git_file_path) |path| {
        defer allocator.free(path);
        if (std.fs.cwd().statFile(path)) |stat| {
            if (stat.kind != .directory) {
                info.gitIsWorktree = true;
                if (getMainRepositoryPath(allocator, path)) |main| {
                    info.gitMainRepoPath = main;
                }
            }
        } else |_| {}
    }

    if (runGit(allocator, working_dir, &env, &.{ "git", "rev-list", "--left-right", "--count", "HEAD...@{upstream}" })) |counts| {
        defer allocator.free(counts);
        var parts = std.mem.splitScalar(u8, counts, '\t');
        if (parts.next()) |ahead| {
            info.gitAheadCount = std.fmt.parseInt(i32, ahead, 10) catch null;
        }
        if (parts.next()) |behind| {
            info.gitBehindCount = std.fmt.parseInt(i32, behind, 10) catch null;
        }
    }

    if (runGitStatus(allocator, working_dir, &env)) |has_changes| {
        info.gitHasChanges = has_changes;
    }

    if (info.gitIsWorktree == null) {
        info.gitIsWorktree = false;
    }

    if (info.gitMainRepoPath == null) {
        info.gitMainRepoPath = info.gitRepoPath;
    }

    return info;
}

fn runGit(
    allocator: std.mem.Allocator,
    cwd: []const u8,
    env: *const std.process.EnvMap,
    argv: []const []const u8,
) ?[]u8 {
    var child = std.process.Child.init(argv, allocator);
    child.cwd = cwd;
    child.env_map = env;
    child.stdin_behavior = .Ignore;
    child.stdout_behavior = .Pipe;
    child.stderr_behavior = .Ignore;

    if (child.spawn()) |_| {} else |_| return null;

    const stdout = if (child.stdout) |*handle| blk: {
        const data = handle.readToEndAlloc(allocator, 8192) catch return null;
        handle.close();
        child.stdout = null;
        break :blk data;
    } else return null;
    const term = child.wait() catch {
        allocator.free(stdout);
        return null;
    };
    switch (term) {
        .Exited => |code| {
            if (code != 0) {
                allocator.free(stdout);
                return null;
            }
        },
        else => {
            allocator.free(stdout);
            return null;
        },
    }

    const trimmed = std.mem.trim(u8, stdout, " \t\r\n");
    return allocator.dupe(u8, trimmed) catch null;
}

fn runGitStatus(
    allocator: std.mem.Allocator,
    cwd: []const u8,
    env: *const std.process.EnvMap,
) ?bool {
    var child = std.process.Child.init(&.{ "git", "diff-index", "--quiet", "HEAD", "--" }, allocator);
    child.cwd = cwd;
    child.env_map = env;
    child.stdin_behavior = .Ignore;
    child.stdout_behavior = .Ignore;
    child.stderr_behavior = .Ignore;

    if (child.spawn()) |_| {} else |_| return null;

    const term = child.wait() catch return null;
    switch (term) {
        .Exited => |code| {
            if (code == 0) return false;
            return true;
        },
        else => return null,
    }
}

fn getMainRepositoryPath(allocator: std.mem.Allocator, git_file_path: []const u8) ?[]u8 {
    const data = std.fs.cwd().readFileAlloc(allocator, git_file_path, 1024) catch return null;
    defer allocator.free(data);

    const trimmed = std.mem.trim(u8, data, " \t\r\n");
    const prefix = "gitdir:";
    if (!std.mem.startsWith(u8, trimmed, prefix)) return null;
    const path_part = std.mem.trim(u8, trimmed[prefix.len..], " \t");

    const marker = "/.git/worktrees/";
    if (std.mem.indexOf(u8, path_part, marker)) |idx| {
        return allocator.dupe(u8, path_part[0..idx]) catch null;
    }

    return null;
}
