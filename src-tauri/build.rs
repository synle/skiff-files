use std::path::PathBuf;

/// Build script — exposes `APP_VERSION` and `BUILD_TIMESTAMP` to Rust at compile time.
fn main() {
    expose_app_version();
    expose_build_timestamp();
    tauri_build::build();
}

/// Read the version from `tauri.conf.json` (the single source of truth) and
/// expose it as the compile-time env var `APP_VERSION`.
fn expose_app_version() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let conf_path = manifest_dir.join("tauri.conf.json");
    let conf: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&conf_path).expect("failed to read tauri.conf.json"),
    )
    .expect("failed to parse tauri.conf.json");
    let version = conf["version"].as_str().expect("version missing in tauri.conf.json");

    let is_release = std::env::var("TAURI_RELEASE").unwrap_or_default() == "true";
    let app_version = if is_release {
        version.to_string()
    } else {
        format!("{version} [DEV]")
    };
    println!("cargo:rustc-env=APP_VERSION={app_version}");
    println!("cargo:rerun-if-changed=tauri.conf.json");
}

/// Expose the build timestamp as the compile-time env var `BUILD_TIMESTAMP`,
/// formatted as `YYYY-MM-DD HH:MM` in UTC. Surfaced in the Settings → About
/// row so the user can see when their installed binary was built.
///
/// The timestamp reflects the time `build.rs` last ran. `tauri-build::build()`
/// already forces a rerun on every Cargo invocation (it watches the Tauri
/// config + capability files), so this stays in lockstep with the produced
/// binary without us declaring our own `rerun-if-changed`.
fn expose_build_timestamp() {
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M").to_string();
    println!("cargo:rustc-env=BUILD_TIMESTAMP={now}");
}
