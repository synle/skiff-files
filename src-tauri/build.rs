use std::path::PathBuf;

/// Build script — exposes `APP_VERSION` from `tauri.conf.json` to Rust at compile time.
fn main() {
    expose_app_version();
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
