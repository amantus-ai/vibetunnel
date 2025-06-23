use crate::state::AppState;
use auto_launch::AutoLaunchBuilder;
use tauri::State;

fn get_app_path() -> String {
    let exe_path = std::env::current_exe().unwrap();

    // On macOS, we need to use the .app bundle path, not the executable inside it
    #[cfg(target_os = "macos")]
    {
        // The executable is at: /path/to/VibeTunnel.app/Contents/MacOS/VibeTunnel
        // We need: /path/to/VibeTunnel.app
        if let Some(macos_dir) = exe_path.parent() {
            if let Some(contents_dir) = macos_dir.parent() {
                if let Some(app_bundle) = contents_dir.parent() {
                    if app_bundle.to_string_lossy().ends_with(".app") {
                        return app_bundle.to_string_lossy().to_string();
                    }
                }
            }
        }
    }

    // For other platforms or if we couldn't find the .app bundle, use the executable path
    exe_path.to_string_lossy().to_string()
}

pub fn enable_auto_launch() -> Result<(), String> {
    let auto = AutoLaunchBuilder::new()
        .set_app_name("VibeTunnel")
        .set_app_path(&get_app_path())
        .set_args(&["--auto-launch"])
        .build()
        .map_err(|e| format!("Failed to build auto-launch: {e}"))?;

    auto.enable()
        .map_err(|e| format!("Failed to enable auto-launch: {e}"))?;

    Ok(())
}

pub fn disable_auto_launch() -> Result<(), String> {
    let auto = AutoLaunchBuilder::new()
        .set_app_name("VibeTunnel")
        .set_app_path(&get_app_path())
        .build()
        .map_err(|e| format!("Failed to build auto-launch: {e}"))?;

    auto.disable()
        .map_err(|e| format!("Failed to disable auto-launch: {e}"))?;

    Ok(())
}

pub fn is_auto_launch_enabled() -> Result<bool, String> {
    let auto = AutoLaunchBuilder::new()
        .set_app_name("VibeTunnel")
        .set_app_path(&get_app_path())
        .build()
        .map_err(|e| format!("Failed to build auto-launch: {e}"))?;

    auto.is_enabled()
        .map_err(|e| format!("Failed to check auto-launch status: {e}"))
}

#[tauri::command]
pub async fn set_auto_launch(enabled: bool, _state: State<'_, AppState>) -> Result<(), String> {
    if enabled {
        enable_auto_launch()
    } else {
        disable_auto_launch()
    }
}

#[tauri::command]
pub async fn get_auto_launch(_state: State<'_, AppState>) -> Result<bool, String> {
    is_auto_launch_enabled()
}
