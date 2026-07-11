use std::fs;
use std::io::{self, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde_json::Value;

pub const MAX_PAYLOAD_LEN: usize = 1024 * 1024;
const WORKER_STACK_BYTES: usize = 2 * 1024 * 1024;

const HEADER_LEN: usize = 5;
const READ_BUFFER_LEN: usize = 4096;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum MessageType {
    StdinData = 0x01,
    ControlCmd = 0x02,
    StatusUpdate = 0x03,
    Heartbeat = 0x04,
    Error = 0x05,
}

impl TryFrom<u8> for MessageType {
    type Error = ();

    fn try_from(value: u8) -> Result<Self, ()> {
        match value {
            0x01 => Ok(Self::StdinData),
            0x02 => Ok(Self::ControlCmd),
            0x03 => Ok(Self::StatusUpdate),
            0x04 => Ok(Self::Heartbeat),
            0x05 => Ok(Self::Error),
            _ => Err(()),
        }
    }
}

/// Receives validated messages on the control-socket worker thread.
///
/// Implementations that share state with the forwarder's main loop should use
/// their own synchronization. Callback slices are only valid for the duration
/// of the call.
pub trait Handler: Send + Sync + 'static {
    fn on_stdin(&self, data: &[u8]);
    fn on_resize(&self, cols: u16, rows: u16);
    fn on_reset_size(&self);
    fn on_kill(&self, signal: Option<i32>);
    fn on_update_title(&self, title: &str);
}

struct Shared {
    running: AtomicBool,
    active_client: Mutex<Option<UnixStream>>,
}

impl Shared {
    fn active_client(&self) -> MutexGuard<'_, Option<UnixStream>> {
        self.active_client
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// A running, single-client-at-a-time Unix control-socket server.
pub struct Server {
    socket_path: PathBuf,
    shared: Arc<Shared>,
    worker: Option<JoinHandle<io::Result<()>>>,
}

impl Server {
    /// Removes a stale socket, binds a new mode-0600 socket, and starts serving.
    pub fn start(socket_path: impl AsRef<Path>, handler: Arc<dyn Handler>) -> io::Result<Self> {
        let socket_path = socket_path.as_ref().to_path_buf();
        let _ = fs::remove_file(&socket_path);

        let listener = UnixListener::bind(&socket_path)?;
        if let Err(error) = fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600)) {
            let _ = fs::remove_file(&socket_path);
            return Err(error);
        }
        if let Err(error) = listener.set_nonblocking(true) {
            let _ = fs::remove_file(&socket_path);
            return Err(error);
        }

        let shared = Arc::new(Shared {
            running: AtomicBool::new(true),
            active_client: Mutex::new(None),
        });
        let worker_shared = Arc::clone(&shared);
        let worker = match thread::Builder::new()
            .name("vt-fwd-control".to_owned())
            .stack_size(WORKER_STACK_BYTES)
            .spawn(move || run_listener(listener, worker_shared, handler))
        {
            Ok(worker) => worker,
            Err(error) => {
                let _ = fs::remove_file(&socket_path);
                return Err(error);
            }
        };

        Ok(Self {
            socket_path,
            shared,
            worker: Some(worker),
        })
    }

    /// Requests shutdown. Safe to call more than once or from a callback.
    pub fn stop(&self) {
        let was_running = self.shared.running.swap(false, Ordering::AcqRel);
        if let Some(client) = self.shared.active_client().as_ref() {
            let _ = client.shutdown(std::net::Shutdown::Both);
        }
        if let Some(worker) = &self.worker {
            worker.thread().unpark();
        }
        if was_running {
            let _ = fs::remove_file(&self.socket_path);
        }
    }

    /// Stops the server and waits for its worker. Repeated calls are harmless.
    pub fn join(&mut self) -> io::Result<()> {
        let Some(worker) = self.worker.as_ref() else {
            return Ok(());
        };
        if worker.thread().id() == thread::current().id() {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "control socket worker cannot join itself",
            ));
        }

        self.stop();
        match self.worker.take().expect("worker checked above").join() {
            Ok(result) => result,
            Err(_) => Err(io::Error::other("control socket worker panicked")),
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop();
        let _ = self.join();
    }
}

fn run_listener(
    listener: UnixListener,
    shared: Arc<Shared>,
    handler: Arc<dyn Handler>,
) -> io::Result<()> {
    while shared.running.load(Ordering::Acquire) {
        let client = match listener.accept() {
            Ok((client, _)) => client,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::park_timeout(Duration::from_millis(25));
                continue;
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) if !shared.running.load(Ordering::Acquire) => break,
            Err(error) => return Err(error),
        };
        // Darwin inherits O_NONBLOCK from the listener. Client reads must stay
        // blocking so a temporarily empty stream is not mistaken for EOF.
        if client.set_nonblocking(false).is_err() {
            continue;
        }

        let Ok(stop_handle) = client.try_clone() else {
            continue;
        };
        *shared.active_client() = Some(stop_handle);
        handle_client(client, &shared, handler.as_ref());
        shared.active_client().take();
    }

    Ok(())
}

fn handle_client(mut client: UnixStream, shared: &Shared, handler: &dyn Handler) {
    let mut buffer = Vec::new();
    let mut read_buffer = [0_u8; READ_BUFFER_LEN];

    while shared.running.load(Ordering::Acquire) {
        let read_len = match client.read(&mut read_buffer) {
            Ok(0) => break,
            Ok(read_len) => read_len,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        };
        buffer.extend_from_slice(&read_buffer[..read_len]);

        loop {
            if buffer.len() < HEADER_LEN {
                break;
            }

            let payload_len =
                u32::from_be_bytes([buffer[1], buffer[2], buffer[3], buffer[4]]) as usize;
            if payload_len > MAX_PAYLOAD_LEN {
                return;
            }
            let frame_len = HEADER_LEN + payload_len;
            if buffer.len() < frame_len {
                break;
            }

            if let Ok(message_type) = MessageType::try_from(buffer[0]) {
                dispatch_message(
                    &mut client,
                    handler,
                    message_type,
                    &buffer[HEADER_LEN..frame_len],
                );
            }
            buffer.drain(..frame_len);
        }
    }
}

fn dispatch_message(
    client: &mut UnixStream,
    handler: &dyn Handler,
    message_type: MessageType,
    payload: &[u8],
) {
    match message_type {
        MessageType::StdinData => handler.on_stdin(payload),
        MessageType::ControlCmd => handle_control(handler, payload),
        MessageType::Heartbeat => {
            let frame = [MessageType::Heartbeat as u8, 0, 0, 0, 0];
            let _ = client.write_all(&frame);
        }
        MessageType::StatusUpdate | MessageType::Error => {}
    }
}

fn handle_control(handler: &dyn Handler, payload: &[u8]) {
    let Ok(Value::Object(object)) = serde_json::from_slice::<Value>(payload) else {
        return;
    };
    let Some(command) = object.get("cmd").and_then(Value::as_str) else {
        return;
    };

    match command {
        "resize" => {
            let Some(cols) = parse_dimension(object.get("cols")) else {
                return;
            };
            let Some(rows) = parse_dimension(object.get("rows")) else {
                return;
            };
            handler.on_resize(cols, rows);
        }
        "reset-size" => handler.on_reset_size(),
        "kill" => {
            let signal = match object.get("signal") {
                Some(value) => {
                    let Some(signal) = parse_signal(Some(value)) else {
                        return;
                    };
                    Some(signal)
                }
                None => None,
            };
            handler.on_kill(signal);
        }
        "update-title" => {
            let Some(title) = object.get("title").and_then(Value::as_str) else {
                return;
            };
            handler.on_update_title(title);
        }
        _ => {}
    }
}

fn parse_dimension(value: Option<&Value>) -> Option<u16> {
    let value = value?.as_u64()?;
    if value == 0 || value > u16::MAX.into() {
        return None;
    }
    Some(value as u16)
}

fn parse_signal(value: Option<&Value>) -> Option<i32> {
    match value? {
        Value::Number(number) => {
            let signal = number.as_u64()?;
            if !(1..=64).contains(&signal) {
                return None;
            }
            Some(signal as i32)
        }
        Value::String(name) if name.eq_ignore_ascii_case("SIGTERM") => Some(nix::libc::SIGTERM),
        Value::String(name) if name.eq_ignore_ascii_case("SIGKILL") => Some(nix::libc::SIGKILL),
        Value::String(name) if name.eq_ignore_ascii_case("SIGINT") => Some(nix::libc::SIGINT),
        Value::String(name) if name.eq_ignore_ascii_case("SIGHUP") => Some(nix::libc::SIGHUP),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::FileTypeExt;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Barrier, Condvar};
    use std::time::Duration;

    static NEXT_SOCKET: AtomicU64 = AtomicU64::new(0);

    #[derive(Debug, Eq, PartialEq)]
    enum Event {
        Stdin(Vec<u8>),
        Resize(u16, u16),
        ResetSize,
        Kill(Option<i32>),
        Title(String),
    }

    #[derive(Default)]
    struct TestHandler {
        events: Mutex<Vec<Event>>,
    }

    impl Handler for TestHandler {
        fn on_stdin(&self, data: &[u8]) {
            self.events
                .lock()
                .unwrap()
                .push(Event::Stdin(data.to_vec()));
        }

        fn on_resize(&self, cols: u16, rows: u16) {
            self.events.lock().unwrap().push(Event::Resize(cols, rows));
        }

        fn on_reset_size(&self) {
            self.events.lock().unwrap().push(Event::ResetSize);
        }

        fn on_kill(&self, signal: Option<i32>) {
            self.events.lock().unwrap().push(Event::Kill(signal));
        }

        fn on_update_title(&self, title: &str) {
            self.events
                .lock()
                .unwrap()
                .push(Event::Title(title.to_owned()));
        }
    }

    struct BlockingHandler {
        entered: Barrier,
        released: (Mutex<bool>, Condvar),
    }

    impl Handler for BlockingHandler {
        fn on_stdin(&self, _data: &[u8]) {
            self.entered.wait();
            let (released, wake) = &self.released;
            let guard = released.lock().unwrap();
            drop(wake.wait_while(guard, |released| !*released).unwrap());
        }

        fn on_resize(&self, _cols: u16, _rows: u16) {}
        fn on_reset_size(&self) {}
        fn on_kill(&self, _signal: Option<i32>) {}
        fn on_update_title(&self, _title: &str) {}
    }

    fn socket_path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "vt-fwd-{}-{}.sock",
            std::process::id(),
            NEXT_SOCKET.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn frame(message_type: u8, payload: &[u8]) -> Vec<u8> {
        let mut frame = Vec::with_capacity(HEADER_LEN + payload.len());
        frame.push(message_type);
        frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        frame.extend_from_slice(payload);
        frame
    }

    #[test]
    fn message_type_rejects_unknown_values() {
        assert_eq!(MessageType::try_from(0xff), Err(()));
        assert_eq!(MessageType::try_from(0x01), Ok(MessageType::StdinData));
    }

    #[test]
    fn resize_dimensions_require_positive_u16_integers() {
        assert_eq!(parse_dimension(Some(&Value::from(80))), Some(80));
        assert_eq!(parse_dimension(Some(&Value::from(0))), None);
        assert_eq!(parse_dimension(Some(&Value::from(-1))), None);
        assert_eq!(parse_dimension(Some(&Value::from(65_536))), None);
        assert_eq!(parse_dimension(Some(&Value::from(80.5))), None);
    }

    #[test]
    fn signals_reject_malformed_and_out_of_range_values() {
        assert_eq!(
            parse_signal(Some(&Value::from("SIGTERM"))),
            Some(nix::libc::SIGTERM)
        );
        assert_eq!(parse_signal(Some(&Value::from("NOPE"))), None);
        assert_eq!(parse_signal(Some(&Value::from(0))), None);
        assert_eq!(parse_signal(Some(&Value::from(65))), None);
    }

    #[test]
    fn socket_protocol_handles_fragmented_and_coalesced_frames() {
        let path = socket_path();
        let handler = Arc::new(TestHandler::default());
        let mut server = Server::start(&path, handler.clone()).unwrap();

        let metadata = fs::metadata(&path).unwrap();
        assert!(metadata.file_type().is_socket());
        assert_eq!(metadata.permissions().mode() & 0o777, 0o600);

        let mut client = UnixStream::connect(&path).unwrap();
        let heartbeat = frame(MessageType::Heartbeat as u8, b"");
        client.write_all(&heartbeat[..3]).unwrap();
        client.write_all(&heartbeat[3..]).unwrap();
        let mut reply = [0_u8; HEADER_LEN];
        client.read_exact(&mut reply).unwrap();
        assert_eq!(reply, [MessageType::Heartbeat as u8, 0, 0, 0, 0]);

        let mut frames = frame(
            MessageType::ControlCmd as u8,
            br#"{"cmd":"resize","cols":100,"rows":40}"#,
        );
        frames.extend(frame(0xff, b"ignored"));
        frames.extend(frame(MessageType::StdinData as u8, b"hello\n"));
        frames.extend(frame(
            MessageType::ControlCmd as u8,
            br#"{"cmd":"update-title","title":"new title"}"#,
        ));
        frames.extend(heartbeat);
        client.write_all(&frames).unwrap();
        client.read_exact(&mut reply).unwrap();

        assert_eq!(
            *handler.events.lock().unwrap(),
            vec![
                Event::Resize(100, 40),
                Event::Stdin(b"hello\n".to_vec()),
                Event::Title("new title".to_owned()),
            ]
        );

        server.stop();
        server.join().unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn oversized_client_is_closed_without_stopping_server() {
        let path = socket_path();
        let handler = Arc::new(TestHandler::default());
        let mut server = Server::start(&path, handler).unwrap();

        let mut oversized = UnixStream::connect(&path).unwrap();
        oversized
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        oversized
            .write_all(&[MessageType::StdinData as u8, 0, 0x10, 0, 1])
            .unwrap();
        let mut byte = [0_u8; 1];
        assert_eq!(oversized.read(&mut byte).unwrap(), 0);

        let mut replacement = UnixStream::connect(&path).unwrap();
        replacement
            .write_all(&frame(MessageType::Heartbeat as u8, b"payload ignored"))
            .unwrap();
        let mut reply = [0_u8; HEADER_LEN];
        replacement.read_exact(&mut reply).unwrap();
        assert_eq!(reply, [MessageType::Heartbeat as u8, 0, 0, 0, 0]);

        server.join().unwrap();
    }

    #[test]
    fn stopped_server_cannot_unlink_a_replacement_socket() {
        let path = socket_path();
        let blocking = Arc::new(BlockingHandler {
            entered: Barrier::new(2),
            released: (Mutex::new(false), Condvar::new()),
        });
        let mut first = Server::start(&path, blocking.clone()).unwrap();

        let mut client = UnixStream::connect(&path).unwrap();
        client
            .write_all(&frame(MessageType::StdinData as u8, b"block"))
            .unwrap();
        blocking.entered.wait();
        first.stop();

        let mut replacement = Server::start(&path, Arc::new(TestHandler::default())).unwrap();
        assert!(path.exists());

        let (released, wake) = &blocking.released;
        *released.lock().unwrap() = true;
        wake.notify_all();
        first.join().unwrap();
        drop(first);

        assert!(path.exists());
        let mut replacement_client = UnixStream::connect(&path).unwrap();
        replacement_client
            .write_all(&frame(MessageType::Heartbeat as u8, b""))
            .unwrap();
        let mut reply = [0_u8; HEADER_LEN];
        replacement_client.read_exact(&mut reply).unwrap();
        assert_eq!(reply, [MessageType::Heartbeat as u8, 0, 0, 0, 0]);

        replacement.join().unwrap();
    }
}
