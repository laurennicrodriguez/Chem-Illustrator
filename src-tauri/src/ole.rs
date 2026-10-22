// Structures in Word, PowerPoint and Excel that open here when double-clicked (Windows).
//
// The app registers its own kind of embedded object with Windows, for the person only
// (HKEY_CURRENT_USER, no administrator), the way any program's objects appear in Word's
// Insert > Object list. Written from Microsoft's published OLE documentation ("Compound
// Documents", IOleObject, IPersistStorage, IDataObject): nothing here comes from another program.
//
// - A drawing copied here goes on the clipboard as one of these objects ("Embed Source") as well
//   as the picture, so Word pastes an object that keeps the drawing (CDXML, in a "CDXML" stream).
// - Double-clicking it in Word starts this app (or reaches the running one) with the drawing,
//   which opens in a tab of its own. Saving that tab puts the drawing and a fresh picture back in
//   the Word document; closing the tab ends the editing.
//
// All the objects live on one thread of their own with its own message loop, as COM wants, so
// Word's calls never run inside the window's event loop.

use serde::Serialize;
use std::sync::Mutex;

/// A drawing Word (or another program) asked to edit here.
#[derive(Clone, Serialize)]
pub struct Edit {
    pub id: u32,
    pub cdxml: String,
    /// The program and document it lives in ("Microsoft Word", "Report.docx"), when they said.
    pub app: String,
    pub doc: String,
}

/// Edits asked for before the page was listening (the app was started by Word), and whether it
/// is listening now.
static WAITING: Mutex<(bool, Vec<Edit>)> = Mutex::new((false, Vec::new()));

/// Edits waiting for the page. It asks once, after it starts listening for more.
#[tauri::command]
pub fn ole_pending() -> Vec<Edit> {
    let mut w = WAITING.lock().unwrap();
    w.0 = true;
    std::mem::take(&mut w.1)
}

/// The page saved a drawing being edited for Word: the CDXML and its picture (an EMF), packed
/// as the clipboard commands pack formats, with the object's number in an "ole-id" header.
#[tauri::command(async)]
pub fn ole_save(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(block) = request.body() else {
        return Err("expected the drawing".into());
    };
    let id: u32 = request
        .headers()
        .get("ole-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or("no object given")?;
    let items = crate::clipboard::unpack(block)?;
    let get = |name: &str| items.iter().find(|(n, _)| n == name).map(|(_, d)| d.clone()).unwrap_or_default();
    let cdxml = String::from_utf8(get("CDXML")).map_err(|_| "the drawing is not text")?;
    let emf = get("EMF");
    #[cfg(windows)]
    return win::call(move || win::save(id, cdxml, emf));
    #[cfg(not(windows))]
    {
        let _ = (id, cdxml, emf);
        Err("Only the Windows app edits drawings in other programs.".into())
    }
}

/// The page closed the tab of a drawing being edited for Word.
#[tauri::command(async)]
pub fn ole_close(id: u32) -> Result<(), String> {
    #[cfg(windows)]
    return win::call(move || win::close(id, false));
    #[cfg(not(windows))]
    {
        let _ = id;
        Ok(())
    }
}

/// Whether the object type is registered (Windows); always false elsewhere.
#[tauri::command]
pub fn ole_registered() -> bool {
    #[cfg(windows)]
    {
        win::registered()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Register the object type with Windows, pointing at this copy of the app, or take it away.
#[tauri::command]
pub fn ole_register(on: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        if on {
            win::register()
        } else {
            win::unregister();
            Ok(())
        }
    }
    #[cfg(not(windows))]
    {
        let _ = on;
        Err("Only the Windows app puts editable drawings in other programs.".into())
    }
}

/// At start (Windows): run the object server, so Word can reach this app whether or not it
/// started the app itself.
pub fn start(app: &tauri::AppHandle) {
    #[cfg(windows)]
    win::start(app.clone());
    #[cfg(not(windows))]
    let _ = app;
}

/// Hand an edit to the page now if it is listening, or keep it until it asks.
#[cfg_attr(not(windows), allow(dead_code))]
fn hand_over(app: &tauri::AppHandle, edit: Edit) {
    use tauri::{Emitter, Manager};
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    let mut w = WAITING.lock().unwrap();
    if w.0 {
        drop(w);
        let _ = app.emit("ole-edit", edit);
    } else {
        w.1.push(edit);
    }
}

#[cfg(windows)]
pub(crate) mod win {
    use super::{hand_over, Edit};
    use crate::file_types::win::{delete_tree, exists, set_string};
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;
    use std::mem::ManuallyDrop;
    use std::sync::mpsc::{channel, Sender};
    use std::sync::{Mutex, OnceLock};
    use tauri::Emitter;
    use windows::core::{implement, w, ComObject, IUnknown, IUnknownImpl, Interface, Ref, BOOL, GUID, HRESULT, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{
        CLASS_E_NOAGGREGATION, DV_E_DVASPECT, DV_E_FORMATETC, E_FAIL, E_NOTIMPL, E_OUTOFMEMORY, HGLOBAL, HWND, LPARAM, OLE_E_BLANK,
        OLE_E_NOCONNECTION, POINTL, RECT, SIZE, S_FALSE, S_OK, WPARAM,
    };
    use windows::Win32::Graphics::Gdi::{DeleteEnhMetaFile, GetWinMetaFileBits, SetEnhMetaFileBits, SetMetaFileBitsEx, HDC, LOGPALETTE, MM_ANISOTROPIC};
    use windows::Win32::System::Com::StructuredStorage::{
        CreateILockBytesOnHGlobal, GetHGlobalFromILockBytes, IPersistStorage, IPersistStorage_Impl, IStorage, ReadClassStg,
        StgCreateDocfileOnILockBytes, StgOpenStorageOnILockBytes, WriteClassStg, WriteFmtUserTypeStg,
    };
    use windows::Win32::System::Com::{
        CoDisconnectObject, CoRegisterClassObject, CreateDataAdviseHolder, IAdviseSink, IClassFactory, IClassFactory_Impl, IDataAdviseHolder,
        IDataObject, IDataObject_Impl, IEnumFORMATETC, IEnumSTATDATA, IMoniker, IPersist_Impl, IStream, CLSCTX_LOCAL_SERVER, DVASPECT,
        DVASPECT_CONTENT, FORMATETC, REGCLS_MULTIPLEUSE, STGMEDIUM, STGMEDIUM_0, STGM_CREATE, STGM_DIRECT, STGM_READ, STGM_READWRITE,
        STGM_SHARE_EXCLUSIVE, STGM_WRITE, TYMED_ENHMF, TYMED_HGLOBAL, TYMED_MFPICT,
    };
    use windows::Win32::System::DataExchange::{RegisterClipboardFormatW, METAFILEPICT};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::{
        CreateOleAdviseHolder, IEnumOLEVERB, IOleAdviseHolder, IOleClientSite, IOleObject, IOleObject_Impl, OleInitialize, OleRegEnumFormatEtc,
        OleRegEnumVerbs, OleRegGetMiscStatus, OleRegGetUserType, CF_ENHMETAFILE, CF_METAFILEPICT, OBJECTDESCRIPTOR, OLECLOSE,
        OLECLOSE_NOSAVE, OLEGETMONIKER, OLEIVERB_HIDE, OLEMISC, OLEWHICHMK, USERCLASSTYPE,
    };
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{DispatchMessageW, GetMessageW, PeekMessageW, PostThreadMessageW, TranslateMessage, MSG, PM_NOREMOVE, WM_APP, WM_USER};

    /// The object type's class id: made for this app, used nowhere else.
    pub const CLSID: GUID = GUID::from_u128(0x171931c4_e8b6_4d52_a649_5d43133b5231);
    const CLSID_TEXT: &str = "{171931C4-E8B6-4D52-A649-5D43133B5231}";
    const PROG_ID: &str = "ChemIllustrator.Drawing";
    const NAME: &str = "Chem Illustrator Drawing";
    /// The clipboard format (and stream) the drawing travels in.
    const CDXML_FORMAT: &str = "Chem Illustrator CDXML";
    const STREAM: PCWSTR = w!("CDXML");

    fn cf_cdxml() -> u16 {
        unsafe { RegisterClipboardFormatW(w!("Chem Illustrator CDXML")) as u16 }
    }

    // ---- registration ----

    fn class_key() -> String {
        format!(r"Software\Classes\CLSID\{CLSID_TEXT}")
    }

    pub fn registered() -> bool {
        exists(&format!(r"{}\LocalServer32", class_key()), None)
    }

    pub fn register() -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|e| format!("Could not find the app: {e}"))?;
        let exe = exe.to_string_lossy();
        let c = class_key();
        let versioned = format!("{PROG_ID}.1");
        set_string(&c, None, NAME)?;
        set_string(&format!(r"{c}\LocalServer32"), None, &format!("\"{exe}\""))?;
        // Windows' own handler draws the object from its saved picture while the app isn't running
        set_string(&format!(r"{c}\InprocHandler32"), None, "ole32.dll")?;
        set_string(&format!(r"{c}\ProgID"), None, &versioned)?;
        set_string(&format!(r"{c}\VersionIndependentProgID"), None, PROG_ID)?;
        set_string(&format!(r"{c}\Insertable"), None, "")?;
        set_string(&format!(r"{c}\DefaultIcon"), None, &format!("\"{exe}\",0"))?;
        set_string(&format!(r"{c}\AuxUserType\2"), None, "Chem Illustrator")?;
        set_string(&format!(r"{c}\AuxUserType\3"), None, "Chem Illustrator")?;
        // 16: no links into part of a drawing; 512: draws the same on any printer or screen
        set_string(&format!(r"{c}\MiscStatus"), None, "528")?;
        // menu text, menu flags, verb flags (2: shown on the container's menu)
        set_string(&format!(r"{c}\Verb\0"), None, "&Edit,0,2")?;
        set_string(&format!(r"{c}\Verb\1"), None, "&Open,0,2")?;
        // format, aspect (1: content), medium (1 memory, 32 metafile, 64 enhanced metafile), direction (1 get, 3 get and set)
        set_string(&format!(r"{c}\DataFormats\DefaultFile"), None, CDXML_FORMAT)?;
        set_string(&format!(r"{c}\DataFormats\GetSet\0"), None, &format!("{CDXML_FORMAT},1,1,1"))?;
        set_string(&format!(r"{c}\DataFormats\GetSet\1"), None, "14,1,64,1")?;
        set_string(&format!(r"{c}\DataFormats\GetSet\2"), None, "3,1,32,1")?;
        for id in [PROG_ID, versioned.as_str()] {
            let k = format!(r"Software\Classes\{id}");
            set_string(&k, None, NAME)?;
            set_string(&format!(r"{k}\CLSID"), None, CLSID_TEXT)?;
            set_string(&format!(r"{k}\Insertable"), None, "")?;
        }
        set_string(&format!(r"Software\Classes\{PROG_ID}\CurVer"), None, &versioned)?;
        Ok(())
    }

    pub fn unregister() {
        delete_tree(&class_key());
        delete_tree(&format!(r"Software\Classes\{PROG_ID}"));
        delete_tree(&format!(r"Software\Classes\{PROG_ID}.1"));
    }

    // ---- the object thread ----

    type Job = Box<dyn FnOnce() + Send>;
    const WAKE: u32 = WM_APP + 0x31;
    static THREAD: OnceLock<(u32, Mutex<Sender<Job>>)> = OnceLock::new();
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    pub fn start(app: tauri::AppHandle) {
        let _ = APP.set(app);
        let (tx, rx) = channel::<Job>();
        let (ready_tx, ready_rx) = channel::<u32>();
        std::thread::Builder::new()
            .name("embedded drawings".into())
            .spawn(move || unsafe {
                let _ = OleInitialize(None);
                // make this thread's message queue before anyone posts to it
                let mut msg = MSG::default();
                let _ = PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
                let factory: IClassFactory = Factory.into();
                let registered = CoRegisterClassObject(&CLSID, &factory, CLSCTX_LOCAL_SERVER, REGCLS_MULTIPLEUSE).is_ok();
                let _ = ready_tx.send(if registered { GetCurrentThreadId() } else { 0 });
                if !registered {
                    return;
                }
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    if msg.hwnd.is_invalid() && msg.message == WAKE {
                        while let Ok(job) = rx.try_recv() {
                            job();
                        }
                        continue;
                    }
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            })
            .ok();
        if let Ok(id) = ready_rx.recv() {
            if id != 0 {
                let _ = THREAD.set((id, Mutex::new(tx)));
            }
        }
    }

    /// Run `job` on the object thread and wait for its answer.
    pub fn call(job: impl FnOnce() -> Result<(), String> + Send + 'static) -> Result<(), String> {
        let (id, tx) = THREAD.get().ok_or("Editing drawings for other programs isn't running.")?;
        let (done_tx, done_rx) = channel();
        tx.lock()
            .unwrap()
            .send(Box::new(move || {
                let _ = done_tx.send(job());
            }))
            .map_err(|_| "Editing drawings for other programs has stopped.")?;
        unsafe { PostThreadMessageW(*id, WAKE, WPARAM(0), LPARAM(0)) }.map_err(|e| e.to_string())?;
        done_rx
            .recv_timeout(std::time::Duration::from_secs(60))
            .map_err(|_| "The other program did not answer.".to_string())?
    }

    thread_local! {
        /// Drawings open for editing, by number.
        static OPEN: RefCell<HashMap<u32, ComObject<Embedded>>> = RefCell::new(HashMap::new());
        static NEXT: Cell<u32> = const { Cell::new(1) };
    }

    // ---- the class factory ----

    #[implement(IClassFactory)]
    struct Factory;

    impl IClassFactory_Impl for Factory_Impl {
        fn CreateInstance(&self, outer: Ref<IUnknown>, riid: *const GUID, ppv: *mut *mut core::ffi::c_void) -> windows::core::Result<()> {
            unsafe { *ppv = std::ptr::null_mut() };
            if outer.is_some() {
                return Err(CLASS_E_NOAGGREGATION.into());
            }
            let obj = ComObject::new(Embedded::default());
            let unk: IUnknown = obj.to_interface();
            unsafe { unk.query(riid, ppv).ok() }
        }

        fn LockServer(&self, _lock: BOOL) -> windows::core::Result<()> {
            Ok(())
        }
    }

    // ---- one embedded drawing ----

    #[derive(Default)]
    struct State {
        cdxml: String,
        emf: Vec<u8>,
        site: Option<IOleClientSite>,
        advise: Option<IOleAdviseHolder>,
        data_advise: Option<IDataAdviseHolder>,
        app: String,
        doc: String,
        /// its number while it is open in a tab
        open: Option<u32>,
        dirty: bool,
    }

    #[implement(IOleObject, IDataObject, IPersistStorage)]
    #[derive(Default)]
    struct Embedded {
        s: RefCell<State>,
    }

    fn text(p: &PCWSTR) -> String {
        if p.is_null() {
            String::new()
        } else {
            unsafe { p.to_string() }.unwrap_or_default()
        }
    }

    /// The picture's size in hundredths of a millimetre, from the EMF header's frame.
    fn extent(emf: &[u8]) -> Option<SIZE> {
        if emf.len() < 40 {
            return None;
        }
        let at = |i: usize| i32::from_le_bytes([emf[i], emf[i + 1], emf[i + 2], emf[i + 3]]);
        let (l, t, r, b) = (at(24), at(28), at(32), at(36));
        (r > l && b > t).then_some(SIZE { cx: r - l, cy: b - t })
    }

    fn global(bytes: &[u8]) -> windows::core::Result<HGLOBAL> {
        unsafe {
            let h = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1))?;
            let p = GlobalLock(h) as *mut u8;
            if p.is_null() {
                return Err(E_OUTOFMEMORY.into());
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
            let _ = GlobalUnlock(h);
            Ok(h)
        }
    }

    fn read_stream(stg: &IStorage) -> windows::core::Result<String> {
        let stream: IStream = unsafe { stg.OpenStream(STREAM, None, STGM_READ | STGM_SHARE_EXCLUSIVE, 0)? };
        let mut out = Vec::new();
        let mut buf = vec![0u8; 65536];
        loop {
            let mut got = 0u32;
            unsafe { stream.Read(buf.as_mut_ptr() as _, buf.len() as u32, Some(&mut got)).ok()? };
            if got == 0 {
                break;
            }
            out.extend_from_slice(&buf[..got as usize]);
        }
        Ok(String::from_utf8_lossy(&out).into_owned())
    }

    fn write_storage(stg: &IStorage, cdxml: &str) -> windows::core::Result<()> {
        unsafe {
            let stream = stg.CreateStream(STREAM, STGM_CREATE | STGM_WRITE | STGM_SHARE_EXCLUSIVE, 0, 0)?;
            let mut put = 0u32;
            stream.Write(cdxml.as_ptr() as _, cdxml.len() as u32, Some(&mut put)).ok()?;
            WriteClassStg(stg, &CLSID)?;
            let name: Vec<u16> = NAME.encode_utf16().chain(std::iter::once(0)).collect();
            WriteFmtUserTypeStg(stg, cf_cdxml(), PCWSTR(name.as_ptr()))?;
        }
        Ok(())
    }

    impl Embedded_Impl {
        fn advise_holder(&self) -> windows::core::Result<IOleAdviseHolder> {
            let mut s = self.s.borrow_mut();
            if s.advise.is_none() {
                s.advise = Some(unsafe { CreateOleAdviseHolder()? });
            }
            Ok(s.advise.clone().unwrap())
        }

        fn data_holder(&self) -> windows::core::Result<IDataAdviseHolder> {
            let mut s = self.s.borrow_mut();
            if s.data_advise.is_none() {
                s.data_advise = Some(unsafe { CreateDataAdviseHolder()? });
            }
            Ok(s.data_advise.clone().unwrap())
        }

        /// Open the drawing in a tab (or bring its tab forward).
        fn show(&self) -> windows::core::Result<()> {
            let (id, edit) = {
                let mut s = self.s.borrow_mut();
                match s.open {
                    Some(id) => (id, None),
                    None => {
                        let id = NEXT.with(|n| {
                            let id = n.get();
                            n.set(id + 1);
                            id
                        });
                        s.open = Some(id);
                        (id, Some(Edit { id, cdxml: s.cdxml.clone(), app: s.app.clone(), doc: s.doc.clone() }))
                    }
                }
            };
            if let Some(edit) = edit {
                OPEN.with(|o| o.borrow_mut().insert(id, self.to_object()));
                if let Some(app) = APP.get() {
                    hand_over(app, edit);
                }
            } else if let Some(app) = APP.get() {
                let _ = app.emit("ole-show", id);
            }
            let site = self.s.borrow().site.clone();
            if let Some(site) = site {
                unsafe {
                    let _ = site.ShowObject();
                    let _ = site.OnShowWindow(true);
                }
            }
            Ok(())
        }
    }

    /// Put a saved drawing back in its document.
    pub fn save(id: u32, cdxml: String, emf: Vec<u8>) -> Result<(), String> {
        let obj = OPEN.with(|o| o.borrow().get(&id).cloned()).ok_or("This drawing is no longer open in the other program.")?;
        {
            let mut s = obj.s.borrow_mut();
            s.cdxml = cdxml;
            if !emf.is_empty() {
                s.emf = emf;
            }
            s.dirty = true;
        }
        let (site, data, advise) = {
            let s = obj.s.borrow();
            (s.site.clone(), s.data_advise.clone(), s.advise.clone())
        };
        let me: IDataObject = obj.to_interface();
        unsafe {
            // the document's picture first, then the drawing itself
            if let Some(d) = data {
                let _ = d.SendOnDataChange(&me, None, 0);
            }
            let site = site.ok_or("The other program has let go of this drawing.")?;
            site.SaveObject().map_err(|e| format!("The other program did not take the drawing: {}", e.message()))?;
            if let Some(a) = advise {
                let _ = a.SendOnSave();
            }
        }
        Ok(())
    }

    /// The drawing's tab closed (`from_container`: the other program closed it).
    pub fn close(id: u32, from_container: bool) -> Result<(), String> {
        let Some(obj) = OPEN.with(|o| o.borrow_mut().remove(&id)) else { return Ok(()) };
        let (site, advise) = {
            let mut s = obj.s.borrow_mut();
            s.open = None;
            (s.site.clone(), s.advise.clone())
        };
        if from_container {
            if let Some(app) = APP.get() {
                let _ = app.emit("ole-closed", id);
            }
        }
        unsafe {
            if let Some(site) = site {
                let _ = site.OnShowWindow(false);
            }
            if let Some(a) = advise {
                let _ = a.SendOnClose();
            }
            // closed here: cut Word's link to it (Word lets go of it itself when it closes it)
            if !from_container {
                let unk: IUnknown = obj.to_interface();
                let _ = CoDisconnectObject(&unk, None);
            }
        }
        Ok(())
    }

    impl IOleObject_Impl for Embedded_Impl {
        fn SetClientSite(&self, site: Ref<IOleClientSite>) -> windows::core::Result<()> {
            self.s.borrow_mut().site = site.cloned();
            Ok(())
        }
        fn GetClientSite(&self) -> windows::core::Result<IOleClientSite> {
            self.s.borrow().site.clone().ok_or_else(|| E_FAIL.into())
        }
        fn SetHostNames(&self, app: &PCWSTR, doc: &PCWSTR) -> windows::core::Result<()> {
            let mut s = self.s.borrow_mut();
            s.app = text(app);
            s.doc = text(doc);
            Ok(())
        }
        fn Close(&self, option: &OLECLOSE) -> windows::core::Result<()> {
            let (id, dirty, site) = {
                let s = self.s.borrow();
                (s.open, s.dirty, s.site.clone())
            };
            if dirty && *option != OLECLOSE_NOSAVE {
                if let Some(site) = site {
                    let _ = unsafe { site.SaveObject() };
                }
            }
            if let Some(id) = id {
                let _ = close(id, true);
            }
            Ok(())
        }
        fn SetMoniker(&self, _which: &OLEWHICHMK, _mk: Ref<IMoniker>) -> windows::core::Result<()> {
            Ok(())
        }
        fn GetMoniker(&self, _assign: &OLEGETMONIKER, _which: &OLEWHICHMK) -> windows::core::Result<IMoniker> {
            Err(E_NOTIMPL.into())
        }
        fn InitFromData(&self, _data: Ref<IDataObject>, _creation: BOOL, _reserved: u32) -> windows::core::Result<()> {
            Err(E_NOTIMPL.into())
        }
        fn GetClipboardData(&self, _reserved: u32) -> windows::core::Result<IDataObject> {
            Err(E_NOTIMPL.into())
        }
        fn DoVerb(&self, verb: i32, _msg: *const MSG, _site: Ref<IOleClientSite>, _lindex: i32, _parent: HWND, _rect: *const RECT) -> windows::core::Result<()> {
            if verb == OLEIVERB_HIDE.0 {
                return Ok(());
            }
            // Edit, Open, Show and the primary verb all open the drawing here
            self.show()
        }
        fn EnumVerbs(&self) -> windows::core::Result<IEnumOLEVERB> {
            unsafe { OleRegEnumVerbs(&CLSID) }
        }
        fn Update(&self) -> windows::core::Result<()> {
            Ok(())
        }
        fn IsUpToDate(&self) -> windows::core::Result<()> {
            Ok(())
        }
        fn GetUserClassID(&self) -> windows::core::Result<GUID> {
            Ok(CLSID)
        }
        fn GetUserType(&self, form: &USERCLASSTYPE) -> windows::core::Result<PWSTR> {
            unsafe { OleRegGetUserType(&CLSID, *form) }
        }
        fn SetExtent(&self, _aspect: DVASPECT, _size: *const SIZE) -> windows::core::Result<()> {
            // the drawing keeps its own size; the document scales the picture
            Err(E_FAIL.into())
        }
        fn GetExtent(&self, aspect: DVASPECT) -> windows::core::Result<SIZE> {
            if aspect != DVASPECT_CONTENT {
                return Err(DV_E_DVASPECT.into());
            }
            extent(&self.s.borrow().emf).ok_or_else(|| OLE_E_BLANK.into())
        }
        fn Advise(&self, sink: Ref<IAdviseSink>) -> windows::core::Result<u32> {
            let h = self.advise_holder()?;
            unsafe { h.Advise(sink.as_ref()) }
        }
        fn Unadvise(&self, connection: u32) -> windows::core::Result<()> {
            let h = self.s.borrow().advise.clone().ok_or_else(|| windows::core::Error::from(OLE_E_NOCONNECTION))?;
            unsafe { h.Unadvise(connection) }
        }
        fn EnumAdvise(&self) -> windows::core::Result<IEnumSTATDATA> {
            let h = self.advise_holder()?;
            unsafe { h.EnumAdvise() }
        }
        fn GetMiscStatus(&self, aspect: DVASPECT) -> windows::core::Result<OLEMISC> {
            unsafe { OleRegGetMiscStatus(&CLSID, aspect.0) }.map(|m| OLEMISC(m as i32))
        }
        fn SetColorScheme(&self, _palette: *const LOGPALETTE) -> windows::core::Result<()> {
            Err(E_NOTIMPL.into())
        }
    }

    impl IDataObject_Impl for Embedded_Impl {
        fn GetData(&self, f: *const FORMATETC) -> windows::core::Result<STGMEDIUM> {
            let f = unsafe { f.as_ref() }.ok_or_else(|| windows::core::Error::from(DV_E_FORMATETC))?;
            if f.dwAspect != DVASPECT_CONTENT.0 {
                return Err(DV_E_DVASPECT.into());
            }
            let s = self.s.borrow();
            let medium = |tymed: i32, u: STGMEDIUM_0| STGMEDIUM { tymed: tymed as u32, u, pUnkForRelease: ManuallyDrop::new(None) };
            if f.cfFormat == cf_cdxml() && f.tymed & TYMED_HGLOBAL.0 as u32 != 0 {
                return Ok(medium(TYMED_HGLOBAL.0, STGMEDIUM_0 { hGlobal: global(s.cdxml.as_bytes())? }));
            }
            if s.emf.is_empty() {
                return Err(OLE_E_BLANK.into());
            }
            if f.cfFormat == CF_ENHMETAFILE.0 && f.tymed & TYMED_ENHMF.0 as u32 != 0 {
                let h = unsafe { SetEnhMetaFileBits(&s.emf) };
                if h.is_invalid() {
                    return Err(E_OUTOFMEMORY.into());
                }
                return Ok(medium(TYMED_ENHMF.0, STGMEDIUM_0 { hEnhMetaFile: h }));
            }
            if f.cfFormat == CF_METAFILEPICT.0 && f.tymed & TYMED_MFPICT.0 as u32 != 0 {
                // an old-style metafile for programs that want one, made by Windows from the EMF
                let size = extent(&s.emf).ok_or_else(|| windows::core::Error::from(OLE_E_BLANK))?;
                unsafe {
                    let emf = SetEnhMetaFileBits(&s.emf);
                    let n = GetWinMetaFileBits(emf, None, MM_ANISOTROPIC.0, HDC::default());
                    let mut bits = vec![0u8; n as usize];
                    let got = if n > 0 { GetWinMetaFileBits(emf, Some(&mut bits), MM_ANISOTROPIC.0, HDC::default()) } else { 0 };
                    let _ = DeleteEnhMetaFile(Some(emf));
                    if got == 0 {
                        return Err(E_FAIL.into());
                    }
                    let wmf = SetMetaFileBitsEx(&bits);
                    let pict = METAFILEPICT { mm: MM_ANISOTROPIC.0, xExt: size.cx, yExt: size.cy, hMF: wmf };
                    let bytes = std::slice::from_raw_parts(&pict as *const _ as *const u8, std::mem::size_of::<METAFILEPICT>());
                    let h = global(bytes)?;
                    return Ok(medium(TYMED_MFPICT.0, STGMEDIUM_0 { hMetaFilePict: h.0 }));
                }
            }
            Err(DV_E_FORMATETC.into())
        }
        fn GetDataHere(&self, _f: *const FORMATETC, _m: *mut STGMEDIUM) -> windows::core::Result<()> {
            Err(E_NOTIMPL.into())
        }
        fn QueryGetData(&self, f: *const FORMATETC) -> HRESULT {
            let Some(f) = (unsafe { f.as_ref() }) else { return DV_E_FORMATETC };
            if f.dwAspect != DVASPECT_CONTENT.0 {
                return DV_E_DVASPECT;
            }
            let ok = (f.cfFormat == cf_cdxml() && f.tymed & TYMED_HGLOBAL.0 as u32 != 0)
                || (f.cfFormat == CF_ENHMETAFILE.0 && f.tymed & TYMED_ENHMF.0 as u32 != 0)
                || (f.cfFormat == CF_METAFILEPICT.0 && f.tymed & TYMED_MFPICT.0 as u32 != 0);
            if ok {
                S_OK
            } else {
                DV_E_FORMATETC
            }
        }
        fn GetCanonicalFormatEtc(&self, _in: *const FORMATETC, out: *mut FORMATETC) -> HRESULT {
            if let Some(out) = unsafe { out.as_mut() } {
                out.ptd = std::ptr::null_mut();
            }
            windows::Win32::Foundation::DATA_S_SAMEFORMATETC
        }
        fn SetData(&self, _f: *const FORMATETC, _m: *const STGMEDIUM, _release: BOOL) -> windows::core::Result<()> {
            Err(E_NOTIMPL.into())
        }
        fn EnumFormatEtc(&self, direction: u32) -> windows::core::Result<IEnumFORMATETC> {
            unsafe { OleRegEnumFormatEtc(&CLSID, direction) }
        }
        fn DAdvise(&self, f: *const FORMATETC, advf: u32, sink: Ref<IAdviseSink>) -> windows::core::Result<u32> {
            let h = self.data_holder()?;
            let me: IDataObject = self.to_interface();
            unsafe { h.Advise(&me, f, advf, sink.as_ref()) }
        }
        fn DUnadvise(&self, connection: u32) -> windows::core::Result<()> {
            let h = self.s.borrow().data_advise.clone().ok_or_else(|| windows::core::Error::from(OLE_E_NOCONNECTION))?;
            unsafe { h.Unadvise(connection) }
        }
        fn EnumDAdvise(&self) -> windows::core::Result<IEnumSTATDATA> {
            let h = self.data_holder()?;
            unsafe { h.EnumAdvise() }
        }
    }

    impl IPersist_Impl for Embedded_Impl {
        fn GetClassID(&self) -> windows::core::Result<GUID> {
            Ok(CLSID)
        }
    }

    impl IPersistStorage_Impl for Embedded_Impl {
        fn IsDirty(&self) -> HRESULT {
            if self.s.borrow().dirty {
                S_OK
            } else {
                S_FALSE
            }
        }
        fn InitNew(&self, _stg: Ref<IStorage>) -> windows::core::Result<()> {
            // a new, empty drawing (Insert > Object in Word)
            self.s.borrow_mut().cdxml.clear();
            Ok(())
        }
        fn Load(&self, stg: Ref<IStorage>) -> windows::core::Result<()> {
            let stg = stg.ok()?;
            let cdxml = read_stream(stg)?;
            self.s.borrow_mut().cdxml = cdxml;
            Ok(())
        }
        fn Save(&self, stg: Ref<IStorage>, _same: BOOL) -> windows::core::Result<()> {
            let stg = stg.ok()?;
            let cdxml = self.s.borrow().cdxml.clone();
            write_storage(stg, &cdxml)
        }
        fn SaveCompleted(&self, _stg: Ref<IStorage>) -> windows::core::Result<()> {
            self.s.borrow_mut().dirty = false;
            let advise = self.s.borrow().advise.clone();
            if let Some(a) = advise {
                let _ = unsafe { a.SendOnSave() };
            }
            Ok(())
        }
        fn HandsOffStorage(&self) -> windows::core::Result<()> {
            Ok(())
        }
    }

    // ---- the clipboard ----

    /// "Embed Source": an object holding this drawing, as a compound file in memory, which
    /// Word pastes as one of our objects.
    pub fn embed_source(cdxml: &[u8]) -> Result<HGLOBAL, String> {
        let fail = |e: windows::core::Error| format!("The drawing could not be copied as an object: {}", e.message());
        unsafe {
            let bytes = CreateILockBytesOnHGlobal(None, false).map_err(fail)?;
            let stg = StgCreateDocfileOnILockBytes(&bytes, STGM_CREATE | STGM_READWRITE | STGM_SHARE_EXCLUSIVE | STGM_DIRECT, 0).map_err(fail)?;
            write_storage(&stg, &String::from_utf8_lossy(cdxml)).map_err(fail)?;
            stg.Commit(0).map_err(fail)?;
            drop(stg);
            GetHGlobalFromILockBytes(&bytes).map_err(fail)
        }
    }

    /// "Object Descriptor": what the object is and how big (`size`: hundredths of a millimetre).
    pub fn object_descriptor(size: SIZE) -> Vec<u8> {
        let name: Vec<u16> = NAME.encode_utf16().chain(std::iter::once(0)).collect();
        let source: Vec<u16> = "Chem Illustrator".encode_utf16().chain(std::iter::once(0)).collect();
        let head = std::mem::size_of::<OBJECTDESCRIPTOR>();
        let d = OBJECTDESCRIPTOR {
            cbSize: (head + 2 * (name.len() + source.len())) as u32,
            clsid: CLSID,
            dwDrawAspect: DVASPECT_CONTENT.0,
            sizel: size,
            pointl: POINTL::default(),
            dwStatus: 528,
            dwFullUserTypeName: head as u32,
            dwSrcOfCopy: (head + 2 * name.len()) as u32,
        };
        let mut out = unsafe { std::slice::from_raw_parts(&d as *const _ as *const u8, head) }.to_vec();
        out.extend(name.iter().flat_map(|u| u.to_le_bytes()));
        out.extend(source.iter().flat_map(|u| u.to_le_bytes()));
        out
    }

    /// The drawing inside "Embed Source" from the clipboard, if it is one of ours.
    pub fn drawing_in(h: HGLOBAL) -> Option<Vec<u8>> {
        unsafe {
            // a copy, so the clipboard's own memory is left alone
            let p = GlobalLock(h) as *const u8;
            if p.is_null() {
                return None;
            }
            let data = std::slice::from_raw_parts(p, GlobalSize(h)).to_vec();
            let _ = GlobalUnlock(h);
            let copy = global(&data).ok()?;
            let bytes = CreateILockBytesOnHGlobal(Some(copy), true).ok()?;
            let stg: IStorage = StgOpenStorageOnILockBytes(&bytes, None, STGM_READ | STGM_SHARE_EXCLUSIVE, None, None).ok()?;
            if ReadClassStg(&stg).ok()? != CLSID {
                return None;
            }
            read_stream(&stg).ok().map(String::into_bytes)
        }
    }
}
