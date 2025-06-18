use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{self, Command, Stdio};
use std::time::SystemTime;
use std::{fmt, fs};

use anyhow::Error;
use jiff::Timestamp;
use serde::de;
use serde::{Deserialize, Serialize};

use crate::tty_spawn::DEFAULT_TERM;

#[derive(Serialize, Deserialize, Default, Debug, Clone)]
pub struct SessionInfo {
    pub cmdline: Vec<String>,
    pub name: String,
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<Timestamp>,
    #[serde(default = "get_default_term")]
    pub term: String,
    #[serde(default = "get_default_spawn_type")]
    pub spawn_type: String,
}

fn get_default_term() -> String {
    DEFAULT_TERM.to_string()
}

fn get_default_spawn_type() -> String {
    "socket".to_string()
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SessionListEntry {
    #[serde(flatten)]
    pub session_info: SessionInfo,
    #[serde(rename = "stream-out")]
    pub stream_out: String,
    pub stdin: String,
    #[serde(rename = "notification-stream")]
    pub notification_stream: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SessionEntryWithId {
    pub session_id: String,
    #[serde(flatten)]
    pub entry: SessionListEntry,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AsciinemaHeader {
    pub version: u32,
    pub width: u32,
    pub height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<AsciinemaTheme>,
}

impl Default for AsciinemaHeader {
    fn default() -> Self {
        Self {
            version: 2,
            width: 80,
            height: 24,
            timestamp: None,
            duration: None,
            command: None,
            title: None,
            env: None,
            theme: None,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AsciinemaTheme {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fg: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bg: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub palette: Option<String>,
}

#[derive(Debug, Clone)]
pub enum AsciinemaEventType {
    Output,
    Input,
    Marker,
    Resize,
}

impl AsciinemaEventType {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Output => "o",
            Self::Input => "i",
            Self::Marker => "m",
            Self::Resize => "r",
        }
    }

    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "o" => Ok(Self::Output),
            "i" => Ok(Self::Input),
            "m" => Ok(Self::Marker),
            "r" => Ok(Self::Resize),
            _ => Err(format!("Unknown event type: {s}")),
        }
    }
}

#[derive(Debug, Clone)]
pub struct AsciinemaEvent {
    pub time: f64,
    pub event_type: AsciinemaEventType,
    pub data: String,
}

impl serde::Serialize for AsciinemaEvent {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeTuple;
        let mut tuple = serializer.serialize_tuple(3)?;
        tuple.serialize_element(&self.time)?;
        tuple.serialize_element(self.event_type.as_str())?;
        tuple.serialize_element(&self.data)?;
        tuple.end()
    }
}

impl<'de> serde::Deserialize<'de> for AsciinemaEvent {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use serde::de::{SeqAccess, Visitor};

        struct AsciinemaEventVisitor;

        impl<'de> Visitor<'de> for AsciinemaEventVisitor {
            type Value = AsciinemaEvent;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a tuple of [time, type, data]")
            }

            fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
            where
                A: SeqAccess<'de>,
            {
                let time: f64 = seq
                    .next_element()?
                    .ok_or_else(|| de::Error::invalid_length(0, &self))?;
                let event_type_str: String = seq
                    .next_element()?
                    .ok_or_else(|| de::Error::invalid_length(1, &self))?;
                let data: String = seq
                    .next_element()?
                    .ok_or_else(|| de::Error::invalid_length(2, &self))?;

                let event_type =
                    AsciinemaEventType::from_str(&event_type_str).map_err(de::Error::custom)?;

                Ok(AsciinemaEvent {
                    time,
                    event_type,
                    data,
                })
            }
        }

        deserializer.deserialize_tuple(3, AsciinemaEventVisitor)
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NotificationEvent {
    pub timestamp: Timestamp,
    pub event: String,
    pub data: serde_json::Value,
}

pub struct StreamWriter {
    file: std::fs::File,
    start_time: std::time::Instant,
    utf8_buffer: Vec<u8>,
}

impl StreamWriter {
    pub fn new(file: std::fs::File, header: AsciinemaHeader) -> Result<Self, Error> {
        use std::io::Write;
        let mut writer = Self {
            file,
            start_time: std::time::Instant::now(),
            utf8_buffer: Vec::new(),
        };
        let header_json = serde_json::to_string(&header)?;
        writeln!(&mut writer.file, "{header_json}")?;
        writer.file.flush()?;
        Ok(writer)
    }

    pub fn with_params(
        file: std::fs::File,
        width: u32,
        height: u32,
        command: Option<String>,
        title: Option<String>,
        env: Option<std::collections::HashMap<String, String>>,
    ) -> Result<Self, Error> {
        let header = AsciinemaHeader {
            version: 2,
            width,
            height,
            timestamp: Some(
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            ),
            duration: None,
            command,
            title,
            env,
            theme: None,
        };

        Self::new(file, header)
    }

    pub fn write_output(&mut self, buf: &[u8]) -> Result<(), Error> {
        let time = self.elapsed_time();

        // Combine any buffered bytes with the new buffer
        let mut combined_buf = std::mem::take(&mut self.utf8_buffer);
        combined_buf.extend_from_slice(buf);

        // Process data in escape-sequence-aware chunks
        let (processed_data, remaining_buffer) = self.process_terminal_data(&combined_buf);

        if !processed_data.is_empty() {
            let event = AsciinemaEvent {
                time,
                event_type: AsciinemaEventType::Output,
                data: processed_data,
            };
            self.write_event(event)?;
        }

        // Store any remaining incomplete data for next time
        self.utf8_buffer = remaining_buffer;
        Ok(())
    }

    /// Process terminal data while preserving escape sequences
    fn process_terminal_data(&self, buf: &[u8]) -> (String, Vec<u8>) {
        let mut result = String::new();
        let mut pos = 0;

        while pos < buf.len() {
            // Look for escape sequences starting with ESC (0x1B)
            if buf[pos] == 0x1B {
                // Try to find complete escape sequence
                if let Some(seq_end) = self.find_escape_sequence_end(&buf[pos..]) {
                    let seq_bytes = &buf[pos..pos + seq_end];
                    // Preserve escape sequence as-is using lossy conversion
                    // This will preserve most escape sequences correctly
                    result.push_str(&String::from_utf8_lossy(seq_bytes));
                    pos += seq_end;
                } else {
                    // Incomplete escape sequence at end of buffer - save for later
                    return (result, buf[pos..].to_vec());
                }
            } else {
                // Regular text - find the next escape sequence or end of valid UTF-8
                let chunk_start = pos;
                while pos < buf.len() && buf[pos] != 0x1B {
                    pos += 1;
                }

                let text_chunk = &buf[chunk_start..pos];

                // Handle UTF-8 validation for text chunks
                match std::str::from_utf8(text_chunk) {
                    Ok(valid_text) => {
                        result.push_str(valid_text);
                    }
                    Err(e) => {
                        let valid_up_to = e.valid_up_to();

                        // Process valid part
                        if valid_up_to > 0 {
                            result.push_str(&String::from_utf8_lossy(&text_chunk[..valid_up_to]));
                        }

                        // Check if we have incomplete UTF-8 at the end
                        let invalid_start = chunk_start + valid_up_to;
                        let remaining = &buf[invalid_start..];

                        if remaining.len() <= 4 && pos >= buf.len() {
                            // Might be incomplete UTF-8 at buffer end
                            if let Err(utf8_err) = std::str::from_utf8(remaining) {
                                if utf8_err.error_len().is_none() {
                                    // Incomplete UTF-8 sequence - buffer it
                                    return (result, remaining.to_vec());
                                }
                            }
                        }

                        // Invalid UTF-8 in middle or complete invalid sequence
                        // Use lossy conversion for this part
                        let invalid_part = &text_chunk[valid_up_to..];
                        result.push_str(&String::from_utf8_lossy(invalid_part));
                    }
                }
            }
        }

        (result, Vec::new())
    }

    /// Find the end of an ANSI escape sequence starting at the given position
    fn find_escape_sequence_end(&self, buf: &[u8]) -> Option<usize> {
        if buf.is_empty() || buf[0] != 0x1B {
            return None;
        }

        if buf.len() < 2 {
            return None; // Incomplete - need more data
        }

        match buf[1] {
            // CSI sequences: ESC [ ... final_char
            b'[' => {
                let mut pos = 2;
                // Skip parameter and intermediate characters
                while pos < buf.len() {
                    match buf[pos] {
                        // Parameter characters 0-9 : ; < = > ? and Intermediate characters
                        0x20..=0x3F => pos += 1,
                        0x40..=0x7E => return Some(pos + 1), // Final character @ A-Z [ \ ] ^ _ ` a-z { | } ~
                        _ => return Some(pos),               // Invalid sequence, stop here
                    }
                }
                None // Incomplete sequence
            }

            // OSC sequences: ESC ] ... (ST or BEL)
            b']' => {
                let mut pos = 2;
                while pos < buf.len() {
                    match buf[pos] {
                        0x07 => return Some(pos + 1), // BEL terminator
                        0x1B if pos + 1 < buf.len() && buf[pos + 1] == b'\\' => {
                            return Some(pos + 2); // ESC \ (ST) terminator
                        }
                        _ => pos += 1,
                    }
                }
                None // Incomplete sequence
            }

            // Simple two-character sequences: ESC letter
            // Other escape sequences - assume two characters for now
            _ => Some(2),
        }
    }

    pub fn write_event(&mut self, event: AsciinemaEvent) -> Result<(), Error> {
        use std::io::Write;

        let event_json = serde_json::to_string(&event)?;
        writeln!(self.file, "{event_json}")?;
        self.file.flush()?;

        Ok(())
    }

    pub fn write_raw_json(&mut self, json_value: &serde_json::Value) -> Result<(), Error> {
        use std::io::Write;

        let json_string = serde_json::to_string(json_value)?;
        writeln!(self.file, "{json_string}")?;
        self.file.flush()?;

        Ok(())
    }

    pub fn elapsed_time(&self) -> f64 {
        self.start_time.elapsed().as_secs_f64()
    }
}

pub struct NotificationWriter {
    file: std::fs::File,
}

impl NotificationWriter {
    pub const fn new(file: std::fs::File) -> Self {
        Self { file }
    }

    pub fn write_notification(&mut self, event: NotificationEvent) -> Result<(), std::io::Error> {
        use std::io::Write;

        let event_json = serde_json::to_string(&event)?;
        writeln!(self.file, "{event_json}")?;
        self.file.flush()?;

        Ok(())
    }
}

#[derive(Debug, Clone)]
pub enum StreamEvent {
    Header(AsciinemaHeader),
    Terminal(AsciinemaEvent),
    Exit { exit_code: i32, session_id: String },
    Error { message: String },
    End,
}

// Error event JSON structure for serde
#[derive(Serialize, Deserialize, Debug, Clone)]
struct ErrorEvent {
    #[serde(rename = "type")]
    event_type: String,
    message: String,
}

// End event JSON structure for serde
#[derive(Serialize, Deserialize, Debug, Clone)]
struct EndEvent {
    #[serde(rename = "type")]
    event_type: String,
}

impl serde::Serialize for StreamEvent {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::Header(header) => header.serialize(serializer),
            Self::Terminal(event) => event.serialize(serializer),
            Self::Exit {
                exit_code,
                session_id,
            } => {
                use serde::ser::SerializeTuple;
                let mut tuple = serializer.serialize_tuple(3)?;
                tuple.serialize_element("exit")?;
                tuple.serialize_element(exit_code)?;
                tuple.serialize_element(session_id)?;
                tuple.end()
            }
            Self::Error { message } => {
                let error_event = ErrorEvent {
                    event_type: "error".to_string(),
                    message: message.clone(),
                };
                error_event.serialize(serializer)
            }
            Self::End => {
                let end_event = EndEvent {
                    event_type: "end".to_string(),
                };
                end_event.serialize(serializer)
            }
        }
    }
}

impl<'de> serde::Deserialize<'de> for StreamEvent {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value: serde_json::Value = serde_json::Value::deserialize(deserializer)?;

        // Try to parse as header first (has version and width fields)
        if value.get("version").is_some() && value.get("width").is_some() {
            let header: AsciinemaHeader = serde_json::from_value(value)
                .map_err(|e| de::Error::custom(format!("Failed to parse header: {e}")))?;
            return Ok(Self::Header(header));
        }

        // Try to parse as an event array [timestamp, type, data]
        if let Some(arr) = value.as_array() {
            if arr.len() >= 3 {
                // Check for exit event: ["exit", exit_code, session_id]
                if let Some(first) = arr[0].as_str() {
                    if first == "exit" {
                        let exit_code = arr[1].as_i64().unwrap_or(0) as i32;
                        let session_id = arr[2].as_str().unwrap_or("unknown").to_string();
                        return Ok(Self::Exit {
                            exit_code,
                            session_id,
                        });
                    }
                }

                let event: AsciinemaEvent = serde_json::from_value(value).map_err(|e| {
                    de::Error::custom(format!("Failed to parse terminal event: {e}"))
                })?;
                return Ok(Self::Terminal(event));
            }
        }

        // Try to parse as error or end event
        if let Some(obj) = value.as_object() {
            if let Some(event_type) = obj.get("type").and_then(|v| v.as_str()) {
                match event_type {
                    "error" => {
                        let error_event: ErrorEvent =
                            serde_json::from_value(value).map_err(|e| {
                                de::Error::custom(format!("Failed to parse error event: {e}"))
                            })?;
                        return Ok(Self::Error {
                            message: error_event.message,
                        });
                    }
                    "end" => {
                        return Ok(Self::End);
                    }
                    _ => {}
                }
            }
        }

        Err(de::Error::custom("Unrecognized stream event format"))
    }
}

impl StreamEvent {
    pub fn from_json_line(line: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let line = line.trim();
        if line.is_empty() {
            return Err("Empty line".into());
        }

        let event: Self = serde_json::from_str(line)?;
        Ok(event)
    }
}

#[derive(Debug)]
enum StreamingState {
    ReadingExisting(BufReader<std::fs::File>),
    InitializingTail,
    Streaming {
        reader: BufReader<process::ChildStdout>,
        child: process::Child,
    },
    Error(String),
    Finished,
}

pub struct StreamingIterator {
    stream_path: String,
    start_time: SystemTime,
    state: StreamingState,
    wait_start: Option<SystemTime>,
}

impl StreamingIterator {
    pub fn new(stream_path: String) -> Self {
        let state = if let Ok(file) = fs::File::open(&stream_path) {
            StreamingState::ReadingExisting(BufReader::new(file))
        } else {
            StreamingState::InitializingTail
        };

        Self {
            stream_path,
            start_time: SystemTime::now(),
            state,
            wait_start: None,
        }
    }
}

impl Iterator for StreamingIterator {
    type Item = StreamEvent;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            match &mut self.state {
                StreamingState::ReadingExisting(reader) => {
                    let mut line = String::new();
                    match reader.read_line(&mut line) {
                        Ok(0) => {
                            // End of file, switch to tail mode
                            self.state = StreamingState::InitializingTail;
                        }
                        Ok(_) => {
                            if let Ok(mut event) = StreamEvent::from_json_line(&line) {
                                // Convert terminal events to instant playback (time = 0)
                                if let StreamEvent::Terminal(ref mut term_event) = event {
                                    term_event.time = 0.0;
                                }
                                return Some(event);
                            }
                            // If parsing fails, continue to next line
                        }
                        Err(e) => {
                            self.state = StreamingState::Error(format!("Error reading file: {e}"));
                        }
                    }
                }
                StreamingState::InitializingTail => {
                    // Check if the file exists, if not wait a bit and retry
                    if !std::path::Path::new(&self.stream_path).exists() {
                        // Initialize wait start time if not set
                        if self.wait_start.is_none() {
                            self.wait_start = Some(SystemTime::now());
                        }

                        // Check if we've been waiting too long (5 seconds timeout)
                        if let Some(wait_start) = self.wait_start {
                            if wait_start.elapsed().unwrap_or_default()
                                > std::time::Duration::from_secs(5)
                            {
                                self.state = StreamingState::Error(
                                    "Timeout waiting for stream file to be created".to_string(),
                                );
                                return None;
                            }
                        }

                        // File doesn't exist yet, wait 50ms and return None to retry later
                        std::thread::sleep(std::time::Duration::from_millis(50));
                        return None;
                    }

                    match Command::new("tail")
                        .args(["-f", &self.stream_path])
                        .stdout(Stdio::piped())
                        .spawn()
                    {
                        Ok(mut child) => {
                            if let Some(stdout) = child.stdout.take() {
                                self.state = StreamingState::Streaming {
                                    reader: BufReader::new(stdout),
                                    child,
                                };
                            } else {
                                self.state =
                                    StreamingState::Error("Failed to get tail stdout".to_string());
                            }
                        }
                        Err(e) => {
                            self.state =
                                StreamingState::Error(format!("Failed to start tail command: {e}"));
                        }
                    }
                }
                StreamingState::Streaming { reader, child: _ } => {
                    let mut line = String::new();
                    match reader.read_line(&mut line) {
                        Ok(0) => {
                            // End of stream
                            self.state = StreamingState::Finished;
                            return Some(StreamEvent::End);
                        }
                        Ok(_) => {
                            if line.trim().is_empty() {
                                continue;
                            }

                            match StreamEvent::from_json_line(&line) {
                                Ok(mut event) => {
                                    if matches!(event, StreamEvent::Header(_)) {
                                        continue;
                                    }
                                    if let StreamEvent::Terminal(ref mut term_event) = event {
                                        let current_time = SystemTime::now()
                                            .duration_since(SystemTime::UNIX_EPOCH)
                                            .unwrap_or_default()
                                            .as_secs_f64();
                                        let stream_start_time = self
                                            .start_time
                                            .duration_since(SystemTime::UNIX_EPOCH)
                                            .unwrap_or_default()
                                            .as_secs_f64();
                                        term_event.time = current_time - stream_start_time;
                                    }
                                    return Some(event);
                                }
                                Err(err) => {
                                    self.state =
                                        StreamingState::Error(format!("Error parsing JSON: {err}"));
                                }
                            }
                        }
                        Err(e) => {
                            self.state =
                                StreamingState::Error(format!("Error reading from tail: {e}"));
                        }
                    }
                }
                StreamingState::Error(message) => {
                    let error_message = message.clone();
                    self.state = StreamingState::Finished;
                    return Some(StreamEvent::Error {
                        message: error_message,
                    });
                }
                StreamingState::Finished => {
                    return None;
                }
            }
        }
    }
}

impl Drop for StreamingIterator {
    fn drop(&mut self) {
        if let StreamingState::Streaming { child, .. } = &mut self.state {
            let _ = child.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_info_serialization() {
        let session = SessionInfo {
            cmdline: vec!["bash".to_string(), "-l".to_string()],
            name: "test-session".to_string(),
            cwd: "/home/user".to_string(),
            pid: Some(1234),
            status: "running".to_string(),
            exit_code: None,
            started_at: Some(Timestamp::now()),
            term: "xterm-256color".to_string(),
            spawn_type: "pty".to_string(),
        };

        let json = serde_json::to_string(&session).unwrap();
        let deserialized: SessionInfo = serde_json::from_str(&json).unwrap();

        assert_eq!(session.cmdline, deserialized.cmdline);
        assert_eq!(session.name, deserialized.name);
        assert_eq!(session.cwd, deserialized.cwd);
        assert_eq!(session.pid, deserialized.pid);
        assert_eq!(session.status, deserialized.status);
        assert_eq!(session.term, deserialized.term);
        assert_eq!(session.spawn_type, deserialized.spawn_type);
    }

    #[test]
    fn test_session_info_defaults() {
        let json = r#"{
            "cmdline": ["bash"],
            "name": "test",
            "cwd": "/tmp",
            "status": "running"
        }"#;

        let session: SessionInfo = serde_json::from_str(json).unwrap();
        assert_eq!(session.term, DEFAULT_TERM);
        assert_eq!(session.spawn_type, "socket");
    }

    #[test]
    fn test_asciinema_header_serialization() {
        let header = AsciinemaHeader {
            version: 2,
            width: 120,
            height: 40,
            timestamp: Some(1234567890),
            duration: Some(123.45),
            command: Some("bash -l".to_string()),
            title: Some("Test Recording".to_string()),
            env: Some(HashMap::from([
                ("SHELL".to_string(), "/bin/bash".to_string()),
                ("TERM".to_string(), "xterm-256color".to_string()),
            ])),
            theme: Some(AsciinemaTheme {
                fg: Some("#ffffff".to_string()),
                bg: Some("#000000".to_string()),
                palette: Some("solarized".to_string()),
            }),
        };

        let json = serde_json::to_string(&header).unwrap();
        let deserialized: AsciinemaHeader = serde_json::from_str(&json).unwrap();

        assert_eq!(header.version, deserialized.version);
        assert_eq!(header.width, deserialized.width);
        assert_eq!(header.height, deserialized.height);
        assert_eq!(header.timestamp, deserialized.timestamp);
        assert_eq!(header.duration, deserialized.duration);
        assert_eq!(header.command, deserialized.command);
        assert_eq!(header.title, deserialized.title);
        assert_eq!(header.env, deserialized.env);
    }

    #[test]
    fn test_asciinema_header_defaults() {
        let header = AsciinemaHeader::default();
        assert_eq!(header.version, 2);
        assert_eq!(header.width, 80);
        assert_eq!(header.height, 24);
        assert!(header.timestamp.is_none());
        assert!(header.duration.is_none());
        assert!(header.command.is_none());
        assert!(header.title.is_none());
        assert!(header.env.is_none());
        assert!(header.theme.is_none());
    }

    #[test]
    fn test_asciinema_event_type_conversions() {
        assert_eq!(AsciinemaEventType::Output.as_str(), "o");
        assert_eq!(AsciinemaEventType::Input.as_str(), "i");
        assert_eq!(AsciinemaEventType::Marker.as_str(), "m");
        assert_eq!(AsciinemaEventType::Resize.as_str(), "r");

        assert!(matches!(
            AsciinemaEventType::from_str("o"),
            Ok(AsciinemaEventType::Output)
        ));
        assert!(matches!(
            AsciinemaEventType::from_str("i"),
            Ok(AsciinemaEventType::Input)
        ));
        assert!(matches!(
            AsciinemaEventType::from_str("m"),
            Ok(AsciinemaEventType::Marker)
        ));
        assert!(matches!(
            AsciinemaEventType::from_str("r"),
            Ok(AsciinemaEventType::Resize)
        ));
        assert!(AsciinemaEventType::from_str("x").is_err());
    }

    #[test]
    fn test_asciinema_event_serialization() {
        let event = AsciinemaEvent {
            time: 1.234,
            event_type: AsciinemaEventType::Output,
            data: "Hello, World!\n".to_string(),
        };

        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(json, r#"[1.234,"o","Hello, World!\n"]"#);

        let deserialized: AsciinemaEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(event.time, deserialized.time);
        assert!(matches!(
            deserialized.event_type,
            AsciinemaEventType::Output
        ));
        assert_eq!(event.data, deserialized.data);
    }

    #[test]
    fn test_notification_event_serialization() {
        let event = NotificationEvent {
            timestamp: Timestamp::now(),
            event: "window_resize".to_string(),
            data: serde_json::json!({
                "width": 120,
                "height": 40
            }),
        };

        let json = serde_json::to_string(&event).unwrap();
        let deserialized: NotificationEvent = serde_json::from_str(&json).unwrap();

        assert_eq!(event.event, deserialized.event);
        assert_eq!(event.data, deserialized.data);
    }

    #[test]
    fn test_stream_event_header_serialization() {
        let header = AsciinemaHeader::default();
        let event = StreamEvent::Header(header.clone());

        let json = serde_json::to_string(&event).unwrap();
        let deserialized: StreamEvent = serde_json::from_str(&json).unwrap();

        if let StreamEvent::Header(h) = deserialized {
            assert_eq!(h.version, header.version);
            assert_eq!(h.width, header.width);
            assert_eq!(h.height, header.height);
        } else {
            panic!("Expected Header variant");
        }
    }

    #[test]
    fn test_stream_event_terminal_serialization() {
        let terminal_event = AsciinemaEvent {
            time: 2.5,
            event_type: AsciinemaEventType::Input,
            data: "test input".to_string(),
        };
        let event = StreamEvent::Terminal(terminal_event.clone());

        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(json, r#"[2.5,"i","test input"]"#);

        let deserialized: StreamEvent = serde_json::from_str(&json).unwrap();
        if let StreamEvent::Terminal(e) = deserialized {
            assert_eq!(e.time, terminal_event.time);
            assert!(matches!(e.event_type, AsciinemaEventType::Input));
            assert_eq!(e.data, terminal_event.data);
        } else {
            panic!("Expected Terminal variant");
        }
    }

    #[test]
    fn test_stream_event_error_serialization() {
        let event = StreamEvent::Error {
            message: "Test error".to_string(),
        };

        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(json, r#"{"type":"error","message":"Test error"}"#);

        let deserialized: StreamEvent = serde_json::from_str(&json).unwrap();
        if let StreamEvent::Error { message } = deserialized {
            assert_eq!(message, "Test error");
        } else {
            panic!("Expected Error variant");
        }
    }

    #[test]
    fn test_stream_event_end_serialization() {
        let event = StreamEvent::End;

        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(json, r#"{"type":"end"}"#);

        let deserialized: StreamEvent = serde_json::from_str(&json).unwrap();
        assert!(matches!(deserialized, StreamEvent::End));
    }

    #[test]
    fn test_stream_event_from_json_line() {
        // Test header
        let header_line = r#"{"version":2,"width":80,"height":24}"#;
        let event = StreamEvent::from_json_line(header_line).unwrap();
        assert!(matches!(event, StreamEvent::Header(_)));

        // Test terminal event
        let terminal_line = r#"[1.5,"o","output data"]"#;
        let event = StreamEvent::from_json_line(terminal_line).unwrap();
        assert!(matches!(event, StreamEvent::Terminal(_)));

        // Test error event
        let error_line = r#"{"type":"error","message":"Something went wrong"}"#;
        let event = StreamEvent::from_json_line(error_line).unwrap();
        assert!(matches!(event, StreamEvent::Error { .. }));

        // Test end event
        let end_line = r#"{"type":"end"}"#;
        let event = StreamEvent::from_json_line(end_line).unwrap();
        assert!(matches!(event, StreamEvent::End));

        // Test empty line
        assert!(StreamEvent::from_json_line("").is_err());
        assert!(StreamEvent::from_json_line("  \n").is_err());
    }

    #[test]
    fn test_stream_writer_basic() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        let header = AsciinemaHeader::default();
        let mut writer = StreamWriter::new(file.reopen().unwrap(), header).unwrap();

        // Write some output
        writer.write_output(b"Hello, World!\n").unwrap();

        // Read back and verify
        let mut content = String::new();
        std::io::Read::read_to_string(&mut file, &mut content).unwrap();
        let lines: Vec<&str> = content.lines().collect();

        assert_eq!(lines.len(), 2);
        // First line should be header
        assert!(lines[0].contains("\"version\":2"));
        // Second line should be event
        assert!(lines[1].contains("Hello, World!"));
    }

    #[test]
    fn test_stream_writer_utf8_handling() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        let header = AsciinemaHeader::default();
        let mut writer = StreamWriter::new(file.reopen().unwrap(), header).unwrap();

        // Test complete UTF-8 sequence
        writer.write_output("Hello 世界!".as_bytes()).unwrap();

        // Test incomplete UTF-8 sequence (split multi-byte character)
        let utf8_bytes = "世界".as_bytes();
        writer.write_output(&utf8_bytes[..2]).unwrap(); // Partial first character
        writer.write_output(&utf8_bytes[2..]).unwrap(); // Complete it

        let mut content = String::new();
        std::io::Read::read_to_string(&mut file, &mut content).unwrap();
        let lines: Vec<&str> = content.lines().collect();

        // Should have header + 3 events
        assert!(lines.len() >= 2);
        assert!(lines[1].contains("Hello 世界!"));
    }

    #[test]
    fn test_stream_writer_escape_sequences() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        let header = AsciinemaHeader::default();
        let mut writer = StreamWriter::new(file.reopen().unwrap(), header).unwrap();

        // Test ANSI color escape sequence
        writer.write_output(b"\x1b[31mRed Text\x1b[0m").unwrap();

        // Test cursor movement
        writer.write_output(b"\x1b[2J\x1b[H").unwrap();

        // Test OSC sequence
        writer.write_output(b"\x1b]0;Terminal Title\x07").unwrap();

        let mut content = String::new();
        std::io::Read::read_to_string(&mut file, &mut content).unwrap();
        let lines: Vec<&str> = content.lines().collect();

        // Verify escape sequences are preserved
        assert!(lines[1].contains("\\u001b[31mRed Text\\u001b[0m"));
        assert!(lines[2].contains("\\u001b[2J\\u001b[H"));
        assert!(lines[3].contains("\\u001b]0;Terminal Title"));
    }

    #[test]
    fn test_stream_writer_incomplete_escape_sequence() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        let header = AsciinemaHeader::default();
        let mut writer = StreamWriter::new(file.reopen().unwrap(), header).unwrap();

        // Send incomplete escape sequence
        writer.write_output(b"\x1b[").unwrap();
        // Complete it in next write
        writer.write_output(b"31mColored\x1b[0m").unwrap();

        let mut content = String::new();
        std::io::Read::read_to_string(&mut file, &mut content).unwrap();
        let lines: Vec<&str> = content.lines().collect();

        // Should properly handle the split escape sequence
        assert!(lines.len() >= 2);
    }

    #[test]
    fn test_notification_writer() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        let mut writer = NotificationWriter::new(file.reopen().unwrap());

        let event = NotificationEvent {
            timestamp: Timestamp::now(),
            event: "test_event".to_string(),
            data: serde_json::json!({
                "key": "value",
                "number": 42
            }),
        };

        writer.write_notification(event.clone()).unwrap();

        let mut content = String::new();
        std::io::Read::read_to_string(&mut file, &mut content).unwrap();

        let deserialized: NotificationEvent = serde_json::from_str(content.trim()).unwrap();
        assert_eq!(deserialized.event, event.event);
        assert_eq!(deserialized.data, event.data);
    }

    #[test]
    fn test_session_list_entry_serialization() {
        let entry = SessionListEntry {
            session_info: SessionInfo {
                cmdline: vec!["test".to_string()],
                name: "test-session".to_string(),
                cwd: "/tmp".to_string(),
                pid: Some(9999),
                status: "running".to_string(),
                exit_code: None,
                started_at: None,
                term: "xterm".to_string(),
                spawn_type: "pty".to_string(),
            },
            stream_out: "/tmp/stream.out".to_string(),
            stdin: "/tmp/stdin".to_string(),
            notification_stream: "/tmp/notifications".to_string(),
        };

        let json = serde_json::to_string(&entry).unwrap();
        let deserialized: SessionListEntry = serde_json::from_str(&json).unwrap();

        assert_eq!(entry.session_info.name, deserialized.session_info.name);
        assert_eq!(entry.stream_out, deserialized.stream_out);
        assert_eq!(entry.stdin, deserialized.stdin);
        assert_eq!(entry.notification_stream, deserialized.notification_stream);
    }

    #[test]
    fn test_escape_sequence_detection() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let header = AsciinemaHeader::default();
        let writer = StreamWriter::new(file.reopen().unwrap(), header).unwrap();

        // Test CSI sequence detection
        assert_eq!(writer.find_escape_sequence_end(b"\x1b[31m"), Some(5));
        assert_eq!(writer.find_escape_sequence_end(b"\x1b[2;3H"), Some(6));
        assert_eq!(writer.find_escape_sequence_end(b"\x1b[?25h"), Some(6));

        // Test OSC sequence detection
        assert_eq!(
            writer.find_escape_sequence_end(b"\x1b]0;Title\x07"),
            Some(10)
        );
        assert_eq!(
            writer.find_escape_sequence_end(b"\x1b]0;Title\x1b\\"),
            Some(11)
        );

        // Test incomplete sequences
        assert_eq!(writer.find_escape_sequence_end(b"\x1b"), None);
        assert_eq!(writer.find_escape_sequence_end(b"\x1b["), None);
        assert_eq!(writer.find_escape_sequence_end(b"\x1b]0;Incomplete"), None);

        // Test non-escape sequences
        assert_eq!(writer.find_escape_sequence_end(b"normal text"), None);
    }
}
