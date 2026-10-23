// Windows' Open dialog, made "share-aware". Without that flag the dialog itself refuses a file
// another program has open (a .docx open in Word, a .pptx in PowerPoint) with "This file is in
// use", so the app never gets to read it and say where it is open. The reading itself works:
// Word and PowerPoint let other programs read the files they have open.

#[cfg(windows)]
mod win {
    use windows::core::{implement, Ref, HSTRING, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileDialog, IFileDialogEvents, IFileDialogEvents_Impl, IFileOpenDialog, IShellItem, FDE_OVERWRITE_RESPONSE, FDE_SHAREVIOLATION_RESPONSE, FDESVR_ACCEPT, FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST, FOS_SHAREAWARE, SIGDN_FILESYSPATH,
    };

    /// With FOS_SHAREAWARE the dialog hands a sharing violation to its event sink; without one it
    /// answers "Not implemented" for a file open in Word. Accepting lets the file through.
    #[implement(IFileDialogEvents)]
    struct Sink;

    impl IFileDialogEvents_Impl for Sink_Impl {
        fn OnFileOk(&self, _d: Ref<IFileDialog>) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnFolderChanging(&self, _d: Ref<IFileDialog>, _f: Ref<IShellItem>) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnFolderChange(&self, _d: Ref<IFileDialog>) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnSelectionChange(&self, _d: Ref<IFileDialog>) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnShareViolation(&self, _d: Ref<IFileDialog>, _i: Ref<IShellItem>) -> windows::core::Result<FDE_SHAREVIOLATION_RESPONSE> {
            Ok(FDESVR_ACCEPT)
        }
        fn OnTypeChange(&self, _d: Ref<IFileDialog>) -> windows::core::Result<()> {
            Ok(())
        }
        fn OnOverwrite(&self, _d: Ref<IFileDialog>, _i: Ref<IShellItem>) -> windows::core::Result<FDE_OVERWRITE_RESPONSE> {
            Ok(windows::Win32::UI::Shell::FDEOR_DEFAULT)
        }
    }

    /// The file picked, or None when the dialog was cancelled.
    pub fn pick(owner: HWND, names: &[String], patterns: &[String]) -> Result<Option<String>, String> {
        let err = |e: windows::core::Error| e.message();
        unsafe {
            // the window's thread already has COM set up; this only makes sure
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let d: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).map_err(err)?;
            let opts = d.GetOptions().map_err(err)?;
            d.SetOptions(opts | FOS_SHAREAWARE | FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST | FOS_FORCEFILESYSTEM).map_err(err)?;
            let names: Vec<HSTRING> = names.iter().map(HSTRING::from).collect();
            let patterns: Vec<HSTRING> = patterns.iter().map(HSTRING::from).collect();
            let specs: Vec<COMDLG_FILTERSPEC> = names
                .iter()
                .zip(&patterns)
                .map(|(n, p)| COMDLG_FILTERSPEC { pszName: PCWSTR(n.as_ptr()), pszSpec: PCWSTR(p.as_ptr()) })
                .collect();
            if !specs.is_empty() {
                d.SetFileTypes(&specs).map_err(err)?;
            }
            let sink: IFileDialogEvents = Sink.into();
            let cookie = d.Advise(&sink).map_err(err)?;
            // Show fails when the dialog is cancelled
            let shown = d.Show(Some(owner));
            let _ = d.Unadvise(cookie);
            if shown.is_err() {
                return Ok(None);
            }
            let item = d.GetResult().map_err(err)?;
            let p = item.GetDisplayName(SIGDN_FILESYSPATH).map_err(err)?;
            let path = p.to_string().map_err(|e| e.to_string());
            CoTaskMemFree(Some(p.0 as *const _));
            path.map(Some)
        }
    }
}

/// Ask for a file to open (Windows only). `names` and `patterns` are the dialog's file types,
/// such as "ChemDraw XML drawing" and "*.cdxml".
#[tauri::command]
pub fn open_shared_dialog(window: tauri::WebviewWindow, names: Vec<String>, patterns: Vec<String>) -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        let owner = window.hwnd().map_err(|e| e.to_string())?;
        return win::pick(windows::Win32::Foundation::HWND(owner.0), &names, &patterns);
    }
    #[cfg(not(windows))]
    {
        let _ = (window, names, patterns);
        Err("not available on this system".into())
    }
}
