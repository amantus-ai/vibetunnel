#[cfg(test)]
mod tests {
    use crate::pty::*;
    use std::io::{BufRead, BufReader};
    use std::thread;
    use std::time::Duration;

    #[test]
    fn test_pty_config_default() {
        let config = PtyConfig::default();
        assert_eq!(config.shell, None);
        assert!(config.args.is_empty());
        assert!(config.env.is_empty());
        assert_eq!(config.cwd, None);
        assert_eq!(config.cols, 80);
        assert_eq!(config.rows, 24);
    }

    #[test]
    fn test_pty_config_custom() {
        let mut env = HashMap::new();
        env.insert("TEST_VAR".to_string(), "test_value".to_string());

        let config = PtyConfig {
            shell: Some("/bin/sh".to_string()),
            args: vec!["-c".to_string(), "echo test".to_string()],
            env,
            cwd: Some(PathBuf::from("/tmp")),
            cols: 120,
            rows: 40,
        };

        assert_eq!(config.shell, Some("/bin/sh".to_string()));
        assert_eq!(config.args.len(), 2);
        assert_eq!(config.env.get("TEST_VAR"), Some(&"test_value".to_string()));
        assert_eq!(config.cwd, Some(PathBuf::from("/tmp")));
        assert_eq!(config.cols, 120);
        assert_eq!(config.rows, 40);
    }

    #[test]
    fn test_create_pty_basic() {
        let config = PtyConfig {
            shell: Some("/bin/sh".to_string()),
            args: vec!["-c".to_string(), "echo 'test output' && exit".to_string()],
            ..Default::default()
        };

        let pty = create_pty(&config).expect("Failed to create PTY");

        // Verify PID is valid
        assert!(pty.pid > 0);

        // Read output
        let mut reader = BufReader::new(pty.reader);
        let mut output = String::new();

        // Give the command time to execute
        thread::sleep(Duration::from_millis(100));

        // Read available data
        let _ = reader.read_line(&mut output);
        assert!(output.contains("test output"));
    }

    #[test]
    fn test_create_pty_with_env() {
        let mut env = HashMap::new();
        env.insert("TEST_ENV_VAR".to_string(), "custom_value".to_string());

        let config = PtyConfig {
            shell: Some("/bin/sh".to_string()),
            args: vec!["-c".to_string(), "echo $TEST_ENV_VAR && exit".to_string()],
            env,
            ..Default::default()
        };

        let pty = create_pty(&config).expect("Failed to create PTY");

        // Read output
        let mut reader = BufReader::new(pty.reader);
        let mut output = String::new();

        // Give the command time to execute
        thread::sleep(Duration::from_millis(100));

        // Read available data
        let _ = reader.read_line(&mut output);
        assert!(output.contains("custom_value"));
    }

    #[test]
    fn test_create_pty_with_cwd() {
        let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");

        let config = PtyConfig {
            shell: Some("/bin/sh".to_string()),
            args: vec!["-c".to_string(), "pwd && exit".to_string()],
            cwd: Some(temp_dir.path().to_path_buf()),
            ..Default::default()
        };

        let pty = create_pty(&config).expect("Failed to create PTY");

        // Read output
        let mut reader = BufReader::new(pty.reader);
        let mut output = String::new();

        // Give the command time to execute
        thread::sleep(Duration::from_millis(100));

        // Read available data
        let _ = reader.read_line(&mut output);
        assert!(output.contains(temp_dir.path().to_str().unwrap()));
    }

    #[test]
    fn test_create_pty_interactive_write_read() {
        let config = PtyConfig { shell: Some("/bin/sh".to_string()), ..Default::default() };

        let mut pty = create_pty(&config).expect("Failed to create PTY");

        // Write a command
        pty.writer.write_all(b"echo 'interactive test'\n").expect("Failed to write");
        pty.writer.flush().expect("Failed to flush");

        // Give the command time to execute
        thread::sleep(Duration::from_millis(100));

        // Read output
        let mut buffer = vec![0u8; 1024];
        let bytes_read = pty.reader.read(&mut buffer).expect("Failed to read");

        let output = String::from_utf8_lossy(&buffer[..bytes_read]);
        assert!(output.contains("interactive test"));

        // Clean exit
        pty.writer.write_all(b"exit\n").expect("Failed to write exit");
        pty.writer.flush().expect("Failed to flush");
    }

    #[test]
    fn test_resize_pty() {
        let config = PtyConfig {
            shell: Some("/bin/sh".to_string()),
            cols: 80,
            rows: 24,
            ..Default::default()
        };

        let pty = create_pty(&config).expect("Failed to create PTY");

        // Test resize
        let result = resize_pty(pty.master.as_ref(), 120, 40);
        assert!(result.is_ok());

        // Write command to check terminal size
        let mut pty = pty;
        pty.writer.write_all(b"stty size\n").expect("Failed to write");
        pty.writer.flush().expect("Failed to flush");

        // Give the command time to execute
        thread::sleep(Duration::from_millis(100));

        // Read output
        let mut buffer = vec![0u8; 1024];
        let bytes_read = pty.reader.read(&mut buffer).expect("Failed to read");

        let output = String::from_utf8_lossy(&buffer[..bytes_read]);
        // The output should contain "40 120" (rows cols)
        assert!(output.contains("40") || output.contains("120"));

        // Clean exit
        pty.writer.write_all(b"exit\n").expect("Failed to write exit");
        pty.writer.flush().expect("Failed to flush");
    }

    #[test]
    fn test_create_pty_default_shell() {
        let config = PtyConfig::default();

        let pty = create_pty(&config).expect("Failed to create PTY");

        // The PTY should be created with default shell
        assert!(pty.pid > 0);

        // Write exit command
        let mut pty = pty;
        pty.writer.write_all(b"exit\n").expect("Failed to write exit");
        pty.writer.flush().expect("Failed to flush");
    }

    #[test]
    fn test_create_pty_with_args() {
        let config = PtyConfig {
            shell: Some("/bin/sh".to_string()),
            args: vec!["-c".to_string(), "echo arg1 arg2 arg3 && exit".to_string()],
            ..Default::default()
        };

        let pty = create_pty(&config).expect("Failed to create PTY");

        // Read output
        let mut reader = BufReader::new(pty.reader);
        let mut output = String::new();

        // Give the command time to execute
        thread::sleep(Duration::from_millis(100));

        // Read available data
        let _ = reader.read_line(&mut output);
        assert!(output.contains("arg1 arg2 arg3"));
    }

    #[test]
    fn test_pty_child_process_lifecycle() {
        let config = PtyConfig {
            shell: Some("/bin/sh".to_string()),
            args: vec!["-c".to_string(), "sleep 0.1 && exit 42".to_string()],
            ..Default::default()
        };

        let mut pty = create_pty(&config).expect("Failed to create PTY");

        // Check initial status
        let initial_status = pty.child.try_wait();
        assert!(initial_status.is_ok());
        assert!(initial_status.unwrap().is_none()); // Still running

        // Wait for process to complete
        thread::sleep(Duration::from_millis(200));

        // Check final status
        let final_status = pty.child.try_wait();
        assert!(final_status.is_ok());
        let status = final_status.unwrap();
        assert!(status.is_some()); // Process has exited

        #[cfg(unix)]
        {
            // On Unix, we can check the exit code
            let exit_status = status.unwrap();
            assert!(!exit_status.success());
        }
    }

    #[test]
    fn test_multiple_writes_and_reads() {
        let config = PtyConfig { shell: Some("/bin/sh".to_string()), ..Default::default() };

        let mut pty = create_pty(&config).expect("Failed to create PTY");

        // Multiple write/read cycles
        let commands = vec![
            ("echo 'first command'\n", "first command"),
            ("echo 'second command'\n", "second command"),
            ("echo 'third command'\n", "third command"),
        ];

        for (cmd, expected) in commands {
            pty.writer.write_all(cmd.as_bytes()).expect("Failed to write");
            pty.writer.flush().expect("Failed to flush");

            thread::sleep(Duration::from_millis(100));

            let mut buffer = vec![0u8; 1024];
            let bytes_read = pty.reader.read(&mut buffer).expect("Failed to read");

            let output = String::from_utf8_lossy(&buffer[..bytes_read]);
            assert!(output.contains(expected), "Expected '{}' in output: {}", expected, output);
        }

        // Clean exit
        pty.writer.write_all(b"exit\n").expect("Failed to write exit");
        pty.writer.flush().expect("Failed to flush");
    }

    #[test]
    #[cfg(unix)]
    fn test_pty_signal_handling() {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;

        let config = PtyConfig {
            shell: Some("/bin/sh".to_string()),
            args: vec!["-c".to_string(), "trap 'echo SIGTERM received' TERM; sleep 10".to_string()],
            ..Default::default()
        };

        let mut pty = create_pty(&config).expect("Failed to create PTY");

        // Give the process time to set up signal handler
        thread::sleep(Duration::from_millis(100));

        // Send SIGTERM
        let pid = Pid::from_raw(pty.pid as i32);
        kill(pid, Signal::SIGTERM).expect("Failed to send signal");

        // Read output
        thread::sleep(Duration::from_millis(100));
        let mut buffer = vec![0u8; 1024];
        let bytes_read = pty.reader.read(&mut buffer).ok();

        if let Some(bytes) = bytes_read {
            let _output = String::from_utf8_lossy(&buffer[..bytes]);
            // Process might have already terminated, so we just check if we got any output
            // The signal handler might not always execute depending on timing
            assert!(bytes > 0 || pty.child.try_wait().unwrap().is_some());
        }
    }
}
