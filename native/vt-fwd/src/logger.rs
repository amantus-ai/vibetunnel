use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::Path;
use std::sync::Mutex;

const MAX_MESSAGE_BYTES: usize = 512;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
#[repr(u8)]
pub enum Level {
    Silent = 0,
    Error = 1,
    Warn = 2,
    Info = 3,
    Verbose = 4,
    Debug = 5,
}

pub fn parse_level(value: &str) -> Option<Level> {
    if value.eq_ignore_ascii_case("silent") {
        Some(Level::Silent)
    } else if value.eq_ignore_ascii_case("error") {
        Some(Level::Error)
    } else if value.eq_ignore_ascii_case("warn") {
        Some(Level::Warn)
    } else if value.eq_ignore_ascii_case("info") {
        Some(Level::Info)
    } else if value.eq_ignore_ascii_case("verbose") {
        Some(Level::Verbose)
    } else if value.eq_ignore_ascii_case("debug") {
        Some(Level::Debug)
    } else {
        None
    }
}

pub struct Logger {
    level: Level,
    file: Mutex<Option<File>>,
}

impl Logger {
    pub fn new(level: Level, log_path: Option<&Path>) -> Self {
        let file = log_path.and_then(open_log_file);
        Self {
            level,
            file: Mutex::new(file),
        }
    }

    pub fn error(&self, message: impl fmt::Display) {
        self.log(Level::Error, "ERROR", message);
    }

    #[cfg(test)]
    pub fn warn(&self, message: impl fmt::Display) {
        self.log(Level::Warn, "WARN", message);
    }

    #[cfg(test)]
    pub fn info(&self, message: impl fmt::Display) {
        self.log(Level::Info, "INFO", message);
    }

    fn log(&self, level: Level, label: &str, message: impl fmt::Display) {
        if self.level < level {
            return;
        }

        let mut file = self
            .file
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut message_buffer = MessageBuffer::default();
        if fmt::write(&mut message_buffer, format_args!("{message}")).is_err() {
            return;
        }
        let message = message_buffer.as_str();

        let mut stderr = io::stderr().lock();
        let _ = writeln!(stderr, "[{label}] {message}");

        if let Some(file) = file.as_mut() {
            let _ = file.write_all(message.as_bytes());
            let _ = file.write_all(b"\n");
        }
    }
}

#[derive(Default)]
struct MessageBuffer(String);

impl MessageBuffer {
    fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Write for MessageBuffer {
    fn write_str(&mut self, value: &str) -> fmt::Result {
        if self.0.len().saturating_add(value.len()) > MAX_MESSAGE_BYTES {
            return Err(fmt::Error);
        }
        self.0.push_str(value);
        Ok(())
    }
}

fn open_log_file(path: &Path) -> Option<File> {
    if let Some(directory) = path.parent() {
        let _ = fs::create_dir_all(directory);
    }

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(path)
        .ok()?;
    let _ = file.set_permissions(fs::Permissions::from_mode(0o600));
    Some(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMP_DIR: AtomicU64 = AtomicU64::new(0);

    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new() -> Self {
            let suffix = NEXT_TEMP_DIR.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "vibetunnel-fwd-logger-{}-{suffix}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("create temporary directory");
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn parse_level_is_case_insensitive() {
        assert_eq!(parse_level("INFO"), Some(Level::Info));
        assert_eq!(parse_level("warn"), Some(Level::Warn));
        assert_eq!(parse_level("DEBUG"), Some(Level::Debug));
        assert_eq!(parse_level("nope"), None);
    }

    #[test]
    fn appends_and_keeps_private_permissions() {
        let directory = TempDir::new();
        let path = directory.0.join("nested/log.txt");

        Logger::new(Level::Debug, Some(&path)).info("first");
        Logger::new(Level::Debug, Some(&path)).info("second");

        assert_eq!(fs::read_to_string(&path).unwrap(), "first\nsecond\n");
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn level_threshold_applies_to_file_output() {
        let directory = TempDir::new();
        let path = directory.0.join("log.txt");
        let logger = Logger::new(Level::Warn, Some(&path));

        logger.error(format_args!("failure: {}", 7));
        logger.warn("warning");
        logger.info("hidden");
        logger.error("x".repeat(MAX_MESSAGE_BYTES + 1));

        assert_eq!(fs::read_to_string(path).unwrap(), "failure: 7\nwarning\n");
    }
}
