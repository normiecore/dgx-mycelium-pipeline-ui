use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, Manager, Runtime,
};

pub fn setup_tray<R: Runtime>(app: &mut App<R>) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Open Mycelium", true, None::<&str>)?;
    let capture_item = MenuItem::with_id(app, "capture", "Start Capture", true, None::<&str>)?;
    let stop_item = MenuItem::with_id(app, "stop", "Stop Capture", true, None::<&str>)?;
    let sep = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show_item, &capture_item, &stop_item, &sep, &quit_item])?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "capture" => {
                let app_clone = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_clone.state::<crate::AppState>();
                    if let Err(e) = crate::start_capture(app_clone.clone(), state).await {
                        log::error!("Failed to start capture: {}", e);
                    }
                });
            }
            "stop" => {
                let state = app.state::<crate::AppState>();
                crate::stop_capture(state);
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
