#[cfg(test)]
mod tests {
    use crate::protocol::*;
    use proptest::prelude::*;

    #[test]
    fn test_message_type_values() {
        assert_eq!(MessageType::StdinData as u8, 0x01);
        assert_eq!(MessageType::ControlCmd as u8, 0x02);
        assert_eq!(MessageType::StatusUpdate as u8, 0x03);
        assert_eq!(MessageType::StdoutData as u8, 0x04);
        assert_eq!(MessageType::SessionInfo as u8, 0x05);
        assert_eq!(MessageType::Error as u8, 0x06);
    }

    #[test]
    fn test_message_type_try_from_valid() {
        assert_eq!(MessageType::try_from(0x01).unwrap(), MessageType::StdinData);
        assert_eq!(MessageType::try_from(0x02).unwrap(), MessageType::ControlCmd);
        assert_eq!(MessageType::try_from(0x03).unwrap(), MessageType::StatusUpdate);
        assert_eq!(MessageType::try_from(0x04).unwrap(), MessageType::StdoutData);
        assert_eq!(MessageType::try_from(0x05).unwrap(), MessageType::SessionInfo);
        assert_eq!(MessageType::try_from(0x06).unwrap(), MessageType::Error);
    }

    #[test]
    fn test_message_type_try_from_invalid() {
        assert!(MessageType::try_from(0x00).is_err());
        assert!(MessageType::try_from(0x07).is_err());
        assert!(MessageType::try_from(0xFF).is_err());
    }

    #[test]
    fn test_encode_message_empty_payload() {
        let encoded = encode_message(MessageType::StdinData, &[]);
        assert_eq!(encoded.len(), 5);
        assert_eq!(encoded[0], 0x01);
        assert_eq!(&encoded[1..5], &[0x00, 0x00, 0x00, 0x00]);
    }

    #[test]
    fn test_encode_message_with_payload() {
        let payload = b"Hello, World!";
        let encoded = encode_message(MessageType::StdoutData, payload);
        
        assert_eq!(encoded.len(), 5 + payload.len());
        assert_eq!(encoded[0], 0x04);
        
        // Check length encoding (big-endian)
        let length = u32::from_be_bytes([encoded[1], encoded[2], encoded[3], encoded[4]]);
        assert_eq!(length as usize, payload.len());
        
        // Check payload
        assert_eq!(&encoded[5..], payload);
    }

    #[test]
    fn test_encode_decode_roundtrip() {
        let test_cases = vec![
            (MessageType::StdinData, b"test input".to_vec()),
            (MessageType::StdoutData, b"test output".to_vec()),
            (MessageType::Error, b"error message".to_vec()),
            (MessageType::SessionInfo, b"{}".to_vec()),
            (MessageType::ControlCmd, b"resize".to_vec()),
            (MessageType::StatusUpdate, b"connected".to_vec()),
        ];

        for (msg_type, payload) in test_cases {
            let encoded = encode_message(msg_type, &payload);
            let decoded = decode_message(&encoded).unwrap().unwrap();
            
            assert_eq!(decoded.0, msg_type);
            assert_eq!(decoded.1, payload);
            assert_eq!(decoded.2, encoded.len());
        }
    }

    #[test]
    fn test_decode_message_insufficient_header() {
        assert!(decode_message(&[]).unwrap().is_none());
        assert!(decode_message(&[0x01]).unwrap().is_none());
        assert!(decode_message(&[0x01, 0x00]).unwrap().is_none());
        assert!(decode_message(&[0x01, 0x00, 0x00]).unwrap().is_none());
        assert!(decode_message(&[0x01, 0x00, 0x00, 0x00]).unwrap().is_none());
    }

    #[test]
    fn test_decode_message_insufficient_payload() {
        // Message claims 10 bytes payload but only has 5
        let mut data = vec![0x01, 0x00, 0x00, 0x00, 0x0A]; // type + length(10)
        data.extend_from_slice(b"12345");
        
        assert!(decode_message(&data).unwrap().is_none());
    }

    #[test]
    fn test_decode_message_exact_size() {
        let payload = b"exact";
        let encoded = encode_message(MessageType::StdoutData, payload);
        let decoded = decode_message(&encoded).unwrap().unwrap();
        
        assert_eq!(decoded.0, MessageType::StdoutData);
        assert_eq!(decoded.1, payload.to_vec());
        assert_eq!(decoded.2, encoded.len());
    }

    #[test]
    fn test_decode_message_with_extra_data() {
        let payload = b"first message";
        let mut data = encode_message(MessageType::StdoutData, payload);
        data.extend_from_slice(b"extra data");
        
        let decoded = decode_message(&data).unwrap().unwrap();
        
        assert_eq!(decoded.0, MessageType::StdoutData);
        assert_eq!(decoded.1, payload.to_vec());
        assert_eq!(decoded.2, 5 + payload.len());
    }

    #[test]
    fn test_decode_invalid_message_type() {
        let data = vec![0xFF, 0x00, 0x00, 0x00, 0x00]; // Invalid type
        assert!(decode_message(&data).is_err());
    }

    #[test]
    fn test_large_payload() {
        let large_payload = vec![0xAB; 65536]; // 64KB
        let encoded = encode_message(MessageType::StdoutData, &large_payload);
        
        assert_eq!(encoded.len(), 5 + large_payload.len());
        
        let decoded = decode_message(&encoded).unwrap().unwrap();
        assert_eq!(decoded.0, MessageType::StdoutData);
        assert_eq!(decoded.1, large_payload);
    }

    #[test]
    fn test_zero_length_payload() {
        let encoded = vec![0x01, 0x00, 0x00, 0x00, 0x00]; // StdinData with 0 length
        let decoded = decode_message(&encoded).unwrap().unwrap();
        
        assert_eq!(decoded.0, MessageType::StdinData);
        assert_eq!(decoded.1, Vec::<u8>::new());
        assert_eq!(decoded.2, 5);
    }

    // Property-based tests
    proptest! {
        #[test]
        fn prop_encode_decode_roundtrip(
            msg_type in 1u8..=6u8,
            payload in prop::collection::vec(any::<u8>(), 0..1000)
        ) {
            let msg_type = MessageType::try_from(msg_type).unwrap();
            let encoded = encode_message(msg_type, &payload);
            let decoded = decode_message(&encoded).unwrap().unwrap();
            
            prop_assert_eq!(decoded.0, msg_type);
            prop_assert_eq!(decoded.1, payload);
            prop_assert_eq!(decoded.2, encoded.len());
        }

        #[test]
        fn prop_encode_length_correct(
            msg_type in 1u8..=6u8,
            payload in prop::collection::vec(any::<u8>(), 0..1000)
        ) {
            let msg_type = MessageType::try_from(msg_type).unwrap();
            let encoded = encode_message(msg_type, &payload);
            
            prop_assert_eq!(encoded.len(), 5 + payload.len());
            prop_assert_eq!(encoded[0], msg_type as u8);
            
            let length = u32::from_be_bytes([encoded[1], encoded[2], encoded[3], encoded[4]]);
            prop_assert_eq!(length as usize, payload.len());
        }

        #[test]
        fn prop_decode_partial_messages(
            msg_type in 1u8..=6u8,
            payload in prop::collection::vec(any::<u8>(), 0..100),
            truncate_at in 0..105usize
        ) {
            let msg_type = MessageType::try_from(msg_type).unwrap();
            let encoded = encode_message(msg_type, &payload);
            let truncated = &encoded[..truncate_at.min(encoded.len())];
            
            let result = decode_message(truncated).unwrap();
            
            if truncate_at < encoded.len() {
                prop_assert!(result.is_none());
            } else {
                let decoded = result.unwrap();
                prop_assert_eq!(decoded.0, msg_type);
                prop_assert_eq!(decoded.1, payload);
            }
        }
    }

    #[test]
    fn test_multiple_messages_in_buffer() {
        let msg1 = encode_message(MessageType::StdinData, b"first");
        let msg2 = encode_message(MessageType::StdoutData, b"second");
        let msg3 = encode_message(MessageType::Error, b"third");
        
        let mut buffer = Vec::new();
        buffer.extend_from_slice(&msg1);
        buffer.extend_from_slice(&msg2);
        buffer.extend_from_slice(&msg3);
        
        // Decode first message
        let (type1, payload1, consumed1) = decode_message(&buffer).unwrap().unwrap();
        assert_eq!(type1, MessageType::StdinData);
        assert_eq!(payload1, b"first");
        assert_eq!(consumed1, msg1.len());
        
        // Decode second message
        let (type2, payload2, consumed2) = decode_message(&buffer[consumed1..]).unwrap().unwrap();
        assert_eq!(type2, MessageType::StdoutData);
        assert_eq!(payload2, b"second");
        assert_eq!(consumed2, msg2.len());
        
        // Decode third message
        let (type3, payload3, consumed3) = decode_message(&buffer[consumed1 + consumed2..]).unwrap().unwrap();
        assert_eq!(type3, MessageType::Error);
        assert_eq!(payload3, b"third");
        assert_eq!(consumed3, msg3.len());
    }
}