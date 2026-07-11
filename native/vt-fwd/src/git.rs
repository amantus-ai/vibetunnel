use std::fs::{self, File};
use std::io::{self, Read};
use std::os::fd::{AsRawFd, RawFd};
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};

use nix::libc;

const GIT_OUTPUT_LIMIT: usize = 8192;
const GIT_STATUS_OUTPUT_LIMIT: usize = 1024;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct GitInfo {
    pub git_repo_path: Option<String>,
    pub git_branch: Option<String>,
    pub git_ahead_count: Option<i32>,
    pub git_behind_count: Option<i32>,
    pub git_has_changes: Option<bool>,
    pub git_is_worktree: Option<bool>,
    pub git_main_repo_path: Option<String>,
}

/// Detect Git metadata for `working_dir` without surfacing Git or filesystem errors.
///
/// Optional fields intentionally mirror the forwarder's session JSON contract. Once
/// the repository itself is detected, branch, dirty-state, worktree state, and main
/// repository path are populated even when upstream metadata is unavailable.
pub fn detect_git_info(working_dir: &Path) -> GitInfo {
    let mut info = GitInfo::default();

    let Some(repo_path) = run_git(working_dir, &["rev-parse", "--show-toplevel"]) else {
        return info;
    };
    info.git_repo_path = Some(repo_path);

    info.git_branch = Some(run_git(working_dir, &["branch", "--show-current"]).unwrap_or_default());

    let git_file_path = working_dir.join(".git");
    if fs::metadata(&git_file_path).is_ok_and(|metadata| !metadata.is_dir()) {
        info.git_is_worktree = Some(true);
        info.git_main_repo_path = get_main_repository_path(&git_file_path);
    }

    if let Some(counts) = run_git(
        working_dir,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    ) {
        let mut parts = counts.split('\t');
        info.git_ahead_count = parts.next().and_then(|value| value.parse::<i32>().ok());
        info.git_behind_count = parts.next().and_then(|value| value.parse::<i32>().ok());
    }

    info.git_has_changes = run_git_status(working_dir);

    if info.git_is_worktree.is_none() {
        info.git_is_worktree = Some(false);
    }
    if info.git_main_repo_path.is_none() {
        info.git_main_repo_path = info.git_repo_path.clone();
    }

    info
}

fn run_git(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = run_git_command(cwd, args, GIT_OUTPUT_LIMIT)?;
    if !exited_successfully(output.status) {
        return None;
    }

    let output = String::from_utf8(output.stdout).ok()?;
    Some(trim_git_output(&output).to_owned())
}

fn run_git_status(cwd: &Path) -> Option<bool> {
    let output = run_git_command(
        cwd,
        &["diff-index", "--quiet", "HEAD", "--"],
        GIT_STATUS_OUTPUT_LIMIT,
    )?;

    output.status.code().map(|code| code != 0)
}

struct GitCommandOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
}

fn run_git_command(cwd: &Path, args: &[&str], output_limit: usize) -> Option<GitCommandOutput> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;

    let Some(stdout) = child.stdout.take() else {
        terminate_child(&mut child);
        return None;
    };
    let Some(stderr) = child.stderr.take() else {
        terminate_child(&mut child);
        return None;
    };
    collect_child_output(&mut child, stdout, stderr, output_limit)
}

fn collect_child_output(
    child: &mut std::process::Child,
    mut stdout: std::process::ChildStdout,
    mut stderr: std::process::ChildStderr,
    output_limit: usize,
) -> Option<GitCommandOutput> {
    if set_nonblocking(stdout.as_raw_fd()).is_err() || set_nonblocking(stderr.as_raw_fd()).is_err()
    {
        terminate_child(child);
        return None;
    }

    let mut stdout_bytes = Vec::with_capacity(output_limit.min(8192));
    let mut stdout_count = 0_usize;
    let mut stderr_count = 0_usize;
    let mut stdout_open = true;
    let mut stderr_open = true;
    let mut buffer = [0_u8; 1024];

    while stdout_open || stderr_open {
        let mut poll_fds = [
            libc::pollfd {
                fd: if stdout_open { stdout.as_raw_fd() } else { -1 },
                events: libc::POLLIN,
                revents: 0,
            },
            libc::pollfd {
                fd: if stderr_open { stderr.as_raw_fd() } else { -1 },
                events: libc::POLLIN,
                revents: 0,
            },
        ];
        let ready = unsafe { libc::poll(poll_fds.as_mut_ptr(), poll_fds.len() as _, -1) };
        if ready < 0 {
            if io::Error::last_os_error().raw_os_error() == Some(libc::EINTR) {
                continue;
            }
            terminate_child(child);
            return None;
        }

        if stdout_open && poll_fds[0].revents != 0 {
            let Some(open) = drain_pipe(
                &mut stdout,
                &mut buffer,
                &mut stdout_count,
                output_limit,
                Some(&mut stdout_bytes),
            ) else {
                terminate_child(child);
                return None;
            };
            stdout_open = open;
        }
        if stderr_open && poll_fds[1].revents != 0 {
            let Some(open) = drain_pipe(
                &mut stderr,
                &mut buffer,
                &mut stderr_count,
                output_limit,
                None,
            ) else {
                terminate_child(child);
                return None;
            };
            stderr_open = open;
        }
        if stdout_count > output_limit || stderr_count > output_limit {
            terminate_child(child);
            return None;
        }
    }

    Some(GitCommandOutput {
        status: child.wait().ok()?,
        stdout: stdout_bytes,
    })
}

fn set_nonblocking(fd: RawFd) -> io::Result<()> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn drain_pipe(
    reader: &mut impl Read,
    buffer: &mut [u8],
    count: &mut usize,
    limit: usize,
    mut retained: Option<&mut Vec<u8>>,
) -> Option<bool> {
    loop {
        match reader.read(buffer) {
            Ok(0) => return Some(false),
            Ok(read) => {
                *count = count.saturating_add(read);
                if let Some(bytes) = retained.as_deref_mut() {
                    let remaining = limit.saturating_sub(bytes.len());
                    bytes.extend_from_slice(&buffer[..read.min(remaining)]);
                }
                if *count > limit {
                    return Some(true);
                }
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Some(true),
            Err(_) => return None,
        }
    }
}

fn terminate_child(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

struct LimitedOutput {
    bytes: Vec<u8>,
    exceeded: bool,
}

fn read_limited(mut reader: impl Read, limit: usize) -> io::Result<LimitedOutput> {
    let mut bytes = Vec::with_capacity(limit.min(8192));
    reader
        .by_ref()
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)?;
    let exceeded = bytes.len() > limit;
    bytes.truncate(limit);
    Ok(LimitedOutput { bytes, exceeded })
}

fn exited_successfully(status: ExitStatus) -> bool {
    status.code() == Some(0)
}

fn trim_git_output(output: &str) -> &str {
    output.trim_matches([' ', '\t', '\r', '\n'])
}

fn get_main_repository_path(git_file_path: &Path) -> Option<String> {
    let file = File::open(git_file_path).ok()?;
    let data = read_limited(file, 1024).ok()?;
    if data.exceeded {
        return None;
    }
    let data = data.bytes;
    let data = std::str::from_utf8(&data).ok()?;
    let trimmed = trim_git_output(data);
    let path_part = trimmed.strip_prefix("gitdir:")?.trim_matches([' ', '\t']);
    let marker = "/.git/worktrees/";
    let marker_index = path_part.find(marker)?;
    Some(path_part[..marker_index].to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMP_DIR: AtomicU64 = AtomicU64::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let suffix = NEXT_TEMP_DIR.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "vibetunnel-fwd-{label}-{}-{suffix}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("create temporary directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn git_success(cwd: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .status()
            .expect("run git command");
        assert!(status.success(), "git {args:?} failed with {status}");
    }

    fn init_repository(path: &Path) {
        git_success(path, &["init", "-q", "-b", "main"]);
        git_success(
            path,
            &[
                "-c",
                "user.name=VibeTunnel Test",
                "-c",
                "user.email=test@vibetunnel.local",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                "initial",
            ],
        );
    }

    #[test]
    fn retains_metadata_without_an_upstream_branch() {
        let repo = TempDir::new("git-no-upstream");
        init_repository(repo.path());

        let canonical_repo = fs::canonicalize(repo.path()).expect("canonical repository path");
        let canonical_repo = canonical_repo.to_string_lossy().into_owned();
        let info = detect_git_info(repo.path());

        assert_eq!(info.git_repo_path.as_deref(), Some(canonical_repo.as_str()));
        assert_eq!(info.git_branch.as_deref(), Some("main"));
        assert_eq!(
            info.git_main_repo_path.as_deref(),
            Some(canonical_repo.as_str())
        );
        assert_eq!(info.git_ahead_count, None);
        assert_eq!(info.git_behind_count, None);
        assert_eq!(info.git_has_changes, Some(false));
        assert_eq!(info.git_is_worktree, Some(false));
    }

    #[test]
    fn leaves_every_field_absent_outside_a_repository() {
        let directory = TempDir::new("not-git");
        assert_eq!(detect_git_info(directory.path()), GitInfo::default());
    }

    #[test]
    fn extracts_main_repository_from_git_file() {
        let directory = TempDir::new("git-file");
        let git_file = directory.path().join(".git");
        fs::write(&git_file, "gitdir: /tmp/example/.git/worktrees/feature\n")
            .expect("write git file");

        assert_eq!(
            get_main_repository_path(&git_file).as_deref(),
            Some("/tmp/example")
        );
    }

    #[test]
    fn detects_linked_worktree_and_main_repository() {
        let root = TempDir::new("linked-worktree");
        let main_repository = root.path().join("main");
        fs::create_dir(&main_repository).expect("create main repository");
        init_repository(&main_repository);

        let worktree = root.path().join("feature");
        let worktree_argument = worktree.to_str().expect("UTF-8 worktree path");
        git_success(
            &main_repository,
            &["worktree", "add", "-q", "-b", "feature", worktree_argument],
        );

        let main_repository = fs::canonicalize(main_repository)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let worktree = fs::canonicalize(worktree)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let info = detect_git_info(Path::new(&worktree));

        assert_eq!(info.git_repo_path.as_deref(), Some(worktree.as_str()));
        assert_eq!(info.git_branch.as_deref(), Some("feature"));
        assert_eq!(info.git_is_worktree, Some(true));
        assert_eq!(
            info.git_main_repo_path.as_deref(),
            Some(main_repository.as_str())
        );
    }
}
