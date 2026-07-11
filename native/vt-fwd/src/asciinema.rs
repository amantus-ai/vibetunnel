use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufWriter, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// Thread-safe writer for an asciinema v2 cast file.
pub struct AsciinemaWriter {
    started_at: Instant,
    inner: Mutex<Inner>,
}

struct Inner {
    writer: BufWriter<File>,
    utf8_buffer: Vec<u8>,
}

#[derive(Serialize)]
struct Header<'a> {
    version: u8,
    width: u16,
    height: u16,
    timestamp: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    command: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<&'a str>,
}

impl AsciinemaWriter {
    pub fn new(
        path: impl AsRef<Path>,
        width: u16,
        height: u16,
        command: &str,
        title: &str,
    ) -> io::Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            // Opening the file below reports the useful error if directory creation fails.
            let _ = fs::create_dir_all(parent);
        }

        let file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(path)?;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;

        let started_at = Instant::now();
        let mut writer = BufWriter::with_capacity(4096, file);
        let header = Header {
            version: 2,
            width,
            height,
            timestamp: unix_timestamp(),
            command: (!command.is_empty()).then_some(command),
            title: (!title.is_empty()).then_some(title),
        };
        write_json(&mut writer, &header)?;
        writer.write_all(b"\n")?;
        writer.flush()?;

        Ok(Self {
            started_at,
            inner: Mutex::new(Inner {
                writer,
                utf8_buffer: Vec::new(),
            }),
        })
    }

    pub fn write_output(&self, data: &[u8]) -> io::Result<()> {
        let mut inner = self.lock_inner();
        let mut combined = std::mem::take(&mut inner.utf8_buffer);
        combined.extend_from_slice(data);
        let (sanitized, remainder) = sanitize_utf8(&combined, true);
        inner.utf8_buffer = remainder;

        if !sanitized.is_empty() {
            let elapsed = self.started_at.elapsed().as_secs_f64();
            write_event(&mut inner.writer, elapsed, "o", &sanitized)?;
        }
        Ok(())
    }

    pub fn write_input(&self, data: &[u8]) -> io::Result<()> {
        let (sanitized, _) = sanitize_utf8(data, false);
        if sanitized.is_empty() {
            return Ok(());
        }

        let elapsed = self.started_at.elapsed().as_secs_f64();
        let mut inner = self.lock_inner();
        write_event(&mut inner.writer, elapsed, "i", &sanitized)
    }

    pub fn write_resize(&self, cols: u16, rows: u16) -> io::Result<()> {
        let size = format!("{cols}x{rows}");
        let elapsed = self.started_at.elapsed().as_secs_f64();
        let mut inner = self.lock_inner();
        write_event(&mut inner.writer, elapsed, "r", &size)
    }

    pub fn write_exit(&self, exit_code: i32, session_id: &str) -> io::Result<()> {
        let mut inner = self.lock_inner();

        let buffered = std::mem::take(&mut inner.utf8_buffer);
        if !buffered.is_empty() {
            let (sanitized, _) = sanitize_utf8(&buffered, false);
            if !sanitized.is_empty() {
                let elapsed = self.started_at.elapsed().as_secs_f64();
                write_event(&mut inner.writer, elapsed, "o", &sanitized)?;
            }
        }

        inner.writer.write_all(b"[\"exit\",")?;
        write!(&mut inner.writer, "{exit_code}")?;
        inner.writer.write_all(b",")?;
        write_json(&mut inner.writer, &session_id)?;
        inner.writer.write_all(b"]\n")?;
        inner.writer.flush()
    }

    fn lock_inner(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn write_event(
    writer: &mut BufWriter<File>,
    elapsed: f64,
    event_type: &str,
    data: &str,
) -> io::Result<()> {
    write!(writer, "[{elapsed:.6},")?;
    write_json(writer, &event_type)?;
    writer.write_all(b",")?;
    write_json(writer, &data)?;
    writer.write_all(b"]\n")?;
    writer.flush()
}

fn write_json(writer: &mut BufWriter<File>, value: &impl Serialize) -> io::Result<()> {
    serde_json::to_writer(writer, value).map_err(io::Error::other)
}

fn unix_timestamp() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => i64::try_from(duration.as_secs()).unwrap_or(i64::MAX),
        Err(error) => -i64::try_from(error.duration().as_secs()).unwrap_or(i64::MAX),
    }
}

/// Replaces malformed bytes one at a time. When requested, a final sequence
/// whose leading byte declares more bytes than are available is retained for
/// the next output chunk.
fn sanitize_utf8(data: &[u8], preserve_incomplete_tail: bool) -> (String, Vec<u8>) {
    const REPLACEMENT: &[u8] = "\u{fffd}".as_bytes();

    let mut output = Vec::with_capacity(data.len());
    let mut index = 0;
    while index < data.len() {
        let Some(sequence_len) = utf8_sequence_len(data[index]) else {
            output.extend_from_slice(REPLACEMENT);
            index += 1;
            continue;
        };

        let end = index + sequence_len;
        if end > data.len() {
            if preserve_incomplete_tail {
                return (
                    String::from_utf8(output).expect("sanitizer emitted valid UTF-8"),
                    data[index..].to_vec(),
                );
            }
            output.extend_from_slice(REPLACEMENT);
            index += 1;
            continue;
        }

        if std::str::from_utf8(&data[index..end]).is_err() {
            output.extend_from_slice(REPLACEMENT);
            index += 1;
            continue;
        }

        output.extend_from_slice(&data[index..end]);
        index = end;
    }

    (
        String::from_utf8(output).expect("sanitizer emitted valid UTF-8"),
        Vec::new(),
    )
}

const fn utf8_sequence_len(first: u8) -> Option<usize> {
    if first & 0x80 == 0 {
        Some(1)
    } else if first & 0xe0 == 0xc0 {
        Some(2)
    } else if first & 0xf0 == 0xe0 {
        Some(3)
    } else if first & 0xf8 == 0xf0 {
        Some(4)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::io::Read;
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_PATH: AtomicU64 = AtomicU64::new(0);

    fn temp_path() -> PathBuf {
        let serial = NEXT_PATH.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "vibetunnel-asciinema-{}-{serial}.cast",
            std::process::id()
        ))
    }

    fn read_lines(path: &Path) -> Vec<String> {
        let mut contents = String::new();
        File::open(path)
            .unwrap()
            .read_to_string(&mut contents)
            .unwrap();
        contents.lines().map(str::to_owned).collect()
    }

    #[test]
    fn sanitize_preserves_incomplete_tails_and_replaces_malformed_bytes() {
        let (output, remainder) = sanitize_utf8(&[b'A', 0xff, b'B', 0xe2, 0x82], true);
        assert_eq!(output, "A\u{fffd}B");
        assert_eq!(remainder, [0xe2, 0x82]);
    }

    #[test]
    fn sanitize_completes_split_codepoints() {
        let (output, remainder) = sanitize_utf8(&[0xe2, 0x82, 0xac], true);
        assert_eq!(output, "\u{20ac}");
        assert!(remainder.is_empty());
    }

    #[test]
    fn writes_v2_header_events_and_exit_and_flushes_each_event() {
        let path = temp_path();
        let writer = AsciinemaWriter::new(&path, 120, 40, "echo hi", "Greeting").unwrap();

        let header_only = read_lines(&path);
        assert_eq!(header_only.len(), 1);
        let header: Value = serde_json::from_str(&header_only[0]).unwrap();
        assert_eq!(header["version"], 2);
        assert_eq!(header["width"], 120);
        assert_eq!(header["height"], 40);
        assert_eq!(header["command"], "echo hi");
        assert_eq!(header["title"], "Greeting");
        assert!(header["timestamp"].is_i64());

        writer.write_output(b"hello\r\n").unwrap();
        assert_eq!(read_lines(&path).len(), 2);
        writer.write_input(b"x").unwrap();
        assert_eq!(read_lines(&path).len(), 3);
        writer.write_resize(100, 32).unwrap();
        assert_eq!(read_lines(&path).len(), 4);
        writer.write_exit(7, "session-1").unwrap();

        let lines = read_lines(&path);
        let output: Value = serde_json::from_str(&lines[1]).unwrap();
        let input: Value = serde_json::from_str(&lines[2]).unwrap();
        let resize: Value = serde_json::from_str(&lines[3]).unwrap();
        let exit: Value = serde_json::from_str(&lines[4]).unwrap();
        assert_eq!(output[1], "o");
        assert_eq!(output[2], "hello\r\n");
        assert_eq!(input[1], "i");
        assert_eq!(input[2], "x");
        assert_eq!(resize[1], "r");
        assert_eq!(resize[2], "100x32");
        assert_eq!(exit, serde_json::json!(["exit", 7, "session-1"]));

        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn buffers_split_output_and_replaces_incomplete_output_at_exit() {
        let path = temp_path();
        let writer = AsciinemaWriter::new(&path, 80, 24, "", "").unwrap();

        writer
            .write_output(&[b'A', 0xff, b'B', 0xe2, 0x82])
            .unwrap();
        writer.write_output(&[0xac]).unwrap();
        writer.write_output(&[0xf0, 0x9f]).unwrap();
        writer.write_exit(0, "split").unwrap();

        let lines = read_lines(&path);
        let first: Value = serde_json::from_str(&lines[1]).unwrap();
        let second: Value = serde_json::from_str(&lines[2]).unwrap();
        let flushed: Value = serde_json::from_str(&lines[3]).unwrap();
        assert_eq!(first[2], "A\u{fffd}B");
        assert_eq!(second[2], "\u{20ac}");
        assert_eq!(flushed[2], "\u{fffd}\u{fffd}");
        assert_eq!(
            serde_json::from_str::<Value>(&lines[4]).unwrap(),
            serde_json::json!(["exit", 0, "split"])
        );

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn supports_concurrent_event_writers() {
        let path = temp_path();
        let writer = Arc::new(AsciinemaWriter::new(&path, 80, 24, "true", "").unwrap());
        let threads: Vec<_> = (0..4)
            .map(|_| {
                let writer = Arc::clone(&writer);
                std::thread::spawn(move || {
                    for _ in 0..25 {
                        writer.write_input(b"x").unwrap();
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        writer.write_exit(0, "concurrent").unwrap();

        let lines = read_lines(&path);
        assert_eq!(lines.len(), 102);
        for line in &lines {
            serde_json::from_str::<Value>(line).unwrap();
        }
        assert_eq!(
            lines[1..101]
                .iter()
                .filter(|line| serde_json::from_str::<Value>(line).unwrap()[1] == "i")
                .count(),
            100
        );

        fs::remove_file(path).unwrap();
    }
}
