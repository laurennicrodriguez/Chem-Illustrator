// Opening files from outside the app (double-click in Explorer or Finder, "Open with", or a file
// dropped on the app's icon), and on Windows the file types it offers to open.
//
// On Windows the app adds itself to each chosen type's "Open with" list, for the person only
// (HKEY_CURRENT_USER, no administrator), and lists itself under Default apps so the person can
// make it the default there. It never makes itself the default: Windows keeps that choice for the
// person, and asks them to confirm it. Written from Microsoft's documentation on file types
// ("Registering an Application for Use with File Types", "Default Programs").
// On macOS and Linux the installer lists the types (tauri.macos.conf.json, tauri.linux.conf.json).

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// The types the Settings page offers, with what Windows calls them.
pub const TYPES: &[(&str, &str)] = &[
    ("cdxml", "ChemDraw XML drawing"),
    ("cdx", "ChemDraw drawing"),
    ("mol", "MDL Molfile"),
    ("sdf", "Structure-data file"),
    ("docx", "Word document"),
    ("pptx", "PowerPoint presentation"),
    ("xlsx", "Excel workbook"),
];

/// Files to open, kept until the page asks for them (it may still be loading). Once it has
/// asked, it is listening, and later files go straight to it.
#[derive(Default)]
pub struct Waiting(Mutex<(bool, Vec<String>)>);

/// The files named on a command line (the first item is the program itself; options are skipped).
pub fn files_in(args: impl IntoIterator<Item = String>, cwd: Option<&std::path::Path>) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(&a);
            match cwd {
                Some(c) if p.is_relative() => c.join(p).to_string_lossy().into_owned(),
                _ => a,
            }
        })
        .filter(|p| std::path::Path::new(p).is_file())
        .collect()
}

/// Files to open: to the page now if it is listening, or kept for it while it is still loading.
pub fn open_files(app: &tauri::AppHandle, files: Vec<String>) {
    if files.is_empty() {
        return;
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    let Some(waiting) = app.try_state::<Waiting>() else { return };
    let mut w = waiting.0.lock().unwrap();
    if w.0 {
        drop(w);
        let _ = app.emit("open-files", files);
    } else {
        w.1.extend(files);
    }
}

/// The files waiting to be opened. The page asks once, after it starts listening for more.
#[tauri::command]
pub fn launch_files(waiting: tauri::State<'_, Waiting>) -> Vec<String> {
    let mut w = waiting.0.lock().unwrap();
    w.0 = true;
    std::mem::take(&mut w.1)
}

/// The types this app is in the "Open with" list for (Windows); empty elsewhere.
#[tauri::command]
pub fn file_types_get() -> Vec<String> {
    #[cfg(windows)]
    {
        win::registered()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Offer to open exactly these types (Windows): added to their "Open with" lists, and taken off
/// the others.
#[tauri::command]
pub fn file_types_set(types: Vec<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        win::set(&types)
    }
    #[cfg(not(windows))]
    {
        let _ = types;
        Err("Only the Windows app sets its file types here.".into())
    }
}

/// Open Windows' Default apps page at this app, where the person can make it the default.
#[tauri::command]
pub fn file_types_defaults() -> Result<(), String> {
    #[cfg(windows)]
    {
        win::open_default_apps()
    }
    #[cfg(not(windows))]
    {
        Err("Only Windows has a Default apps page.".into())
    }
}

/// At start: point registered types at this copy of the app (it may have moved or been updated).
pub fn refresh() {
    #[cfg(windows)]
    {
        let now = win::registered();
        if !now.is_empty() {
            let _ = win::set(&now);
        }
    }
}

#[cfg(windows)]
mod win {
    use super::TYPES;
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegDeleteKeyValueW, RegDeleteTreeW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ, RRF_RT_ANY,
    };
    use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};

    const APP: &str = "Chem Illustrator";
    const CAPABILITIES: &str = r"Software\Chem Illustrator\Capabilities";

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn prog_id(ext: &str) -> String {
        format!("ChemIllustrator.{ext}")
    }

    fn set_string(key: &str, name: Option<&str>, value: &str) -> Result<(), String> {
        let k = wide(key);
        let n = name.map(wide);
        let v = wide(value);
        let r = unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                k.as_ptr(),
                n.as_ref().map_or(std::ptr::null(), |n| n.as_ptr()),
                REG_SZ,
                v.as_ptr() as *const c_void,
                (v.len() * 2) as u32,
            )
        };
        if r == ERROR_SUCCESS {
            Ok(())
        } else {
            Err(format!("Windows would not record {key} (error {r})."))
        }
    }

    fn exists(key: &str, name: Option<&str>) -> bool {
        let k = wide(key);
        let n = name.map(wide);
        let r = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                k.as_ptr(),
                n.as_ref().map_or(std::ptr::null(), |n| n.as_ptr()),
                RRF_RT_ANY,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        r == ERROR_SUCCESS
    }

    fn delete_tree(key: &str) {
        let k = wide(key);
        unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, k.as_ptr()) };
    }

    fn delete_value(key: &str, name: &str) {
        let k = wide(key);
        let n = wide(name);
        unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr()) };
    }

    pub fn registered() -> Vec<String> {
        TYPES
            .iter()
            .filter(|(ext, _)| exists(&format!(r"Software\Classes\.{ext}\OpenWithProgids"), Some(&prog_id(ext))))
            .map(|(ext, _)| ext.to_string())
            .collect()
    }

    pub fn set(types: &[String]) -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|e| format!("Could not find the app: {e}"))?;
        let exe = exe.to_string_lossy();
        let mut any = false;
        for (ext, what) in TYPES {
            let id = prog_id(ext);
            let class = format!(r"Software\Classes\{id}");
            if types.iter().any(|t| t == ext) {
                any = true;
                set_string(&class, None, what)?;
                set_string(&format!(r"{class}\DefaultIcon"), None, &format!("\"{exe}\",0"))?;
                set_string(&format!(r"{class}\shell\open\command"), None, &format!("\"{exe}\" \"%1\""))?;
                set_string(&format!(r"Software\Classes\.{ext}\OpenWithProgids"), Some(&id), "")?;
                set_string(&format!(r"{CAPABILITIES}\FileAssociations"), Some(&format!(".{ext}")), &id)?;
            } else {
                delete_value(&format!(r"Software\Classes\.{ext}\OpenWithProgids"), &id);
                delete_value(&format!(r"{CAPABILITIES}\FileAssociations"), &format!(".{ext}"));
                delete_tree(&class);
            }
        }
        if any {
            set_string(CAPABILITIES, Some("ApplicationName"), APP)?;
            set_string(CAPABILITIES, Some("ApplicationDescription"), "Chemical structures, schemes, slides, sheets and documents")?;
            set_string(r"Software\RegisteredApplications", Some(APP), CAPABILITIES)?;
        } else {
            delete_value(r"Software\RegisteredApplications", APP);
            delete_tree(r"Software\Chem Illustrator");
        }
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED as _, SHCNF_IDLIST, std::ptr::null(), std::ptr::null()) };
        Ok(())
    }

    pub fn open_default_apps() -> Result<(), String> {
        // Windows 11 opens the app's own page; older versions open the Default apps list
        std::process::Command::new("explorer.exe")
            .arg("ms-settings:defaultapps?registeredAppUser=Chem%20Illustrator")
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not open Windows Settings: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::files_in;

    #[test]
    fn takes_files_from_the_command_line() {
        let dir = std::env::temp_dir().join("ci-file-types-test");
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a b.cdxml");
        std::fs::write(&f, "<CDXML/>").unwrap();
        let args = vec!["app".to_string(), "--flag".to_string(), "a b.cdxml".to_string(), "missing.mol".to_string()];
        assert_eq!(files_in(args, Some(&dir)), vec![f.to_string_lossy().into_owned()]);
    }
}
