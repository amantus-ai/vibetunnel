use std::ops::Deref;
use std::ops::DerefMut;

use bytes::BytesMut;
pub use http::*;
use io::Read;
use io::Write;
use std::io;
use std::net::SocketAddr;
use std::net::TcpListener;
use std::net::TcpStream;
use std::net::ToSocketAddrs;

const MAX_REQUEST_SIZE: usize = 1024 * 1024; // 1MB

#[derive(Debug)]
pub struct HttpServer {
    listener: TcpListener,
}

impl HttpServer {
    pub fn bind<A: ToSocketAddrs>(
        addr: A,
    ) -> std::result::Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let listener = TcpListener::bind(addr)?;
        Ok(Self { listener })
    }

    pub const fn incoming(&self) -> Incoming {
        Incoming {
            listener: &self.listener,
        }
    }
}

#[derive(Debug)]
pub struct Incoming<'a> {
    listener: &'a TcpListener,
}

impl Iterator for Incoming<'_> {
    type Item = std::result::Result<HttpRequest, Box<dyn std::error::Error + Send + Sync>>;

    fn next(&mut self) -> Option<Self::Item> {
        match self.listener.accept() {
            Ok((stream, remote_addr)) => Some(HttpRequest::from_stream(stream, remote_addr)),
            Err(e) => Some(Err(Box::new(e))),
        }
    }
}

#[derive(Debug)]
pub struct HttpRequest {
    stream: TcpStream,
    #[allow(unused)]
    remote_addr: SocketAddr,
    request: Request<Vec<u8>>,
}

impl HttpRequest {
    fn from_stream(
        mut stream: TcpStream,
        remote_addr: SocketAddr,
    ) -> std::result::Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let mut buffer = BytesMut::new();
        let mut tmp = [0; 1024];

        loop {
            match stream.read(&mut tmp) {
                Ok(0) => {
                    return Err("Connection closed by client".into());
                }
                Ok(n) => {
                    buffer.extend_from_slice(&tmp[..n]);

                    if buffer.len() > MAX_REQUEST_SIZE {
                        return Err("Request too large".into());
                    }

                    if let Some(header_end) = find_header_end(&buffer) {
                        let header_bytes = &buffer[..header_end];
                        let body_start = header_end + 4; // Skip \r\n\r\n

                        let request_line_end = header_bytes
                            .windows(2)
                            .position(|w| w == b"\r\n")
                            .ok_or("Invalid request line")?;

                        let request_line = std::str::from_utf8(&header_bytes[..request_line_end])?;
                        let mut parts = request_line.split_whitespace();
                        let method = parts.next().ok_or("Missing method")?;
                        let uri = parts.next().ok_or("Missing URI")?;
                        let version = parts.next().unwrap_or("HTTP/1.1");

                        let method = method.parse::<Method>()?;
                        let uri = uri.parse::<Uri>()?;
                        let version = match version {
                            "HTTP/1.0" => Version::HTTP_10,
                            "HTTP/1.1" => Version::HTTP_11,
                            _ => return Err("Unsupported HTTP version".into()),
                        };

                        let mut request_builder =
                            Request::builder().method(method).uri(uri).version(version);

                        let headers_start = request_line_end + 2;
                        let headers_bytes = &header_bytes[headers_start..];

                        for header_line in headers_bytes.split(|&b| b == b'\n') {
                            if header_line.is_empty() || header_line == b"\r" {
                                continue;
                            }

                            let header_line = if header_line.ends_with(b"\r") {
                                &header_line[..header_line.len() - 1]
                            } else {
                                header_line
                            };

                            if let Some(colon_pos) = header_line.iter().position(|&b| b == b':') {
                                let name = std::str::from_utf8(&header_line[..colon_pos])?.trim();
                                let value =
                                    std::str::from_utf8(&header_line[colon_pos + 1..])?.trim();
                                request_builder = request_builder.header(name, value);
                            }
                        }

                        let content_length = request_builder
                            .headers_ref()
                            .and_then(|h| h.get("content-length"))
                            .and_then(|v| v.to_str().ok())
                            .and_then(|s| s.parse::<usize>().ok());

                        let mut body = Vec::new();
                        if let Some(content_length) = content_length {
                            if content_length > 0 {
                                let mut bytes_read = 0;
                                if body_start < buffer.len() {
                                    let available =
                                        std::cmp::min(content_length, buffer.len() - body_start);
                                    body.extend_from_slice(
                                        &buffer[body_start..body_start + available],
                                    );
                                    bytes_read = available;
                                }

                                while bytes_read < content_length {
                                    let remaining = content_length - bytes_read;
                                    let to_read = std::cmp::min(remaining, tmp.len());
                                    match stream.read(&mut tmp[..to_read]) {
                                        Ok(0) => break,
                                        Ok(n) => {
                                            body.extend_from_slice(&tmp[..n]);
                                            bytes_read += n;
                                        }
                                        Err(e) => return Err(Box::new(e)),
                                    }
                                }
                            }
                        }

                        let request = request_builder.body(body)?;

                        return Ok(Self {
                            stream,
                            remote_addr,
                            request,
                        });
                    }
                }
                Err(e) => return Err(Box::new(e)),
            }
        }
    }

    fn response_to_bytes<T>(&self, response: Response<T>) -> Vec<u8>
    where
        T: AsRef<[u8]>,
    {
        let (parts, body) = response.into_parts();
        let status_line = format!(
            "HTTP/1.1 {} {}\r\n",
            parts.status.as_u16(),
            parts.status.canonical_reason().unwrap_or("")
        );
        let mut headers = String::new();
        for (name, value) in &parts.headers {
            use std::fmt::Write;
            let _ = write!(
                headers,
                "{}: {}\r\n",
                name.as_str(),
                value.to_str().unwrap_or("")
            );
        }
        let header_bytes = format!("{status_line}{headers}\r\n").into_bytes();
        let mut result = header_bytes;
        result.extend_from_slice(body.as_ref());
        result
    }

    pub fn respond<T>(
        &mut self,
        response: Response<T>,
    ) -> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>>
    where
        T: AsRef<[u8]>,
    {
        let response_bytes = self.response_to_bytes(response);
        self.stream.write_all(&response_bytes)?;
        self.stream.flush()?;
        Ok(())
    }

    pub fn respond_raw<T: AsRef<[u8]>>(
        &mut self,
        data: T,
    ) -> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.stream.write_all(data.as_ref())?;
        self.stream.flush()?;
        Ok(())
    }
}

impl Deref for HttpRequest {
    type Target = Request<Vec<u8>>;

    fn deref(&self) -> &Self::Target {
        &self.request
    }
}

impl DerefMut for HttpRequest {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.request
    }
}

pub struct SseResponseHelper<'a> {
    request: &'a mut HttpRequest,
}

impl<'a> SseResponseHelper<'a> {
    pub fn new(
        request: &'a mut HttpRequest,
    ) -> std::result::Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let response = Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .header("Connection", "keep-alive")
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::new())
            .unwrap();

        request.respond(response)?;

        Ok(Self { request })
    }

    pub fn write_event(
        &mut self,
        event: &str,
    ) -> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let sse_data = format!("data: {event}\n\n");
        self.request.respond_raw(sse_data.as_bytes())
    }
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|w| w == b"\r\n\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read};
    use std::thread;
    use std::time::Duration;

    #[test]
    fn test_find_header_end() {
        assert_eq!(find_header_end(b"\r\n\r\n"), Some(0));
        assert_eq!(find_header_end(b"test\r\n\r\n"), Some(4));
        assert_eq!(find_header_end(b"header: value\r\n\r\nbody"), Some(13));
        assert_eq!(find_header_end(b"incomplete\r\n"), None);
        assert_eq!(find_header_end(b""), None);
    }

    #[test]
    fn test_http_server_bind() {
        // Bind to a random port
        let server = HttpServer::bind("127.0.0.1:0").unwrap();
        let addr = server.listener.local_addr().unwrap();
        assert_eq!(addr.ip().to_string(), "127.0.0.1");
        assert!(addr.port() > 0);
    }

    #[test]
    fn test_http_server_bind_error() {
        // Try to bind to an invalid address
        let result = HttpServer::bind("256.256.256.256:8080");
        assert!(result.is_err());
    }

    #[test]
    fn test_http_request_parsing() {
        // Start a test server
        let server = HttpServer::bind("127.0.0.1:0").unwrap();
        let addr = server.listener.local_addr().unwrap();

        // Spawn a thread to send a request
        let client_thread = thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            let request = "GET /test HTTP/1.1\r\nHost: localhost\r\nUser-Agent: test\r\n\r\n";
            stream.write_all(request.as_bytes()).unwrap();
            stream.flush().unwrap();

            // Keep connection open briefly
            thread::sleep(Duration::from_millis(100));
        });

        // Accept the connection
        let mut incoming = server.incoming();
        let request = incoming.next().unwrap().unwrap();

        // Verify request parsing
        assert_eq!(request.method(), Method::GET);
        assert_eq!(request.uri().path(), "/test");
        assert_eq!(request.version(), Version::HTTP_11);
        assert_eq!(request.headers().get("host").unwrap(), "localhost");
        assert_eq!(request.headers().get("user-agent").unwrap(), "test");
        assert_eq!(request.body().len(), 0);

        client_thread.join().unwrap();
    }

    #[test]
    fn test_http_request_with_body() {
        let server = HttpServer::bind("127.0.0.1:0").unwrap();
        let addr = server.listener.local_addr().unwrap();

        let client_thread = thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            let body = r#"{"test": "data"}"#;
            let request = format!(
                "POST /api/test HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(request.as_bytes()).unwrap();
            stream.flush().unwrap();
            thread::sleep(Duration::from_millis(100));
        });

        let mut incoming = server.incoming();
        let request = incoming.next().unwrap().unwrap();

        assert_eq!(request.method(), Method::POST);
        assert_eq!(request.uri().path(), "/api/test");
        assert_eq!(
            request.headers().get("content-type").unwrap(),
            "application/json"
        );
        assert_eq!(request.body(), br#"{"test": "data"}"#);

        client_thread.join().unwrap();
    }

    #[test]
    fn test_http_response() {
        let server = HttpServer::bind("127.0.0.1:0").unwrap();
        let addr = server.listener.local_addr().unwrap();

        let client_thread = thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            let request = "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n";
            stream.write_all(request.as_bytes()).unwrap();
            stream.flush().unwrap();

            // Read response
            let mut reader = BufReader::new(stream);
            let mut status_line = String::new();
            reader.read_line(&mut status_line).unwrap();
            assert!(status_line.starts_with("HTTP/1.1 200"));

            // Read headers
            let mut headers = Vec::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                headers.push(line);
            }

            // Check for expected headers
            let has_content_type = headers
                .iter()
                .any(|h| h.to_lowercase().contains("content-type:"));
            assert!(has_content_type);

            // Read body based on Content-Length
            let content_length = headers
                .iter()
                .find(|h| h.to_lowercase().starts_with("content-length:"))
                .and_then(|h| h.split(':').nth(1))
                .and_then(|v| v.trim().parse::<usize>().ok())
                .unwrap_or(0);

            let mut body = vec![0u8; content_length];
            reader.read_exact(&mut body).unwrap();
            assert_eq!(String::from_utf8(body).unwrap(), "Hello, World!");
        });

        let mut incoming = server.incoming();
        let mut request = incoming.next().unwrap().unwrap();

        // Send a response
        let response = Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", "text/plain")
            .header("Content-Length", "13")
            .body("Hello, World!".to_string())
            .unwrap();

        request.respond(response).unwrap();

        client_thread.join().unwrap();
    }

    #[test]
    fn test_sse_response_helper() {
        let server = HttpServer::bind("127.0.0.1:0").unwrap();
        let addr = server.listener.local_addr().unwrap();

        let client_thread = thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            let request = "GET /events HTTP/1.1\r\nHost: localhost\r\n\r\n";
            stream.write_all(request.as_bytes()).unwrap();
            stream.flush().unwrap();

            // Read response headers
            let mut reader = BufReader::new(stream);
            let mut line = String::new();

            // Status line
            reader.read_line(&mut line).unwrap();
            assert!(line.starts_with("HTTP/1.1 200"));
            line.clear();

            // Headers
            let mut found_event_stream = false;
            let mut found_no_cache = false;
            loop {
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if line.to_lowercase().contains("content-type:")
                    && line.contains("text/event-stream")
                {
                    found_event_stream = true;
                }
                if line.to_lowercase().contains("cache-control:") && line.contains("no-cache") {
                    found_no_cache = true;
                }
                line.clear();
            }
            assert!(found_event_stream);
            assert!(found_no_cache);

            // Read SSE events
            reader.read_line(&mut line).unwrap();
            // The line might start with \r\n from the end of headers
            let line_trimmed = line.trim_start_matches("\r\n");
            assert_eq!(line_trimmed, "data: event1\n");
            line.clear();

            reader.read_line(&mut line).unwrap();
            assert_eq!(line, "\n");
            line.clear();

            // Try to read the second event, but handle connection close
            match reader.read_line(&mut line) {
                Ok(n) if n > 0 => assert_eq!(line, "data: event2\n"),
                _ => {} // Connection closed is acceptable
            }
        });

        let mut incoming = server.incoming();
        let mut request = incoming.next().unwrap().unwrap();

        // Initialize SSE
        let mut sse = SseResponseHelper::new(&mut request).unwrap();

        // Send events
        sse.write_event("event1").unwrap();
        sse.write_event("event2").unwrap();

        // Drop the request to close the connection
        drop(request);

        client_thread.join().unwrap();
    }

    #[test]
    fn test_invalid_request() {
        let server = HttpServer::bind("127.0.0.1:0").unwrap();
        let addr = server.listener.local_addr().unwrap();

        // Test connection closed immediately
        let client_thread = thread::spawn(move || {
            let _stream = TcpStream::connect(addr).unwrap();
            // Close immediately without sending anything
        });

        let mut incoming = server.incoming();
        let result = incoming.next().unwrap();
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Connection closed"));

        client_thread.join().unwrap();
    }

    #[test]
    fn test_request_too_large() {
        let server = HttpServer::bind("127.0.0.1:0").unwrap();
        let addr = server.listener.local_addr().unwrap();

        let client_thread = thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();

            // Send a request larger than MAX_REQUEST_SIZE
            let large_header = "X-Large: ".to_string() + &"A".repeat(MAX_REQUEST_SIZE);
            let request = format!("GET / HTTP/1.1\r\n{}\r\n\r\n", large_header);

            // Write in chunks to avoid blocking
            for chunk in request.as_bytes().chunks(8192) {
                let _ = stream.write(chunk);
            }
        });

        let mut incoming = server.incoming();
        let result = incoming.next().unwrap();
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Request too large"));

        client_thread.join().unwrap();
    }

    #[test]
    fn test_response_to_bytes() {
        let server = HttpServer::bind("127.0.0.1:0").unwrap();
        let addr = server.listener.local_addr().unwrap();

        let client_thread = thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            stream
                .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
                .unwrap();
            thread::sleep(Duration::from_millis(100));
        });

        let mut incoming = server.incoming();
        let request = incoming.next().unwrap().unwrap();

        // Test response_to_bytes method
        let response = Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header("X-Custom", "test")
            .body("Not Found")
            .unwrap();

        let bytes = request.response_to_bytes(response);
        let response_str = String::from_utf8_lossy(&bytes);

        assert!(response_str.starts_with("HTTP/1.1 404"));
        assert!(response_str.to_lowercase().contains("x-custom: test"));
        assert!(response_str.contains("Not Found"));

        client_thread.join().unwrap();
    }

    #[test]
    fn test_http_versions() {
        let server = HttpServer::bind("127.0.0.1:0").unwrap();
        let addr = server.listener.local_addr().unwrap();

        // Test HTTP/1.0
        let client_thread = thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            stream
                .write_all(b"GET / HTTP/1.0\r\nHost: localhost\r\n\r\n")
                .unwrap();
            thread::sleep(Duration::from_millis(100));
        });

        let mut incoming = server.incoming();
        let request = incoming.next().unwrap().unwrap();
        assert_eq!(request.version(), Version::HTTP_10);

        client_thread.join().unwrap();
    }

    #[test]
    fn test_malformed_headers() {
        let server = HttpServer::bind("127.0.0.1:0").unwrap();
        let addr = server.listener.local_addr().unwrap();

        let client_thread = thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            // Headers without colons should be ignored
            let request = "GET / HTTP/1.1\r\nValidHeader: value\r\nInvalidHeader\r\n\r\n";
            stream.write_all(request.as_bytes()).unwrap();
            thread::sleep(Duration::from_millis(100));
        });

        let mut incoming = server.incoming();
        let request = incoming.next().unwrap().unwrap();

        assert_eq!(request.headers().get("validheader").unwrap(), "value");
        assert!(request.headers().get("invalidheader").is_none());

        client_thread.join().unwrap();
    }
}
