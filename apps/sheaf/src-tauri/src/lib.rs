//! Native side of Sheaf. Shared by all five targets: desktop links this as an
//! rlib from `main.rs`; Android and iOS load it through `mobile_entry_point`.

use serde::Serialize;

/// Basic facts about the running build. Mirrored by `AppInfo` in
/// `src/platform/index.ts`; keep the two in sync.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    os: &'static str,
    arch: &'static str,
    tauri_version: &'static str,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        tauri_version: tauri::VERSION,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_info])
        .run(tauri::generate_context!())
        .expect("Sheaf failed to start");
}
