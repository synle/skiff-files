/// Minimal HTTP health-check server.
///
/// Listens on `127.0.0.1:39871` and responds to GET `/ping` and `/health`
/// with a 200 OK JSON body `{"status":"ok"}`. Any other request returns
/// 404. Runs in a background daemon thread.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

const HEALTH_PORT: u16 = 39871;

/// Start the health-check HTTP server in a background thread.
pub fn start_health_server() {
    thread::spawn(|| {
        let addr = format!("127.0.0.1:{HEALTH_PORT}");
        let listener = match TcpListener::bind(&addr) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("health server: failed to bind {addr}: {e}");
                return;
            }
        };
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    thread::spawn(|| handle_connection(stream));
                }
                Err(e) => {
                    eprintln!("health server: accept error: {e}");
                }
            }
        }
    });
}

/// Build the HTTP response a given request line maps to. Pure so it
/// can be unit-tested without sockets. Returns `(status_line, body)`.
fn route_request(request: &str) -> (&'static str, &'static str) {
    if request.starts_with("GET /ping") || request.starts_with("GET /health") {
        ("HTTP/1.1 200 OK\r\n", r#"{"status":"ok"}"#)
    } else {
        ("HTTP/1.1 404 NOT FOUND\r\n", r#"{"error":"not found"}"#)
    }
}

fn handle_connection(mut stream: TcpStream) {
    let mut buf = [0; 1024];
    let n = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return,
    };
    let request = String::from_utf8_lossy(&buf[..n]);
    let (status_line, body) = route_request(&request);

    let response = format!(
        "{status_line}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    /// `GET /ping` and `GET /health` map to a 200 with the `{"status":"ok"}`
    /// body; everything else 404s. Pinned so a future refactor (e.g. adding
    /// `/version`) doesn't silently drop the contract the frontend Health
    /// button + external probes rely on.
    #[test]
    fn route_request_maps_known_paths_to_200_and_unknown_to_404() {
        let (status, body) = route_request("GET /ping HTTP/1.1\r\nHost: x\r\n");
        assert_eq!(status, "HTTP/1.1 200 OK\r\n");
        assert_eq!(body, r#"{"status":"ok"}"#);

        let (status, body) = route_request("GET /health HTTP/1.1\r\nHost: x\r\n");
        assert_eq!(status, "HTTP/1.1 200 OK\r\n");
        assert_eq!(body, r#"{"status":"ok"}"#);

        // Method other than GET on the same path → 404 (we only accept
        // GET, mirroring the doc-comment contract).
        let (status, body) = route_request("POST /ping HTTP/1.1\r\nHost: x\r\n");
        assert_eq!(status, "HTTP/1.1 404 NOT FOUND\r\n");
        assert_eq!(body, r#"{"error":"not found"}"#);

        // Unknown path → 404.
        let (status, _) = route_request("GET /something-else HTTP/1.1\r\n");
        assert_eq!(status, "HTTP/1.1 404 NOT FOUND\r\n");

        // Empty / malformed → 404 (no panic).
        let (status, _) = route_request("");
        assert_eq!(status, "HTTP/1.1 404 NOT FOUND\r\n");
        let (status, _) = route_request("GARBAGE\r\n\r\n");
        assert_eq!(status, "HTTP/1.1 404 NOT FOUND\r\n");
    }

    /// End-to-end: bind an ephemeral listener, run `handle_connection` on
    /// one accepted socket, send a request from a client socket, read the
    /// full response. Confirms the response framing (status line +
    /// Content-Type + Content-Length + Connection: close) matches what an
    /// HTTP client expects.
    #[test]
    fn handle_connection_writes_framed_http_response_for_ping() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            handle_connection(stream);
        });

        let mut client = TcpStream::connect(("127.0.0.1", port)).expect("client connect");
        client
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        client
            .write_all(b"GET /ping HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();

        let mut buf = Vec::new();
        client.read_to_end(&mut buf).expect("read response");
        let response = String::from_utf8_lossy(&buf);

        assert!(
            response.starts_with("HTTP/1.1 200 OK\r\n"),
            "expected 200 status line, got: {response:?}"
        );
        assert!(response.contains("Content-Type: application/json\r\n"));
        assert!(response.contains("Content-Length: 15\r\n"));
        assert!(response.contains("Connection: close\r\n"));
        assert!(response.ends_with(r#"{"status":"ok"}"#));

        server.join().unwrap();
    }

    /// Unknown paths return a 404 with the documented error body. Same
    /// end-to-end shape as the ping case so the framing contract is
    /// exercised on the error arm too.
    #[test]
    fn handle_connection_returns_404_for_unknown_path() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            handle_connection(stream);
        });

        let mut client = TcpStream::connect(("127.0.0.1", port)).expect("client connect");
        client
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        client
            .write_all(b"GET /nope HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();

        let mut buf = Vec::new();
        client.read_to_end(&mut buf).expect("read response");
        let response = String::from_utf8_lossy(&buf);

        assert!(response.starts_with("HTTP/1.1 404 NOT FOUND\r\n"));
        assert!(response.ends_with(r#"{"error":"not found"}"#));

        server.join().unwrap();
    }

    /// `HEALTH_PORT` is the documented contract with the frontend's
    /// "Health check" button in Settings → Advanced (it opens
    /// `http://127.0.0.1:39871/ping`). Pin the constant so a typo here
    /// doesn't silently break that affordance.
    #[test]
    fn health_port_constant_matches_documented_contract() {
        assert_eq!(HEALTH_PORT, 39871);
    }
}
