use serde::de;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::error::Error;
use std::ffi::OsString;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::ops::Range;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const MAX_SESSION_JSON_BYTES: u64 = 1024 * 1024;
const MAX_JSON_DEPTH: usize = 128;
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub name: String,
    pub command: Vec<String>,
    pub working_dir: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_cols: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_rows: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_clear_offset: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_repo_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_ahead_count: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_behind_count: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_has_changes: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_is_worktree: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_main_repo_path: Option<String>,
    #[serde(
        default,
        rename = "attachedViaVT",
        skip_serializing_if = "Option::is_none"
    )]
    pub attached_via_vt: Option<bool>,
}

#[derive(Debug)]
pub enum SessionError {
    Io(io::Error),
    Json(serde_json::Error),
    InvalidSessionJson,
}

impl fmt::Display for SessionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "session I/O error: {error}"),
            Self::Json(error) => write!(formatter, "invalid session JSON: {error}"),
            Self::InvalidSessionJson => formatter.write_str("session JSON must be an object"),
        }
    }
}

impl Error for SessionError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Json(error) => Some(error),
            Self::InvalidSessionJson => None,
        }
    }
}

impl From<io::Error> for SessionError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for SessionError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

pub fn write_session_info(path: &Path, info: &SessionInfo) -> Result<(), SessionError> {
    write_json_atomic(path, info)
}

#[cfg(test)]
pub fn read_session_info(path: &Path) -> Result<SessionInfo, SessionError> {
    let data = read_limited(path)?;
    Ok(serde_json::from_slice(&data)?)
}

pub fn read_session_name(path: &Path) -> Option<String> {
    let data = read_limited(path).ok()?;
    let object = parse_top_level_object(&data).ok()??;
    let range = object.name_value?;
    serde_json::from_slice::<String>(&data[range]).ok()
}

pub fn update_session_name(path: &Path, name: &str) -> Result<(), SessionError> {
    create_parent_directories(path)?;

    let data = read_limited(path)?;
    let object = parse_top_level_object(&data)?.ok_or(SessionError::InvalidSessionJson)?;
    let encoded_name = serde_json::to_vec(name)?;
    let mut updated = Vec::with_capacity(data.len() + encoded_name.len() + 8);

    if let Some(range) = object.name_value {
        updated.extend_from_slice(&data[..range.start]);
        updated.extend_from_slice(&encoded_name);
        updated.extend_from_slice(&data[range.end..]);
    } else {
        updated.extend_from_slice(&data[..object.insertion_index]);
        if object.has_members {
            updated.push(b',');
        }
        updated.extend_from_slice(b"\"name\":");
        updated.extend_from_slice(&encoded_name);
        updated.extend_from_slice(&data[object.insertion_index..]);
    }

    write_bytes_atomic(path, &updated)
}

fn read_limited(path: &Path) -> io::Result<Vec<u8>> {
    let file = File::open(path)?;
    let mut data = Vec::new();
    file.take(MAX_SESSION_JSON_BYTES + 1)
        .read_to_end(&mut data)?;
    if data.len() as u64 > MAX_SESSION_JSON_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "session JSON exceeds 1 MiB",
        ));
    }
    Ok(data)
}

struct ParsedObject {
    name_value: Option<Range<usize>>,
    insertion_index: usize,
    has_members: bool,
}

fn parse_top_level_object(data: &[u8]) -> Result<Option<ParsedObject>, serde_json::Error> {
    let mut parser = JsonParser {
        input: data,
        position: 0,
    };
    parser.skip_whitespace();

    let object = if parser.peek() == Some(b'{') {
        Some(parser.parse_object(0, true)?)
    } else {
        parser.parse_value(0)?;
        None
    };

    parser.skip_whitespace();
    if parser.position != data.len() {
        return Err(parser.error("trailing characters"));
    }
    Ok(object)
}

struct JsonParser<'a> {
    input: &'a [u8],
    position: usize,
}

impl JsonParser<'_> {
    fn parse_value(&mut self, depth: usize) -> Result<(), serde_json::Error> {
        if depth > MAX_JSON_DEPTH {
            return Err(self.error("JSON nesting limit exceeded"));
        }

        self.skip_whitespace();
        match self.peek() {
            Some(b'{') => {
                self.parse_object(depth, false)?;
            }
            Some(b'[') => self.parse_array(depth)?,
            Some(b'\"') => {
                self.parse_string()?;
            }
            Some(b't') => self.parse_keyword(b"true")?,
            Some(b'f') => self.parse_keyword(b"false")?,
            Some(b'n') => self.parse_keyword(b"null")?,
            Some(b'-' | b'0'..=b'9') => self.parse_number()?,
            Some(_) => return Err(self.error("expected a JSON value")),
            None => return Err(self.error("unexpected end of JSON")),
        }
        Ok(())
    }

    fn parse_object(
        &mut self,
        depth: usize,
        capture_top_level: bool,
    ) -> Result<ParsedObject, serde_json::Error> {
        self.position += 1;
        let empty_insertion_index = self.position;
        self.skip_whitespace();

        let mut keys = HashSet::new();
        let mut name_value = None;
        if self.consume(b'}') {
            return Ok(ParsedObject {
                name_value,
                insertion_index: empty_insertion_index,
                has_members: false,
            });
        }

        let insertion_index = loop {
            if self.peek() != Some(b'\"') {
                return Err(self.error("expected an object key"));
            }
            let key = self.parse_string()?;
            if !keys.insert(key.clone()) {
                return Err(self.error(&format!("duplicate object key `{key}`")));
            }

            self.skip_whitespace();
            if !self.consume(b':') {
                return Err(self.error("expected `:` after object key"));
            }
            self.skip_whitespace();
            let value_start = self.position;
            self.parse_value(depth + 1)?;
            let value_end = self.position;
            if capture_top_level && key == "name" {
                name_value = Some(value_start..value_end);
            }

            self.skip_whitespace();
            if self.consume(b'}') {
                break value_end;
            }
            if !self.consume(b',') {
                return Err(self.error("expected `,` or `}` in object"));
            }
            self.skip_whitespace();
        };

        Ok(ParsedObject {
            name_value,
            insertion_index,
            has_members: true,
        })
    }

    fn parse_array(&mut self, depth: usize) -> Result<(), serde_json::Error> {
        self.position += 1;
        self.skip_whitespace();
        if self.consume(b']') {
            return Ok(());
        }

        loop {
            self.parse_value(depth + 1)?;
            self.skip_whitespace();
            if self.consume(b']') {
                return Ok(());
            }
            if !self.consume(b',') {
                return Err(self.error("expected `,` or `]` in array"));
            }
            self.skip_whitespace();
        }
    }

    fn parse_string(&mut self) -> Result<String, serde_json::Error> {
        let start = self.position;
        self.position += 1;

        loop {
            match self.peek() {
                Some(b'\"') => {
                    self.position += 1;
                    return serde_json::from_slice(&self.input[start..self.position]);
                }
                Some(b'\\') => {
                    self.position += 1;
                    if self.peek().is_none() {
                        return Err(self.error("unterminated string escape"));
                    }
                    self.position += 1;
                }
                Some(_) => self.position += 1,
                None => return Err(self.error("unterminated string")),
            }
        }
    }

    fn parse_number(&mut self) -> Result<(), serde_json::Error> {
        self.consume(b'-');
        match self.peek() {
            Some(b'0') => self.position += 1,
            Some(b'1'..=b'9') => self.consume_digits(),
            _ => return Err(self.error("invalid JSON number")),
        }

        if self.consume(b'.') {
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(self.error("invalid JSON number fraction"));
            }
            self.consume_digits();
        }

        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.position += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.position += 1;
            }
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(self.error("invalid JSON number exponent"));
            }
            self.consume_digits();
        }
        Ok(())
    }

    fn parse_keyword(&mut self, keyword: &[u8]) -> Result<(), serde_json::Error> {
        if self.input.get(self.position..self.position + keyword.len()) != Some(keyword) {
            return Err(self.error("invalid JSON literal"));
        }
        self.position += keyword.len();
        Ok(())
    }

    fn consume_digits(&mut self) {
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.position += 1;
        }
    }

    fn skip_whitespace(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.position += 1;
        }
    }

    fn consume(&mut self, expected: u8) -> bool {
        if self.peek() == Some(expected) {
            self.position += 1;
            true
        } else {
            false
        }
    }

    fn peek(&self) -> Option<u8> {
        self.input.get(self.position).copied()
    }

    fn error(&self, message: &str) -> serde_json::Error {
        de::Error::custom(format!("{message} at byte {}", self.position))
    }
}

fn write_json_atomic<T>(path: &Path, value: &T) -> Result<(), SessionError>
where
    T: Serialize + ?Sized,
{
    let mut data = Vec::new();
    serde_json::to_writer_pretty(&mut data, value)?;
    data.push(b'\n');
    write_bytes_atomic(path, &data)
}

fn write_bytes_atomic(path: &Path, data: &[u8]) -> Result<(), SessionError> {
    if data.len() as u64 > MAX_SESSION_JSON_BYTES {
        return Err(
            io::Error::new(io::ErrorKind::InvalidData, "session JSON exceeds 1 MiB").into(),
        );
    }
    create_parent_directories(path)?;
    let parent = parent_directory(path);
    let file_name = path.file_name().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "session path has no file name")
    })?;

    let (temporary_path, mut file) = loop {
        let sequence = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let mut temporary_name = OsString::from(".");
        temporary_name.push(file_name);
        temporary_name.push(format!(".{}.{}.tmp", std::process::id(), sequence));
        let temporary_path = parent.join(temporary_name);

        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary_path)
        {
            Ok(file) => break (temporary_path, file),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    };
    let mut temporary = TemporaryFile::new(temporary_path);

    // `mode` is filtered through the process umask; chmod makes the final mode exact.
    file.set_permissions(fs::Permissions::from_mode(0o600))?;
    file.write_all(data)?;
    file.flush()?;
    drop(file);

    fs::rename(temporary.path(), path)?;
    temporary.disarm();
    Ok(())
}

fn create_parent_directories(path: &Path) -> io::Result<()> {
    let parent = parent_directory(path);
    if parent != Path::new(".") {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn parent_directory(path: &Path) -> &Path {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}

struct TemporaryFile {
    path: PathBuf,
    armed: bool,
}

impl TemporaryFile {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DIRECTORY_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            loop {
                let sequence = TEST_DIRECTORY_COUNTER.fetch_add(1, Ordering::Relaxed);
                let path = std::env::temp_dir().join(format!(
                    "vibetunnel-session-test-{}-{sequence}",
                    std::process::id()
                ));
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("create test directory: {error}"),
                }
            }
        }

        fn join(&self, path: impl AsRef<Path>) -> PathBuf {
            self.0.join(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn sample_info() -> SessionInfo {
        SessionInfo {
            id: "test-session".to_owned(),
            name: "initial name".to_owned(),
            command: vec!["echo".to_owned(), "hi".to_owned()],
            working_dir: "/tmp".to_owned(),
            status: "running".to_owned(),
            exit_code: None,
            started_at: "2025-01-01T00:00:00Z".to_owned(),
            pid: None,
            initial_cols: Some(120),
            initial_rows: None,
            last_clear_offset: None,
            version: None,
            git_repo_path: None,
            git_branch: None,
            git_ahead_count: None,
            git_behind_count: None,
            git_has_changes: None,
            git_is_worktree: None,
            git_main_repo_path: None,
            attached_via_vt: Some(true),
        }
    }

    #[test]
    fn writes_reads_and_updates_session_info() {
        let directory = TestDirectory::new();
        let path = directory.join("nested/session.json");
        let info = sample_info();

        write_session_info(&path, &info).unwrap();

        assert_eq!(read_session_info(&path).unwrap(), info);
        assert_eq!(read_session_name(&path).as_deref(), Some("initial name"));

        let data = fs::read_to_string(&path).unwrap();
        assert!(data.ends_with("\n"));
        assert!(data.contains("\"workingDir\""));
        assert!(data.contains("\"initialCols\""));
        assert!(data.contains("\"attachedViaVT\""));
        assert!(!data.contains("exitCode"));
        assert!(!data.contains("initialRows"));
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );

        update_session_name(&path, "updated name").unwrap();
        assert_eq!(read_session_name(&path).as_deref(), Some("updated name"));
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn update_preserves_unknown_fields_and_tolerates_missing_keys() {
        let directory = TestDirectory::new();
        let path = directory.join("session.json");
        let original = r#"{
  "id": "test-session",
  "name": "old name",
  "command": ["bash"],
  "workingDir": "/tmp",
  "status": "running",
  "extraField": "keep-me",
  "nestedObject": { "a": 1 }
}"#;
        fs::write(&path, original).unwrap();

        update_session_name(&path, "new name").unwrap();

        let updated = fs::read_to_string(&path).unwrap();
        assert_eq!(updated, original.replace("\"old name\"", "\"new name\""));
        let value: Value = serde_json::from_str(&updated).unwrap();
        assert_eq!(value["name"], "new name");
        assert_eq!(value["extraField"], "keep-me");
        assert_eq!(value["nestedObject"]["a"], 1);
    }

    #[test]
    fn update_preserves_arbitrary_precision_numbers() {
        let directory = TestDirectory::new();
        let path = directory.join("session.json");
        fs::write(
            &path,
            r#"{"name":"old","integer":18446744073709551616,"exponent":1e400}"#,
        )
        .unwrap();

        update_session_name(&path, "new name").unwrap();

        let updated = fs::read_to_string(&path).unwrap();
        assert_eq!(
            updated,
            r#"{"name":"new name","integer":18446744073709551616,"exponent":1e400}"#
        );
    }

    #[test]
    fn update_preserves_legitimate_serde_private_number_keys() {
        let directory = TestDirectory::new();
        let path = directory.join("session.json");
        let original = r#"{"name":"old","metadata":{"$serde_json::private::Number":"not-a-number"},"$serde_json::private::Number":{"nested":true}}"#;
        fs::write(&path, original).unwrap();

        update_session_name(&path, "new").unwrap();

        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            original.replace("old", "new")
        );
    }

    #[test]
    fn update_adds_name_when_missing() {
        let directory = TestDirectory::new();
        let path = directory.join("session.json");
        fs::write(
            &path,
            r#"{
  "id": "test-session",
  "command": ["bash"],
  "workingDir": "/tmp",
  "status": "running"
}"#,
        )
        .unwrap();

        update_session_name(&path, "inserted name").unwrap();

        let value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["name"], "inserted name");
        assert_eq!(value["id"], "test-session");
    }

    #[test]
    fn update_rejects_non_object_json() {
        let directory = TestDirectory::new();
        let path = directory.join("session.json");
        fs::write(&path, "[]\n").unwrap();

        assert!(matches!(
            update_session_name(&path, "new name"),
            Err(SessionError::InvalidSessionJson)
        ));
    }

    #[test]
    fn update_rejects_output_that_would_exceed_size_limit() {
        let directory = TestDirectory::new();
        let path = directory.join("session.json");
        let prefix = br#"{"padding":""#;
        let suffix = br#""}"#;
        let padding_len = MAX_SESSION_JSON_BYTES as usize - prefix.len() - suffix.len();
        let mut original = Vec::with_capacity(MAX_SESSION_JSON_BYTES as usize);
        original.extend_from_slice(prefix);
        original.extend(std::iter::repeat_n(b'a', padding_len));
        original.extend_from_slice(suffix);
        assert_eq!(original.len(), MAX_SESSION_JSON_BYTES as usize);
        fs::write(&path, &original).unwrap();

        assert!(matches!(
            update_session_name(&path, "new"),
            Err(SessionError::Io(error)) if error.kind() == io::ErrorKind::InvalidData
        ));
        assert_eq!(fs::read(&path).unwrap(), original);
    }

    #[test]
    fn typed_read_rejects_unknown_fields() {
        let directory = TestDirectory::new();
        let path = directory.join("session.json");
        fs::write(
            &path,
            r#"{
  "id": "test-session",
  "name": "name",
  "command": ["bash"],
  "workingDir": "/tmp",
  "status": "running",
  "startedAt": "2025-01-01T00:00:00Z",
  "extraField": true
}"#,
        )
        .unwrap();

        assert!(matches!(
            read_session_info(&path),
            Err(SessionError::Json(_))
        ));
    }

    #[test]
    fn value_reads_reject_duplicate_keys() {
        let directory = TestDirectory::new();
        let path = directory.join("session.json");

        fs::write(&path, r#"{"name":"first","name":"second"}"#).unwrap();
        assert!(read_session_name(&path).is_none());
        assert!(matches!(
            update_session_name(&path, "new name"),
            Err(SessionError::Json(_))
        ));

        fs::write(&path, r#"{"name":"old","nested":{"a":1,"a":2}}"#).unwrap();
        assert!(matches!(
            update_session_name(&path, "new name"),
            Err(SessionError::Json(_))
        ));

        fs::write(&path, r#"{"name":"first","\u006eame":"second"}"#).unwrap();
        assert!(matches!(
            update_session_name(&path, "new name"),
            Err(SessionError::Json(_))
        ));
    }

    #[test]
    fn read_name_returns_none_for_missing_or_invalid_data() {
        let directory = TestDirectory::new();
        let path = directory.join("session.json");

        assert!(read_session_name(&path).is_none());
        fs::write(&path, "not JSON").unwrap();
        assert!(read_session_name(&path).is_none());
        fs::write(&path, r#"{"name": 42}"#).unwrap();
        assert!(read_session_name(&path).is_none());
    }
}
