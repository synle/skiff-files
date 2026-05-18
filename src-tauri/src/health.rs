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

fn handle_connection(mut stream: TcpStream) {
    let mut buf = [0; 1024];
    let n = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return,
    };
    let request = String::from_utf8_lossy(&buf[..n]);

    let (status_line, body) = if request.starts_with("GET /ping") || request.starts_with("GET /health")
    {
        ("HTTP/1.1 200 OK\r\n", r#"{"status":"ok"}"#)
    } else {
        (
            "HTTP/1.1 404 NOT FOUND\r\n",
            r#"{"error":"not found"}"#,
        )
    };

    let response = format!(
        "{status_line}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}
