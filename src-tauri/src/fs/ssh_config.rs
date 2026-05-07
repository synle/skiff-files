//! Tiny parser for `~/.ssh/config` Host blocks. We extract just enough
//! to pre-fill the Connections form: `HostName`, `User`, `Port`,
//! `IdentityFile`. Wildcards (`Host *`), grouped hosts
//! (`Host foo bar`), and Match/Include directives are out of scope —
//! the user can still type those into the form by hand.
//!
//! The parser is deliberately permissive: unknown directives are
//! skipped, malformed lines are ignored. The OpenSSH grammar is
//! lenient and we don't want a stray comment to break the entire
//! import flow.

use serde::Serialize;
use std::fs;
use std::path::Path;

/// One importable host. The frontend maps this onto its `SftpConfig`
/// shape — we deliberately stop at the file-system layer rather than
/// duplicating SftpConfig here.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigHost {
    /// The `Host` alias as written in the file. This is what the user
    /// types as `ssh <name>` in a terminal.
    pub name: String,
    /// `HostName` directive value if present; otherwise `None` and the
    /// alias itself doubles as the hostname.
    pub host_name: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
}

/// Parse a config file's bytes into a list of host entries. Public so
/// tests can feed in synthetic configs without touching the
/// filesystem.
pub fn parse_ssh_config(body: &str) -> Vec<SshConfigHost> {
    let mut out: Vec<SshConfigHost> = Vec::new();
    let mut current: Option<SshConfigHost> = None;

    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        // Split on first run of whitespace (or `=`). OpenSSH accepts
        // both `Host foo` and `Host=foo`.
        let (key, value) = split_directive(trimmed);
        let lower = key.to_ascii_lowercase();
        if lower == "host" {
            // Flush previous block, start new one. Skip wildcards +
            // grouped hosts so we don't claim to import something we
            // can't sensibly pre-fill.
            if let Some(prev) = current.take() {
                if !prev.name.contains('*') && !prev.name.contains('?') {
                    out.push(prev);
                }
            }
            // Only the first token in a Host line is treated as the
            // alias; multi-host lines are skipped (we set name to "").
            let parts: Vec<&str> = value.split_whitespace().collect();
            if parts.len() == 1 && !parts[0].contains('*') && !parts[0].contains('?') {
                current = Some(SshConfigHost {
                    name: parts[0].to_string(),
                    host_name: None,
                    user: None,
                    port: None,
                    identity_file: None,
                });
            } else {
                // Multi-host or wildcard — skip until the next Host.
                current = None;
            }
            continue;
        }
        let Some(cur) = current.as_mut() else {
            // Directive before any Host block — global default; we
            // ignore.
            continue;
        };
        match lower.as_str() {
            "hostname" => cur.host_name = Some(value.to_string()),
            "user" => cur.user = Some(value.to_string()),
            "port" => cur.port = value.parse().ok(),
            "identityfile" => cur.identity_file = Some(strip_quotes(value).to_string()),
            // Anything else (ProxyCommand, ServerAliveInterval, etc.)
            // is silently dropped — we only pre-fill the SFTP form
            // fields we actually have UI for.
            _ => {}
        }
    }
    if let Some(prev) = current.take() {
        if !prev.name.contains('*') && !prev.name.contains('?') {
            out.push(prev);
        }
    }
    out
}

/// Split `Foo bar baz` or `Foo=bar baz` into `("Foo", "bar baz")`.
/// Returns `(line, "")` if there's no separator.
fn split_directive(line: &str) -> (&str, &str) {
    // Try `=` first (OpenSSH allows it).
    if let Some(i) = line.find('=') {
        let key = line[..i].trim_end();
        let value = line[i + 1..].trim_start();
        // Be careful: `=` could appear inside the value (e.g.
        // `IdentityAgent=...`). The directive form has the `=` right
        // after the keyword, so we only treat it as a separator when
        // the prefix is alphanumeric.
        if key.chars().all(|c| c.is_ascii_alphanumeric()) {
            return (key, value);
        }
    }
    // Fall back to whitespace.
    match line.find(char::is_whitespace) {
        Some(i) => (&line[..i], line[i..].trim_start()),
        None => (line, ""),
    }
}

/// Strip surrounding `"..."` from a value if present. OpenSSH uses
/// quotes for paths with spaces.
fn strip_quotes(s: &str) -> &str {
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

/// Public entry — load `~/.ssh/config` if it exists. Missing file is
/// not an error; we return an empty list so the UI can render
/// "(no entries)" without surfacing a scary failure.
pub fn load_ssh_config_hosts() -> Vec<SshConfigHost> {
    let path = match dirs::home_dir() {
        Some(home) => home.join(".ssh").join("config"),
        None => return Vec::new(),
    };
    if !Path::new(&path).exists() {
        return Vec::new();
    }
    match fs::read_to_string(&path) {
        Ok(body) => parse_ssh_config(&body),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_simple_host_block() {
        let body = "Host myserver\n    HostName example.com\n    User alice\n    Port 2222\n    IdentityFile ~/.ssh/id_rsa\n";
        let hosts = parse_ssh_config(body);
        assert_eq!(hosts.len(), 1);
        let h = &hosts[0];
        assert_eq!(h.name, "myserver");
        assert_eq!(h.host_name.as_deref(), Some("example.com"));
        assert_eq!(h.user.as_deref(), Some("alice"));
        assert_eq!(h.port, Some(2222));
        assert_eq!(h.identity_file.as_deref(), Some("~/.ssh/id_rsa"));
    }

    #[test]
    fn handles_multiple_blocks() {
        let body = "Host a\n  HostName a.com\n\nHost b\n  HostName b.com\n  User bob\n";
        let hosts = parse_ssh_config(body);
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].name, "a");
        assert_eq!(hosts[1].name, "b");
        assert_eq!(hosts[1].user.as_deref(), Some("bob"));
    }

    #[test]
    fn skips_wildcard_hosts() {
        let body = "Host *.example.com\n  User wildcard\n\nHost real\n  HostName real.com\n";
        let hosts = parse_ssh_config(body);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].name, "real");
    }

    #[test]
    fn skips_grouped_hosts() {
        let body = "Host foo bar\n  HostName multi.com\n\nHost solo\n  HostName solo.com\n";
        let hosts = parse_ssh_config(body);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].name, "solo");
    }

    #[test]
    fn ignores_comments_and_blank_lines() {
        let body = "# top comment\n\nHost a\n  # inside comment\n  HostName a.com\n";
        let hosts = parse_ssh_config(body);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].host_name.as_deref(), Some("a.com"));
    }

    #[test]
    fn supports_equals_separator() {
        let body = "Host=eq\n  HostName=eq.com\n  Port=2200\n";
        let hosts = parse_ssh_config(body);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].name, "eq");
        assert_eq!(hosts[0].host_name.as_deref(), Some("eq.com"));
        assert_eq!(hosts[0].port, Some(2200));
    }

    #[test]
    fn strips_quoted_identity_file_paths() {
        let body = r#"Host x
  IdentityFile "~/path with spaces/key"
"#;
        let hosts = parse_ssh_config(body);
        assert_eq!(
            hosts[0].identity_file.as_deref(),
            Some("~/path with spaces/key")
        );
    }

    #[test]
    fn ignores_unknown_directives_silently() {
        let body = "Host a\n  HostName a.com\n  ProxyCommand ssh jump nc %h %p\n  ServerAliveInterval 60\n";
        let hosts = parse_ssh_config(body);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].host_name.as_deref(), Some("a.com"));
    }

    #[test]
    fn ignores_directives_before_first_host() {
        let body = "User globaldefault\nHost a\n  HostName a.com\n";
        let hosts = parse_ssh_config(body);
        // The User above the first Host is a global default — we
        // intentionally don't apply it to anything.
        assert!(hosts[0].user.is_none());
    }
}
