// Safety copies and shared folders: the recovery copies of unsaved work and the earlier
// versions of saved files (kept in the app's own data folder, under names the page chooses
// but can't use to reach anywhere else), when a file was last changed, and the small lock
// files that tell other people (and Word, LibreOffice or another copy of this app) that a
// file is open.

use std::path::{Path, PathBuf};

/// The folder recovery copies and versions go in: "Kept" in the app's local data folder
/// (on Windows %LOCALAPPDATA%\io.github.nathanohare.chemillustrator\Kept), or in the
/// "Chem Illustrator Data" folder of a portable copy.
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    if let Some(dir) = crate::portable::settings_folder() {
        return Ok(dir.join("Kept"));
    }
    let dir = app.path().app_local_data_dir().map_err(|e| format!("No data folder: {e}"))?;
    Ok(dir.join("Kept"))
}

/// A place inside the kept folder: "recovery/…" or "versions/…", one to four plain names
/// (letters, digits, '.', '_' and '-'), so a key can never point outside it.
fn key_path(app: &tauri::AppHandle, key: &str) -> Result<PathBuf, String> {
    let parts: Vec<&str> = key.split('/').collect();
    let ok_part = |p: &&str| {
        !p.is_empty() && *p != "." && *p != ".." && p.len() <= 120 && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
    };
    if parts.is_empty() || parts.len() > 4 || !parts.iter().all(ok_part) || !matches!(parts[0], "recovery" | "versions") {
        return Err(format!("not a place for kept copies: {key}"));
    }
    let mut path = root(app)?;
    for p in parts {
        path.push(p);
    }
    Ok(path)
}

#[tauri::command]
pub fn keep_folder(app: tauri::AppHandle) -> Result<String, String> {
    Ok(root(&app)?.to_string_lossy().into_owned())
}

/// Keep bytes under a key (sent raw, with the key in a "key" header), making folders as needed.
#[tauri::command]
pub fn keep_put(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the copy's bytes".into());
    };
    let key = request.headers().get("key").and_then(|v| v.to_str().ok()).ok_or("no key given")?;
    let path = key_path(&app, key)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
    }
    crate::write_bytes(&path.to_string_lossy(), bytes)
}

#[tauri::command]
pub fn keep_get(app: tauri::AppHandle, key: String) -> Result<tauri::ipc::Response, String> {
    let path = key_path(&app, &key)?;
    std::fs::read(&path).map(tauri::ipc::Response::new).map_err(|e| format!("Could not read {key}: {e}"))
}

/// What a folder of kept copies holds (nothing when it isn't there).
#[tauri::command]
pub fn keep_list(app: tauri::AppHandle, key: String) -> Result<Vec<serde_json::Value>, String> {
    let path = key_path(&app, &key)?;
    let Ok(entries) = std::fs::read_dir(&path) else { return Ok(vec![]) };
    Ok(entries
        .flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            Some(serde_json::json!({
                "name": e.file_name().to_string_lossy(),
                "size": meta.len(),
                "modified": modified_ms(&meta),
                "folder": meta.is_dir(),
            }))
        })
        .collect())
}

/// Delete a kept copy, or a folder of them.
#[tauri::command]
pub fn keep_remove(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let path = key_path(&app, &key)?;
    let r = if path.is_dir() { std::fs::remove_dir_all(&path) } else { std::fs::remove_file(&path) };
    match r {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not delete {key}: {e}")),
    }
}

fn modified_ms(meta: &std::fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0.0, |d| d.as_millis() as f64)
}

/// When a file was last changed and its size, to notice changes made elsewhere (null when it isn't there).
#[tauri::command]
pub fn file_stamp(path: String) -> Option<serde_json::Value> {
    let meta = std::fs::metadata(&path).ok()?;
    Some(serde_json::json!({ "modified": modified_ms(&meta), "size": meta.len() }))
}

/// The person's user name and the computer's name, for lock files and OneDrive's conflict copies.
#[tauri::command]
pub fn who_am_i() -> serde_json::Value {
    let env = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
    let user = env("USERNAME").or_else(|| env("USER")).unwrap_or_default();
    let host = env("COMPUTERNAME")
        .or_else(|| env("HOSTNAME"))
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
        .or_else(|| {
            std::process::Command::new("hostname")
                .output()
                .ok()
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_default();
    serde_json::json!({ "user": user, "host": host })
}

/// Lock files are named ".~lock.<file name>#", as LibreOffice names them, so it sees ours and we see its.
fn is_lock_file(path: &Path) -> bool {
    path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(".~lock.") && n.ends_with('#') && n.len() > 8)
}

/// Put a lock file beside an open file (hidden on Windows, as Office hides its own).
#[tauri::command]
pub fn write_lock_file(path: String, contents: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !is_lock_file(&p) {
        return Err(format!("not a lock file: {path}"));
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        opts.attributes(0x2); // FILE_ATTRIBUTE_HIDDEN
    }
    use std::io::Write;
    opts.open(&p)
        .and_then(|mut f| f.write_all(contents.as_bytes()))
        .map_err(|e| format!("Could not write {path}: {e}"))
}

/// Take a lock file away when the file is closed.
#[tauri::command]
pub fn remove_lock_file(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !is_lock_file(&p) {
        return Err(format!("not a lock file: {path}"));
    }
    match std::fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not delete {path}: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::is_lock_file;
    use std::path::Path;

    #[test]
    fn only_lock_files_count() {
        assert!(is_lock_file(Path::new("/a/.~lock.Scheme 1.cdxml#")));
        assert!(!is_lock_file(Path::new("/a/Scheme 1.cdxml")));
        assert!(!is_lock_file(Path::new("/a/.~lock.#")));
        assert!(!is_lock_file(Path::new("/a/.~lock.x")));
    }
}
