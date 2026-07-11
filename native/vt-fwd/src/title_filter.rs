#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum State {
    Normal,
    Esc,
    OscType,
    OscAfterType,
    OscBody,
    OscEscape,
}

pub struct TitleFilter {
    state: State,
    pending: [u8; 4],
    pending_len: usize,
}

impl TitleFilter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn filter(&mut self, input: &[u8], output: &mut Vec<u8>) {
        for &byte in input {
            match self.state {
                State::Normal => {
                    if byte == 0x1b {
                        self.pending_len = 0;
                        self.push_pending(byte);
                        self.state = State::Esc;
                    } else {
                        output.push(byte);
                    }
                }
                State::Esc => {
                    if byte == b']' {
                        self.push_pending(byte);
                        self.state = State::OscType;
                    } else {
                        self.flush_pending(output);
                        output.push(byte);
                        self.state = State::Normal;
                    }
                }
                State::OscType => {
                    if matches!(byte, b'0' | b'1' | b'2') {
                        self.push_pending(byte);
                        self.state = State::OscAfterType;
                    } else {
                        self.flush_pending(output);
                        output.push(byte);
                        self.state = State::Normal;
                    }
                }
                State::OscAfterType => {
                    if byte == b';' {
                        self.pending_len = 0;
                        self.state = State::OscBody;
                    } else {
                        self.flush_pending(output);
                        output.push(byte);
                        self.state = State::Normal;
                    }
                }
                State::OscBody => {
                    if byte == 0x07 {
                        self.state = State::Normal;
                    } else if byte == 0x1b {
                        self.state = State::OscEscape;
                    }
                }
                State::OscEscape => {
                    if byte == b'\\' {
                        self.state = State::Normal;
                    } else if byte != 0x1b {
                        self.state = State::OscBody;
                    }
                }
            }
        }
    }

    fn push_pending(&mut self, byte: u8) {
        self.pending[self.pending_len] = byte;
        self.pending_len += 1;
    }

    fn flush_pending(&mut self, output: &mut Vec<u8>) {
        output.extend_from_slice(&self.pending[..self.pending_len]);
        self.pending_len = 0;
    }
}

impl Default for TitleFilter {
    fn default() -> Self {
        Self {
            state: State::Normal,
            pending: [0; 4],
            pending_len: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_osc_title_sequence() {
        let mut filter = TitleFilter::new();
        let mut output = Vec::new();

        filter.filter(b"hello\x1b]0;my title\x07world", &mut output);

        assert_eq!(output, b"helloworld");
    }

    #[test]
    fn filters_sequences_across_chunks() {
        let mut filter = TitleFilter::new();
        let mut output = Vec::new();

        filter.filter(b"start\x1b]2;chunk", &mut output);
        filter.filter(b"ed\x07end", &mut output);

        assert_eq!(output, b"startend");
    }

    #[test]
    fn filters_sequence_introducer_split_across_chunks() {
        let mut filter = TitleFilter::new();
        let mut output = Vec::new();

        for chunk in [
            b"before\x1b".as_slice(),
            b"]".as_slice(),
            b"1".as_slice(),
            b";title\x1b".as_slice(),
            b"\\after".as_slice(),
        ] {
            filter.filter(chunk, &mut output);
        }

        assert_eq!(output, b"beforeafter");
    }

    #[test]
    fn preserves_non_title_escape_sequences() {
        let mut filter = TitleFilter::new();
        let mut output = Vec::new();

        filter.filter(b"a\x1b[31mb\x1b]3;not-a-title", &mut output);

        assert_eq!(output, b"a\x1b[31mb\x1b]3;not-a-title");
    }

    #[test]
    fn filters_all_supported_osc_title_types_and_terminators() {
        let mut filter = TitleFilter::new();
        let mut output = Vec::new();

        filter.filter(
            b"a\x1b]0;both\x07b\x1b]1;icon\x1b\\c\x1b]2;window\x07d",
            &mut output,
        );

        assert_eq!(output, b"abcd");
    }
}
