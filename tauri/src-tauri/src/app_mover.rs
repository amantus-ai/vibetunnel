use tauri::{AppHandle, Manager};
use std::path::PathBuf;

/// Check if the app should be moved to Applications folder
/// This is a macOS-specific feature
#[cfg(target_os = "macos")]
pub async fn check_and_prompt_move(app_handle: AppHandle) -> Result<(), String> {
    use std::process::Command;
    
    // Get current app bundle path
    let bundle_path = get_app_bundle_path()?;
    
    // Check if already in Applications folder
    if is_in_applications_folder(&bundle_path) {
        return Ok(());
    }
    
    // Check if we've already asked this question
    let settings = crate::settings::Settings::load().unwrap_or_default();
    if let Some(asked) = settings.general.show_welcome_on_startup {
        if !asked {
            // User has already been asked, don't ask again
            return Ok(());
        }
    }
    
    // Show dialog asking if user wants to move to Applications
    let response = tauri::api::dialog::blocking::ask(
        Some(&app_handle.get_webview_window("main").unwrap()),
        "Move to Applications Folder?",
        "VibeTunnel works best when run from the Applications folder. Would you like to move it there?"
    );
    
    if response {
        move_to_applications_folder(bundle_path)?;
        
        // Restart the app from the new location
        restart_from_applications()?;
    }
    
    // Update settings to not ask again
    let mut settings = crate::settings::Settings::load().unwrap_or_default();
    settings.general.show_welcome_on_startup = Some(false);
    settings.save().ok();
    
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub async fn check_and_prompt_move(_app_handle: AppHandle) -> Result<(), String> {
    // Not applicable on other platforms
    Ok(())
}

#[cfg(target_os = "macos")]
fn get_app_bundle_path() -> Result<PathBuf, String> {
    use std::env;
    
    // Get the executable path
    let exe_path = env::current_exe()
        .map_err(|e| format!("Failed to get executable path: {}", e))?;
    
    // Navigate up to the .app bundle
    // Typical structure: /path/to/VibeTunnel.app/Contents/MacOS/VibeTunnel
    let mut bundle_path = exe_path;
    
    // Go up three levels to reach the .app bundle
    for _ in 0..3 {
        bundle_path = bundle_path.parent()
            .ok_or("Failed to find app bundle")?
            .to_path_buf();
    }
    
    // Verify this is an .app bundle
    if !bundle_path.to_string_lossy().ends_with(".app") {
        return Err("Not running from an app bundle".to_string());
    }
    
    Ok(bundle_path)
}

#[cfg(target_os = "macos")]
fn is_in_applications_folder(bundle_path: &PathBuf) -> bool {
    let path_str = bundle_path.to_string_lossy();
    path_str.contains("/Applications/") || path_str.contains("/System/Applications/")
}

#[cfg(target_os = "macos")]
fn move_to_applications_folder(bundle_path: PathBuf) -> Result<(), String> {
    use std::process::Command;
    use std::fs;
    
    let app_name = bundle_path.file_name()
        .ok_or("Failed to get app name")?
        .to_string_lossy();
    
    let dest_path = PathBuf::from("/Applications").join(&app_name);
    
    // Check if destination already exists
    if dest_path.exists() {
        // Ask user if they want to replace
        let response = tauri::api::dialog::blocking::ask(
            None,
            "Replace Existing App?",
            "VibeTunnel already exists in the Applications folder. Do you want to replace it?"
        );
        
        if !response {
            return Err("User cancelled move operation".to_string());
        }
        
        // Remove existing app
        fs::remove_dir_all(&dest_path)
            .map_err(|e| format!("Failed to remove existing app: {}", e))?;
    }
    
    // Use AppleScript to move the app with proper permissions
    let script = format!(
        r#"tell application "Finder"
            move (POSIX file "{}") to (POSIX file "/Applications/") with replacing
        end tell"#,
        bundle_path.to_string_lossy()
    );
    
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("Failed to execute move command: {}", e))?;
    
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to move app: {}", error));
    }
    
    Ok(())
}

#[cfg(target_os = "macos")]
fn restart_from_applications() -> Result<(), String> {
    use std::process::Command;
    
    // Launch the app from the Applications folder
    let output = Command::new("open")
        .arg("-n")
        .arg("/Applications/VibeTunnel.app")
        .spawn()
        .map_err(|e| format!("Failed to restart app: {}", e))?;
    
    // Exit the current instance
    std::process::exit(0);
}

#[tauri::command]
pub async fn prompt_move_to_applications(app_handle: AppHandle) -> Result<(), String> {
    check_and_prompt_move(app_handle).await
}

#[tauri::command]
pub async fn is_in_applications_folder() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let bundle_path = get_app_bundle_path()?;
        Ok(is_in_applications_folder(&bundle_path))
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        // Always return true on non-macOS platforms
        Ok(true)
    }
}