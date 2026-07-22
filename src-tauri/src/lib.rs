use serde::Serialize;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// macOS 冷启动时 `RunEvent::Opened` 早于窗口/前端；先缓存，等前端来取。
struct PendingOpenFiles(Mutex<Vec<String>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandResult {
  stdout: String,
  stderr: String,
  code: Option<i32>,
}

fn is_markdown_path(path: &Path) -> bool {
  path
    .extension()
    .and_then(|ext| ext.to_str())
    .map(|ext| {
      let lower = ext.to_ascii_lowercase();
      lower == "md" || lower == "markdown"
    })
    .unwrap_or(false)
}

fn markdown_argv() -> Vec<String> {
  std::env::args()
    .skip(1)
    .filter(|arg| !arg.starts_with('-'))
    .filter(|arg| is_markdown_path(Path::new(arg)))
    .collect()
}

#[tauri::command]
fn get_startup_files(app: AppHandle) -> Vec<String> {
  let mut files = markdown_argv();
  if let Ok(mut pending) = app.state::<PendingOpenFiles>().0.lock() {
    files.append(&mut *pending);
  }
  files
}

#[tauri::command]
fn print_window(window: tauri::WebviewWindow) -> Result<(), String> {
  window.print().map_err(|e| e.to_string())
}

#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
  if window.is_devtools_open() {
    window.close_devtools();
  } else {
    window.open_devtools();
  }
}

/// 跑用户配置的上传 CLI / 脚本（路径任意，shell plugin scope 罩不住）。
/// 必须 async + spawn_blocking：同步 wait 会堵死 Tauri 异步运行时，UI 跟着卡。
#[tauri::command]
async fn run_command(
  command: String,
  args: Vec<String>,
  cwd: String,
  timeout_ms: u64,
) -> Result<CommandResult, String> {
  tauri::async_runtime::spawn_blocking(move || {
    run_command_blocking(command, args, cwd, timeout_ms)
  })
  .await
  .map_err(|e| format!("run_command join failed: {e}"))?
}

fn run_command_blocking(
  command: String,
  args: Vec<String>,
  cwd: String,
  timeout_ms: u64,
) -> Result<CommandResult, String> {
  if command.trim().is_empty() {
    return Err("command is empty".into());
  }

  let timeout = Duration::from_millis(timeout_ms.max(1000));
  let mut child = Command::new(&command)
    .args(&args)
    .current_dir(if cwd.is_empty() { "." } else { &cwd })
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| format!("failed to spawn `{command}`: {e}"))?;

  let mut stdout_pipe = child
    .stdout
    .take()
    .ok_or_else(|| "missing stdout pipe".to_string())?;
  let mut stderr_pipe = child
    .stderr
    .take()
    .ok_or_else(|| "missing stderr pipe".to_string())?;

  let stdout_handle = std::thread::spawn(move || {
    let mut buf = Vec::new();
    let _ = stdout_pipe.read_to_end(&mut buf);
    buf
  });
  let stderr_handle = std::thread::spawn(move || {
    let mut buf = Vec::new();
    let _ = stderr_pipe.read_to_end(&mut buf);
    buf
  });

  let start = Instant::now();
  let status = loop {
    match child.try_wait() {
      Ok(Some(status)) => break status,
      Ok(None) => {
        if start.elapsed() > timeout {
          let _ = child.kill();
          let _ = child.wait();
          return Err(format!(
            "command timed out after {}ms",
            timeout.as_millis()
          ));
        }
        std::thread::sleep(Duration::from_millis(50));
      }
      Err(e) => return Err(format!("wait failed: {e}")),
    }
  };

  let stdout = stdout_handle
    .join()
    .map(|b| String::from_utf8_lossy(&b).into_owned())
    .unwrap_or_default();
  let stderr = stderr_handle
    .join()
    .map(|b| String::from_utf8_lossy(&b).into_owned())
    .unwrap_or_default();

  Ok(CommandResult {
    stdout,
    stderr,
    code: status.code(),
  })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(PendingOpenFiles(Mutex::new(Vec::new())))
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
      print_window,
      open_devtools,
      run_command
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
      if let tauri::RunEvent::Opened { urls } = &event {
        let paths: Vec<String> = urls
          .iter()
          .filter_map(|url| url.to_file_path().ok())
          .filter(|path| is_markdown_path(path))
          .map(|path| path.to_string_lossy().into_owned())
          .collect();
        if paths.is_empty() {
          return;
        }
        // 冷启动：窗口/前端可能还不在，必须先入队。
        if let Ok(mut pending) = app.state::<PendingOpenFiles>().0.lock() {
          pending.extend(paths.iter().cloned());
        }
        // 热启动：窗口已在则立刻推给前端。
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.emit("open-files", paths);
        }
      }
    });
}
