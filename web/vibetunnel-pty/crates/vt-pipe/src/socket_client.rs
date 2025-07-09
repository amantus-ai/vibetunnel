use anyhow::{Context, Result};
use serde_json::json;
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use vibetunnel_pty_core::{decode_message, encode_message, MessageType};

/// Socket client for communicating with VibeTunnel server
pub struct SocketClient {
    stream: UnixStream,
    #[allow(dead_code)]
    buffer: Vec<u8>,
}

impl SocketClient {
    /// Connect to a Unix socket with retry logic
    pub async fn connect_with_retry<P: AsRef<Path>>(
        path: P,
        max_retries: u32,
        delay_ms: u64,
    ) -> Result<Self> {
        let path = path.as_ref();

        for attempt in 0..max_retries {
            match UnixStream::connect(path).await {
                Ok(stream) => {
                    return Ok(Self { stream, buffer: Vec::with_capacity(8192) });
                }
                Err(e) => {
                    if attempt < max_retries - 1 {
                        tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
                    } else {
                        return Err(e).context("Failed to connect to Unix socket after retries");
                    }
                }
            }
        }

        unreachable!()
    }

    /// Send stdin data to the server
    pub async fn send_stdin(&mut self, data: &[u8]) -> Result<()> {
        let message = encode_message(MessageType::StdinData, data);
        self.stream.write_all(&message).await.context("Failed to write to socket")?;
        self.stream.flush().await.context("Failed to flush socket")?;
        Ok(())
    }

    /// Send a resize command
    pub async fn send_resize(&mut self, cols: u16, rows: u16) -> Result<()> {
        let cmd = json!({
            "cmd": "resize",
            "cols": cols,
            "rows": rows,
        });

        let payload = serde_json::to_vec(&cmd)?;
        let message = encode_message(MessageType::ControlCmd, &payload);
        self.stream.write_all(&message).await.context("Failed to write to socket")?;
        self.stream.flush().await.context("Failed to flush socket")?;
        Ok(())
    }

    /// Send an update-title command
    pub async fn send_update_title(&mut self, title: &str) -> Result<()> {
        let cmd = json!({
            "cmd": "update-title",
            "title": title,
        });

        let payload = serde_json::to_vec(&cmd)?;
        let message = encode_message(MessageType::ControlCmd, &payload);
        self.stream.write_all(&message).await.context("Failed to write to socket")?;
        self.stream.flush().await.context("Failed to flush socket")?;
        Ok(())
    }

    /// Read messages from the socket
    #[allow(dead_code)]
    pub async fn read_message(&mut self) -> Result<Option<(MessageType, Vec<u8>)>> {
        // Read more data into buffer
        let mut temp_buf = [0u8; 4096];
        match self.stream.read(&mut temp_buf).await {
            Ok(0) => return Ok(None), // EOF
            Ok(n) => self.buffer.extend_from_slice(&temp_buf[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(e) => return Err(e.into()),
        }

        // Try to decode a message
        match decode_message(&self.buffer)? {
            Some((msg_type, payload, consumed)) => {
                // Remove consumed bytes
                self.buffer.drain(..consumed);
                Ok(Some((msg_type, payload)))
            }
            None => Ok(None), // Need more data
        }
    }
}
