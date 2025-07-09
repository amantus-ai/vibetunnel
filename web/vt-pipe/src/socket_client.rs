use anyhow::{Context, Result};
use bytes::{BufMut, BytesMut};
use serde_json::json;
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;

/// Socket protocol message types (matching socket-protocol.ts)
#[repr(u8)]
pub(crate) enum MessageType {
  StdinData = 0x01,
  ControlCmd = 0x02,
  #[allow(dead_code)]
  StatusUpdate = 0x03,
  #[allow(dead_code)]
  StdoutData = 0x04,
  #[allow(dead_code)]
  SessionInfo = 0x05,
  #[allow(dead_code)]
  Error = 0x06,
}

/// Socket client for communicating with VibeTunnel server
pub struct SocketClient {
  stream: UnixStream,
}

impl SocketClient {
  /// Connect to a Unix socket
  pub async fn connect<P: AsRef<Path>>(path: P) -> Result<Self> {
    let stream = UnixStream::connect(path)
      .await
      .context("Failed to connect to Unix socket")?;

    Ok(Self { stream })
  }

  /// Send stdin data to the server
  pub async fn send_stdin(&mut self, data: &[u8]) -> Result<()> {
    self.send_message(MessageType::StdinData, data).await
  }

  /// Send a resize command
  pub async fn send_resize(&mut self, cols: u16, rows: u16) -> Result<()> {
    let cmd = json!({
        "cmd": "resize",
        "cols": cols,
        "rows": rows,
    });

    let payload = serde_json::to_vec(&cmd)?;
    self.send_message(MessageType::ControlCmd, &payload).await
  }

  /// Send an update-title command
  pub async fn send_update_title(&mut self, title: &str) -> Result<()> {
    let cmd = json!({
        "cmd": "update-title",
        "title": title,
    });

    let payload = serde_json::to_vec(&cmd)?;
    self.send_message(MessageType::ControlCmd, &payload).await
  }

  /// Send a kill command
  #[allow(dead_code)]
  pub async fn send_kill(&mut self, signal: Option<String>) -> Result<()> {
    let cmd = if let Some(sig) = signal {
      json!({
          "cmd": "kill",
          "signal": sig,
      })
    } else {
      json!({
          "cmd": "kill",
      })
    };

    let payload = serde_json::to_vec(&cmd)?;
    self.send_message(MessageType::ControlCmd, &payload).await
  }

  /// Send a message with the binary protocol format
  async fn send_message(&mut self, msg_type: MessageType, payload: &[u8]) -> Result<()> {
    // Frame format: [1 byte type][4 bytes length][N bytes payload]
    let mut frame = BytesMut::with_capacity(5 + payload.len());

    // Message type (1 byte)
    frame.put_u8(msg_type as u8);

    // Payload length (4 bytes, big-endian)
    frame.put_u32(payload.len() as u32);

    // Payload
    frame.extend_from_slice(payload);

    // Send the frame
    self
      .stream
      .write_all(&frame)
      .await
      .context("Failed to write to socket")?;

    self
      .stream
      .flush()
      .await
      .context("Failed to flush socket")?;

    Ok(())
  }

  /// Read a message from the socket
  #[allow(dead_code)]
  pub async fn read_message(&mut self) -> Result<Option<(MessageType, Vec<u8>)>> {
    // Read header (5 bytes)
    let mut header = [0u8; 5];
    match self.stream.read_exact(&mut header).await {
      Ok(_) => {},
      Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
      Err(e) => return Err(e.into()),
    }

    // Parse header
    let msg_type = match header[0] {
      0x01 => MessageType::StdinData,
      0x02 => MessageType::ControlCmd,
      0x03 => MessageType::StatusUpdate,
      0x04 => MessageType::StdoutData,
      0x05 => MessageType::SessionInfo,
      0x06 => MessageType::Error,
      _ => anyhow::bail!("Unknown message type: {}", header[0]),
    };

    let length = u32::from_be_bytes([header[1], header[2], header[3], header[4]]) as usize;

    // Read payload
    let mut payload = vec![0u8; length];
    self
      .stream
      .read_exact(&mut payload)
      .await
      .context("Failed to read payload")?;

    Ok(Some((msg_type, payload)))
  }
}
