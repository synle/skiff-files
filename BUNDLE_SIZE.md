# Bundle Size Audit — 0.2.238

Snapshot of where bytes go in the macOS arm64 release binary, captured via `cargo bloat --release`. The TODO.md target is **< 15 MB on macOS, < 10 MB on Windows** for the bundled `.app` / `.exe`.

| Artifact | Size | Notes |
|---|---|---|
| `target/release/skiff-files` (binary) | **6.4 MB stripped / 7.7 MB unstripped** | The thing that lives inside the `.app` |
| `target/release/libapp_lib.dylib` | 336 KB | Build artifact, not shipped |
| `.app` bundle (estimate) | ~10–11 MB | Binary + icons + Info.plist + frameworks ref |

We're comfortably **under the 15 MB target on macOS**.

---

## Top crates by `.text` contribution

From `cargo bloat --release --crates -n 30`:

| % of .text | Size | Crate | Why it's here |
|---|---|---|---|
| 29.8% | 1.2 MiB | `app_lib` | Our own code — Tauri command surface, Skiffsync engine, FS layer |
| 13.1% | 544 KiB | `std` | Rust stdlib monomorphizations |
| 11.0% | 458 KiB | `tauri` | Tauri v2 runtime + IPC glue |
| 5.0% | 207 KiB | `regex_automata` | Recursive find, glob, find-in-path |
| 3.2% | 130.7 KiB | `russh` | SFTP transport |
| 3.1% | 128.7 KiB | `russh_keys` | SSH key auth + parsing |
| 2.4% | 101.3 KiB | `regex_syntax` | Regex compilation |
| 2.2% | 89.5 KiB | `tao` | Wry's window-shell layer |
| 1.8% | 74.4 KiB | `aho_corasick` | regex multi-pattern matcher |
| 1.6% | 66.3 KiB | `tokio` | Async runtime for SFTP / cross-engine |
| 1.6% | 65.9 KiB | `wry` | webview integration |
| 1.5% | 63.6 KiB | `russh_sftp` | SFTP protocol on top of russh |
| 1.3% | 53.6 KiB | `muda` | Native menus |
| 1.2% | 50.3 KiB | `num_bigint_dig` | Crypto big-int (russh dep) |
| 1.2% | 50.2 KiB | `tauri_plugin_shell` | `fs_open_with_default` |
| 1.2% | 50.0 KiB | `tauri_utils` | Tauri shared types |
| 0.9% | 35.7 KiB | `url` | URL parser |
| 0.8% | 34.8 KiB | `ssh_key` | SSH key encoding |
| 0.8% | 33.7 KiB | `p521` | Elliptic-curve crypto (russh dep) |
| 0.7% | 27.5 KiB | `serde_json` | settings.json + IPC payloads |
| 0.7% | 27.5 KiB | `exif` | EXIF reader for image preview |
| 0.7% | 27.0 KiB | `zopfli` | Compression (transitive through tauri-utils) |
| 0.6% | 26.3 KiB | `encoding_rs` | Charset detection (russh / wry) |
| 0.5% | 21.8 KiB | `http` | HTTP types (transitive) |

`.text` total: 4.0 MiB. Everything else is `.rodata` / debug info / metadata.

---

## Top functions

From `cargo bloat --release -n 30`:

| Size | Function | Notes |
|---|---|---|
| 111 KiB | `app_lib::run::inner::{{closure}}` | The `tauri::Builder` command handler — our `invoke_handler!` codegen lives here |
| 33.6 KiB | `regex_automata::meta::strategy::new` | Regex strategy DFA construction |
| 31.3 KiB | `app_lib::run::{{closure}}` | Builder setup outer closure |
| 23.3 KiB | `russh_keys::format::pkcs8::decode_pkcs8` | SSH key decoding |
| 22.0 KiB | `ssh_key::PrivateKey::decrypt` | SSH passphrase decrypt |
| 21.4 KiB | `app_lib::fs::sftp::SftpClient::connect::{{closure}}` | SFTP connect path |

The biggest single function is the Tauri command-builder closure (111 KiB) — every `#[tauri::command]` adds to this. Hard to shrink without giving up command-surface area.

---

## Levers we have

In rough order of effort vs. payoff:

1. **Drop unused imports** — `commands.rs:520` has a known `use std::io::Read;` rustc flags as unused. One-line fix; saves nothing in binary terms but cleans the build log. Not addressed in this audit (separate hygiene PR).
2. **Audit regex usage** — `regex_automata + regex_syntax + aho_corasick` total **~382 KiB / 9.4%**. We use regex for find-in-path. If we move to literal/fast-path matching for the common case (substring / case-insensitive substring) and only bring up regex when the user actually types regex syntax, we could cut a chunk. Won't pursue without a clear user complaint.
3. **Crypto algorithm pruning** — `russh` brings every supported curve / cipher (`p521`, `num_bigint_dig`, all of `ssh_key`'s formats). russh feature-flags some of these. Combined potential savings: ~150 KiB. Risky — users have keys we shouldn't break.
4. **Compression dedup** — `zopfli` is in the build via `tauri-utils` (compression of resources). Can't easily strip without losing tauri-utils features.
5. **`opt-level = "z"`** — currently `opt-level = "s"` (size). Switching to `"z"` typically shaves ~5%. Already on size opt, so the win is marginal vs. the perf hit.
6. **`strip = "symbols"`** in `[profile.release]` — already implicit via `cargo build --release`. The 6.4 MB stripped figure assumes `strip` runs in CI; verify the bundler does.

None are urgent. We're at 6.4 MB (stripped) vs. 15 MB target — ~58% of budget. Plenty of headroom for the FTP / NTFS phases.

---

## Reproducing this audit

```bash
cargo install cargo-bloat
cd src-tauri
cargo bloat --release --crates -n 30   # by crate
cargo bloat --release -n 30             # by function
```

Build profile (`Cargo.toml`):

```toml
[profile.release]
opt-level = "s"   # optimize for size
lto = true        # link-time optimization
codegen-units = 1 # better LTO + dead-code elimination
panic = "abort"   # no unwinding tables
```

Already aggressive — these flags collectively produce the 6.4 MB stripped binary. Further wins require dep-pruning, not compiler flags.
