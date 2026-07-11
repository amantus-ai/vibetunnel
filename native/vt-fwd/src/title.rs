const DOT_SEPARATOR: &str = " \u{00b7} ";

pub fn abbreviate_path(full_path: &str, home: &str) -> String {
    let mut path = if !home.is_empty() && full_path.starts_with(home) {
        format!("~{}", &full_path[home.len()..])
    } else {
        full_path.to_owned()
    };

    path = path.replace("/Development/", "/Dev/");
    path = path.replace("/Documents/", "/Docs/");
    path = path.replace("/Applications/", "/Apps/");

    let parts: Vec<_> = path.split('/').filter(|part| !part.is_empty()).collect();
    if parts.len() > 3 {
        format!(".../{}/{}", parts[parts.len() - 2], parts[parts.len() - 1])
    } else {
        path
    }
}

pub fn generate_session_name(command: &[String], working_dir: &str, home: &str) -> String {
    let cmd = command.first().map_or("shell", String::as_str);
    let cmd_name = basename(cmd);
    let abbreviated = abbreviate_path(working_dir, home);

    if abbreviated.is_empty() {
        cmd_name.to_owned()
    } else {
        format!("{cmd_name} ({abbreviated})")
    }
}

pub fn generate_title_sequence(
    cwd: &str,
    command: &[String],
    session_name: Option<&str>,
    home: &str,
) -> String {
    let cmd = command.first().map_or("shell", String::as_str);
    let cmd_name = basename(cmd);
    let display_path = if !home.is_empty() && cwd.starts_with(home) {
        format!("~{}", &cwd[home.len()..])
    } else {
        cwd.to_owned()
    };

    if let Some(raw_name) = session_name {
        let name = trim_ascii_whitespace(raw_name);
        if !name.is_empty() && !is_auto_generated_name(name, cmd_name) {
            return format!("\x1b]2;{name}\x07");
        }
    }

    let mut parts = vec![display_path.as_str(), cmd_name];
    if let Some(raw_name) = session_name {
        let name = trim_ascii_whitespace(raw_name);
        if !name.is_empty() && !is_redundant_name(name, cmd_name) {
            parts.push(name);
        }
    }

    format!("\x1b]2;{}\x07", parts.join(DOT_SEPARATOR))
}

/// Remove control characters and malformed UTF-8, retaining at most 256
/// accepted Unicode scalar values.
pub fn sanitize_title(title: &[u8]) -> String {
    let mut sanitized = String::new();
    let mut index = 0;
    let mut count = 0;

    while index < title.len() && count < 256 {
        let Some(sequence_len) = utf8_sequence_len(title[index]) else {
            index += 1;
            continue;
        };
        let end = index + sequence_len;
        if end > title.len() {
            break;
        }

        let slice = &title[index..end];
        let Ok(text) = std::str::from_utf8(slice) else {
            index += 1;
            continue;
        };
        let Some(character) = text.chars().next() else {
            index += 1;
            continue;
        };
        index = end;

        let codepoint = character as u32;
        if codepoint >= 32 && codepoint != 127 && !(128..=159).contains(&codepoint) {
            sanitized.push(character);
            count += 1;
        }
    }

    sanitized
}

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn trim_ascii_whitespace(value: &str) -> &str {
    value.trim_matches([' ', '\t', '\r', '\n'])
}

fn is_auto_generated_name(name: &str, cmd_name: &str) -> bool {
    is_redundant_name(name, cmd_name)
}

fn is_redundant_name(name: &str, cmd_name: &str) -> bool {
    if name == cmd_name || name == format!("{cmd_name}{DOT_SEPARATOR}{cmd_name}") {
        return true;
    }

    name.strip_prefix(cmd_name)
        .is_some_and(|suffix| suffix.starts_with(" (") && suffix.ends_with(')'))
}

fn utf8_sequence_len(first: u8) -> Option<usize> {
    match first {
        0b0000_0000..=0b0111_1111 => Some(1),
        0b1100_0000..=0b1101_1111 => Some(2),
        0b1110_0000..=0b1110_1111 => Some(3),
        0b1111_0000..=0b1111_0111 => Some(4),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn abbreviate_path_collapses_long_paths() {
        assert_eq!(
            abbreviate_path("/Users/peter/Development/foo/bar", "/Users/peter"),
            ".../foo/bar"
        );
    }

    #[test]
    fn abbreviate_path_rewrites_common_directory_names() {
        assert_eq!(
            abbreviate_path("/Users/peter/Documents/foo", "/Users/peter"),
            "~/Docs/foo"
        );
        assert_eq!(
            abbreviate_path("/Applications/VibeTunnel", ""),
            "/Apps/VibeTunnel"
        );
    }

    #[test]
    fn generate_session_name_falls_back_to_command() {
        assert_eq!(generate_session_name(&args(&["bash"]), "", ""), "bash");
        assert_eq!(
            generate_session_name(&[], "/Users/peter", "/Users/peter"),
            "shell (~)"
        );
    }

    #[test]
    fn generate_title_sequence_uses_explicit_session_name() {
        assert_eq!(
            generate_title_sequence(
                "/Users/peter",
                &args(&["/bin/zsh"]),
                Some("My Session"),
                "/Users/peter"
            ),
            "\x1b]2;My Session\x07"
        );
    }

    #[test]
    fn generate_title_sequence_expands_auto_generated_name() {
        assert_eq!(
            generate_title_sequence(
                "/Users/peter/Code",
                &args(&["/bin/zsh"]),
                Some("zsh (~/Code)"),
                "/Users/peter"
            ),
            "\x1b]2;~/Code \u{00b7} zsh\x07"
        );
    }

    #[test]
    fn sanitize_title_strips_control_chars_and_limits_length() {
        assert_eq!(sanitize_title(b"hi\nthere\x1b["), "hithere[");
        assert_eq!(sanitize_title(&vec![b'a'; 300]), "a".repeat(256));
    }

    #[test]
    fn sanitize_title_limits_unicode_scalars_not_bytes() {
        let title = "\u{00a3}".repeat(300);
        let sanitized = sanitize_title(title.as_bytes());
        assert_eq!(sanitized.chars().count(), 256);
        assert_eq!(sanitized.len(), 512);
    }

    #[test]
    fn sanitize_title_drops_malformed_bytes_without_losing_valid_text() {
        assert_eq!(
            sanitize_title(&[b'A', 0xff, b'B', 0xc2, 0xa3]),
            "AB\u{00a3}"
        );
    }

    #[test]
    fn sanitize_title_stops_at_incomplete_multibyte_tail() {
        assert_eq!(sanitize_title(&[b'A', 0xe2, b'B']), "A");
    }
}
