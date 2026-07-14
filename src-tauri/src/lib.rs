use std::path::Path;
use tauri::{Emitter, Manager};

#[tauri::command]
fn get_startup_files() -> Vec<String> {
  std::env::args()
    .skip(1)
    .filter(|arg| !arg.starts_with('-'))
    .filter(|arg| {
      let path = Path::new(arg);
      path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
          let lower = ext.to_ascii_lowercase();
          lower == "md" || lower == "markdown"
        })
        .unwrap_or(false)
    })
    .collect()
}

#[tauri::command]
fn print_window(window: tauri::WebviewWindow) -> Result<(), String> {
  window.print().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_startup_files,
      print_window
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let tauri::RunEvent::Opened { urls } = event {
        let paths: Vec<String> = urls
          .into_iter()
          .filter_map(|url| url.to_file_path().ok())
          .map(|path| path.to_string_lossy().into_owned())
          .collect();
        if paths.is_empty() {
          return;
        }
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.emit("open-files", paths);
        }
      }
    });
}
