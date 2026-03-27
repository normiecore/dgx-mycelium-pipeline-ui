use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};

mod capture;
mod pipeline;
mod tray;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureConfig {
    pub enabled: bool,
    pub interval_secs: u64,
    pub pipeline_url: String,
    pub auth_token: String,
}

impl Default for CaptureConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_secs: 30,
            pipeline_url: "http://localhost:3001".to_string(),
            auth_token: String::new(),
        }
    }
}

pub struct AppState {
    pub config: Arc<Mutex<CaptureConfig>>,
    pub capture_handle: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> CaptureConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn set_config(config: CaptureConfig, state: State<'_, AppState>) {
    let mut cfg = state.config.lock().unwrap();
    *cfg = config;
}

#[tauri::command]
async fn start_capture(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let config = state.config.lock().unwrap().clone();
    if !config.enabled {
        return Err("Capture is disabled in config".to_string());
    }
    let interval = std::time::Duration::from_secs(config.interval_secs);
    let pipeline_url = config.pipeline_url.clone();
    let auth_token = config.auth_token.clone();
    let app_clone = app.clone();

    let handle = tokio::spawn(async move {
        loop {
            match capture::take_screenshot() {
                Ok(screenshot_b64) => {
                    let payload = pipeline::CapturePayload {
                        source: "desktop-screenshot".to_string(),
                        content_type: "image/png;base64".to_string(),
                        content: screenshot_b64,
                        captured_at: chrono::Utc::now().to_rfc3339(),
                    };
                    match pipeline::send_capture(&pipeline_url, &auth_token, payload).await {
                        Ok(_) => {
                            let _ = app_clone.emit("capture-sent", ());
                        }
                        Err(e) => {
                            log::error!("Failed to send capture: {}", e);
                            let _ = app_clone.emit("capture-error", e.to_string());
                        }
                    }
                }
                Err(e) => {
                    log::error!("Screenshot failed: {}", e);
                }
            }
            tokio::time::sleep(interval).await;
        }
    });

    let mut h = state.capture_handle.lock().unwrap();
    if let Some(old) = h.take() {
        old.abort();
    }
    *h = Some(handle);
    Ok(())
}

#[tauri::command]
fn stop_capture(state: State<'_, AppState>) {
    let mut h = state.capture_handle.lock().unwrap();
    if let Some(handle) = h.take() {
        handle.abort();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState {
            config: Arc::new(Mutex::new(CaptureConfig::default())),
            capture_handle: Arc::new(Mutex::new(None)),
        })
        .setup(|app| {
            tray::setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_config,
            start_capture,
            stop_capture,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
