// Prevents an additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Returns the app version baked in at compile time by `build.rs`.
#[tauri::command]
fn get_app_version() -> &'static str {
    env!("APP_VERSION")
}

/// Sample command for the frontend "Call greet()" button.
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust.")
}

/// Tauri application entry point.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![get_app_version, greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greet_returns_message() {
        assert_eq!(greet("world"), "Hello, world! You've been greeted from Rust.");
    }

    #[test]
    fn app_version_is_non_empty() {
        assert!(!get_app_version().is_empty());
    }
}
