use anyhow::Result;
use bytes::{BufMut, BytesMut};

/// Socket protocol message types (matching socket-protocol.ts)
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MessageType {
    StdinData = 0x01,
    ControlCmd = 0x02,
    StatusUpdate = 0x03,
    StdoutData = 0x04,
    SessionInfo = 0x05,
    Error = 0x06,
}

impl TryFrom<u8> for MessageType {
    type Error = anyhow::Error;

    fn try_from(value: u8) -> Result<Self> {
        match value {
            0x01 => Ok(MessageType::StdinData),
            0x02 => Ok(MessageType::ControlCmd),
            0x03 => Ok(MessageType::StatusUpdate),
            0x04 => Ok(MessageType::StdoutData),
            0x05 => Ok(MessageType::SessionInfo),
            0x06 => Ok(MessageType::Error),
            _ => anyhow::bail!("Unknown message type: {}", value),
        }
    }
}

/// Encode a message with the binary protocol format
/// Frame format: [1 byte type][4 bytes length][N bytes payload]
pub fn encode_message(msg_type: MessageType, payload: &[u8]) -> Vec<u8> {
    let mut frame = BytesMut::with_capacity(5 + payload.len());
    
    // Message type (1 byte)
    frame.put_u8(msg_type as u8);
    
    // Payload length (4 bytes, big-endian)
    frame.put_u32(payload.len() as u32);
    
    // Payload
    frame.extend_from_slice(payload);
    
    frame.to_vec()
}

/// Decode a message from the binary protocol format
/// Returns None if not enough data, otherwise returns (message_type, payload, bytes_consumed)
pub fn decode_message(data: &[u8]) -> Result<Option<(MessageType, Vec<u8>, usize)>> {
    // Need at least 5 bytes for header
    if data.len() < 5 {
        return Ok(None);
    }
    
    // Parse header
    let msg_type = MessageType::try_from(data[0])?;
    let length = u32::from_be_bytes([data[1], data[2], data[3], data[4]]) as usize;
    
    // Check if we have the full message
    let total_size = 5 + length;
    if data.len() < total_size {
        return Ok(None);
    }
    
    // Extract payload
    let payload = data[5..total_size].to_vec();
    
    Ok(Some((msg_type, payload, total_size)))
}