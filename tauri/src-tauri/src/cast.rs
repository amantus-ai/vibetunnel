use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use chrono::{DateTime, Utc};

/// Asciinema cast v2 format header
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CastHeader {
    pub version: u8,
    pub width: u16,
    pub height: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idle_time_limit: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
}

/// Event types for Asciinema cast format
#[derive(Debug, Clone, Copy)]
pub enum EventType {
    Output,
    Input,
}

impl EventType {
    fn as_str(&self) -> &'static str {
        match self {
            EventType::Output => "o",
            EventType::Input => "i",
        }
    }
}

/// A single event in the cast file
#[derive(Debug)]
pub struct CastEvent {
    pub timestamp: f64,
    pub event_type: EventType,
    pub data: String,
}

/// Handles recording terminal sessions in Asciinema cast format
pub struct CastRecorder {
    header: CastHeader,
    start_time: DateTime<Utc>,
    events: Arc<Mutex<Vec<CastEvent>>>,
    file_writer: Option<Arc<Mutex<BufWriter<File>>>>,
    is_recording: Arc<Mutex<bool>>,
}

impl CastRecorder {
    /// Create a new cast recorder
    pub fn new(
        width: u16,
        height: u16,
        title: Option<String>,
        command: Option<String>,
    ) -> Self {
        let now = Utc::now();
        let header = CastHeader {
            version: 2,
            width,
            height,
            timestamp: Some(now.timestamp()),
            duration: None,
            idle_time_limit: None,
            command,
            title,
            env: None,
        };

        Self {
            header,
            start_time: now,
            events: Arc::new(Mutex::new(Vec::new())),
            file_writer: None,
            is_recording: Arc::new(Mutex::new(false)),
        }
    }

    /// Start recording to a file
    pub async fn start_recording(&mut self, path: impl AsRef<Path>) -> Result<(), String> {
        let mut is_recording = self.is_recording.lock().await;
        if *is_recording {
            return Err("Already recording".to_string());
        }

        // Create file and write header
        let file = File::create(path.as_ref())
            .map_err(|e| format!("Failed to create cast file: {}", e))?;
        let mut writer = BufWriter::new(file);

        // Write header as first line
        let header_json = serde_json::to_string(&self.header)
            .map_err(|e| format!("Failed to serialize header: {}", e))?;
        writeln!(writer, "{}", header_json)
            .map_err(|e| format!("Failed to write header: {}", e))?;

        // Write any existing events
        let events = self.events.lock().await;
        for event in events.iter() {
            self.write_event_to_file(&mut writer, event)?;
        }

        writer.flush()
            .map_err(|e| format!("Failed to flush writer: {}", e))?;

        self.file_writer = Some(Arc::new(Mutex::new(writer)));
        *is_recording = true;
        Ok(())
    }

    /// Stop recording
    pub async fn stop_recording(&mut self) -> Result<(), String> {
        let mut is_recording = self.is_recording.lock().await;
        if !*is_recording {
            return Ok(());
        }

        if let Some(writer_arc) = self.file_writer.take() {
            let mut writer = writer_arc.lock().await;
            writer.flush()
                .map_err(|e| format!("Failed to flush final data: {}", e))?;
        }

        *is_recording = false;
        Ok(())
    }

    /// Add output data to the recording
    pub async fn add_output(&self, data: &[u8]) -> Result<(), String> {
        self.add_event(EventType::Output, data).await
    }

    /// Add input data to the recording
    pub async fn add_input(&self, data: &[u8]) -> Result<(), String> {
        self.add_event(EventType::Input, data).await
    }

    /// Add an event to the recording
    async fn add_event(&self, event_type: EventType, data: &[u8]) -> Result<(), String> {
        let timestamp = Utc::now()
            .signed_duration_since(self.start_time)
            .num_milliseconds() as f64 / 1000.0;

        // Convert data to string (handling potential UTF-8 errors)
        let data_string = String::from_utf8_lossy(data).to_string();

        let event = CastEvent {
            timestamp,
            event_type,
            data: data_string,
        };

        // If we have a file writer, write immediately
        if let Some(writer_arc) = &self.file_writer {
            let mut writer = writer_arc.lock().await;
            self.write_event_to_file(&mut writer, &event)?;
            writer.flush()
                .map_err(|e| format!("Failed to flush event: {}", e))?;
        }

        // Also store in memory
        let mut events = self.events.lock().await;
        events.push(event);

        Ok(())
    }

    /// Write an event to the file
    fn write_event_to_file(
        &self,
        writer: &mut BufWriter<File>,
        event: &CastEvent,
    ) -> Result<(), String> {
        // Format: [timestamp, event_type, data]
        let event_array = serde_json::json!([
            event.timestamp,
            event.event_type.as_str(),
            event.data
        ]);

        writeln!(writer, "{}", event_array)
            .map_err(|e| format!("Failed to write event: {}", e))?;

        Ok(())
    }

    /// Save all recorded events to a file
    pub async fn save_to_file(&self, path: impl AsRef<Path>) -> Result<(), String> {
        let file = File::create(path.as_ref())
            .map_err(|e| format!("Failed to create cast file: {}", e))?;
        let mut writer = BufWriter::new(file);

        // Calculate duration
        let events = self.events.lock().await;
        let duration = events.last().map(|e| e.timestamp);
        
        // Update header with duration
        let mut header = self.header.clone();
        header.duration = duration;

        // Write header
        let header_json = serde_json::to_string(&header)
            .map_err(|e| format!("Failed to serialize header: {}", e))?;
        writeln!(writer, "{}", header_json)
            .map_err(|e| format!("Failed to write header: {}", e))?;

        // Write events
        for event in events.iter() {
            self.write_event_to_file(&mut writer, event)?;
        }

        writer.flush()
            .map_err(|e| format!("Failed to flush file: {}", e))?;

        Ok(())
    }

    /// Get the current recording duration
    pub async fn get_duration(&self) -> f64 {
        let events = self.events.lock().await;
        events.last().map(|e| e.timestamp).unwrap_or(0.0)
    }

    /// Check if currently recording
    pub async fn is_recording(&self) -> bool {
        *self.is_recording.lock().await
    }

    /// Update terminal dimensions
    pub async fn resize(&mut self, width: u16, height: u16) {
        self.header.width = width;
        self.header.height = height;
        // Note: In a real implementation, you might want to add a resize event
    }
}

/// Manages cast recordings for multiple sessions
pub struct CastManager {
    recorders: Arc<Mutex<HashMap<String, Arc<Mutex<CastRecorder>>>>>,
}

impl CastManager {
    pub fn new() -> Self {
        Self {
            recorders: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Create a new recorder for a session
    pub async fn create_recorder(
        &self,
        session_id: String,
        width: u16,
        height: u16,
        title: Option<String>,
        command: Option<String>,
    ) -> Result<(), String> {
        let mut recorders = self.recorders.lock().await;
        if recorders.contains_key(&session_id) {
            return Err("Recorder already exists for this session".to_string());
        }

        let recorder = CastRecorder::new(width, height, title, command);
        recorders.insert(session_id, Arc::new(Mutex::new(recorder)));
        Ok(())
    }

    /// Get a recorder for a session
    pub async fn get_recorder(&self, session_id: &str) -> Option<Arc<Mutex<CastRecorder>>> {
        self.recorders.lock().await.get(session_id).cloned()
    }

    /// Remove a recorder for a session
    pub async fn remove_recorder(&self, session_id: &str) -> Result<(), String> {
        let mut recorders = self.recorders.lock().await;
        if let Some(recorder_arc) = recorders.remove(session_id) {
            let mut recorder = recorder_arc.lock().await;
            recorder.stop_recording().await?;
        }
        Ok(())
    }

    /// Start recording for a session
    pub async fn start_recording(
        &self,
        session_id: &str,
        path: impl AsRef<Path>,
    ) -> Result<(), String> {
        if let Some(recorder_arc) = self.get_recorder(session_id).await {
            let mut recorder = recorder_arc.lock().await;
            recorder.start_recording(path).await
        } else {
            Err("No recorder found for session".to_string())
        }
    }

    /// Stop recording for a session
    pub async fn stop_recording(&self, session_id: &str) -> Result<(), String> {
        if let Some(recorder_arc) = self.get_recorder(session_id).await {
            let mut recorder = recorder_arc.lock().await;
            recorder.stop_recording().await
        } else {
            Err("No recorder found for session".to_string())
        }
    }

    /// Add output to a session's recording
    pub async fn add_output(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        if let Some(recorder_arc) = self.get_recorder(session_id).await {
            let recorder = recorder_arc.lock().await;
            recorder.add_output(data).await
        } else {
            Ok(()) // Silently ignore if no recorder
        }
    }

    /// Add input to a session's recording
    pub async fn add_input(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        if let Some(recorder_arc) = self.get_recorder(session_id).await {
            let recorder = recorder_arc.lock().await;
            recorder.add_input(data).await
        } else {
            Ok(()) // Silently ignore if no recorder
        }
    }

    /// Save a session's recording to file
    pub async fn save_recording(
        &self,
        session_id: &str,
        path: impl AsRef<Path>,
    ) -> Result<(), String> {
        if let Some(recorder_arc) = self.get_recorder(session_id).await {
            let recorder = recorder_arc.lock().await;
            recorder.save_to_file(path).await
        } else {
            Err("No recorder found for session".to_string())
        }
    }

    /// Check if a session is being recorded
    pub async fn is_recording(&self, session_id: &str) -> bool {
        if let Some(recorder_arc) = self.get_recorder(session_id).await {
            let recorder = recorder_arc.lock().await;
            recorder.is_recording().await
        } else {
            false
        }
    }
}