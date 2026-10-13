// The desktop shell. All drawing and chemistry happen in the web page (../src);
// this opens the window, reads and writes the files the user picks, and runs a
// self-test used by the automatic Windows build.

mod clipboard;

use std::path::PathBuf;
use std::time::Duration;

/// Starting the app with CHEM_ILLUSTRATOR_SELFTEST set to a file path makes the page check
/// that drawing and the chemistry engine work, write a report to that file, and close.
fn selftest_path() -> Option<PathBuf> {
    std::env::var_os("CHEM_ILLUSTRATOR_SELFTEST").map(PathBuf::from)
}

#[tauri::command]
fn selftest_requested() -> bool {
    selftest_path().is_some()
}

#[tauri::command]
fn selftest_report(app: tauri::AppHandle, report: String, ok: bool) {
    if let Some(path) = selftest_path() {
        let _ = std::fs::write(path, report);
    }
    app.exit(if ok { 0 } else { 1 });
}

/// Read a file the user chose in an Open dialog.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Could not read {path}: {e}"))
}

/// Save a file the user chose. The text goes to a temporary file next to it first, so a
/// failed save (full disk, lost network drive) never leaves a half-written drawing.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let mut tmp = target.clone().into_os_string();
    tmp.push(".saving");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, contents.as_bytes())
        .and_then(|_| std::fs::rename(&tmp, &target))
        .map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            format!("Could not save {path}: {e}")
        })
}

/// The person's settings file (key map and preferences): settings.json in the app's
/// settings folder, e.g. %APPDATA%\io.github.nathanohare.chemillustrator on Windows.
fn settings_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().app_config_dir().map_err(|e| format!("No settings folder: {e}"))?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
fn settings_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(settings_file(&app)?.to_string_lossy().into_owned())
}

/// The saved settings, or nothing before the first change.
#[tauri::command]
fn settings_read(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = settings_file(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read {}: {e}", path.display())),
    }
}

#[tauri::command]
fn settings_write(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    let path = settings_file(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
    }
    write_text_file(path.to_string_lossy().into_owned(), contents)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // A self-test that never reports (the page failed to load) still ends.
            if let Some(path) = selftest_path() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(90));
                    let _ = std::fs::write(path, "{\"error\": \"timed out: the page never reported\"}");
                    handle.exit(2);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            selftest_requested,
            selftest_report,
            read_text_file,
            write_text_file,
            settings_path,
            settings_read,
            settings_write,
            clipboard::clipboard_write,
            clipboard::clipboard_read,
            clipboard::clipboard_formats
        ])
        .run(tauri::generate_context!())
        .expect("error while running Chem Illustrator");
}
