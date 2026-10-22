// The Windows clipboard. Web pages can only put text and PNG pictures on the clipboard, but
// Word and PowerPoint want a vector picture (EMF) and ChemDraw wants its own format, so on
// Windows the page hands the data to these commands. Other systems use the page's clipboard.
//
// The page sends one block of bytes holding every format: a count, then for each format its
// name and data, each preceded by its length (32-bit little-endian). Format names are the
// registered clipboard names ("ChemDraw Interchange Format"), or "CF_ENHMETAFILE", "CF_DIB"
// and "CF_UNICODETEXT" for the built-in formats used here. Formats are put on the clipboard
// in the order given, most detailed first, since programs take the first one they know.

/// Split the block the page sent into (name, data) pairs.
pub fn unpack(block: &[u8]) -> Result<Vec<(String, Vec<u8>)>, String> {
    fn take<'a>(block: &'a [u8], at: &mut usize, n: usize) -> Result<&'a [u8], String> {
        let end = at.checked_add(n).filter(|&e| e <= block.len()).ok_or("clipboard data is cut short")?;
        let s = &block[*at..end];
        *at = end;
        Ok(s)
    }
    fn len(block: &[u8], at: &mut usize) -> Result<usize, String> {
        let b = take(block, at, 4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
    }
    let mut at = 0usize;
    let count = len(block, &mut at)?;
    let mut out = Vec::with_capacity(count.min(16));
    for _ in 0..count {
        let n = len(block, &mut at)?;
        let name = String::from_utf8(take(block, &mut at, n)?.to_vec()).map_err(|_| "bad format name")?;
        let n = len(block, &mut at)?;
        out.push((name, take(block, &mut at, n)?.to_vec()));
    }
    Ok(out)
}

/// One (name, data) pair in the same layout, for sending clipboard contents back to the page.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn pack(name: &str, data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(12 + name.len() + data.len());
    out.extend_from_slice(&1u32.to_le_bytes());
    out.extend_from_slice(&(name.len() as u32).to_le_bytes());
    out.extend_from_slice(name.as_bytes());
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(data);
    out
}

#[cfg(windows)]
mod win {
    use std::ffi::c_void;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{GlobalFree, HANDLE, HWND};
    use windows_sys::Win32::Graphics::Gdi::{DeleteEnhMetaFile, GetEnhMetaFileBits, SetEnhMetaFileBits};
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData, GetClipboardFormatNameW,
        IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};

    const CF_DIB: u32 = 8;
    const CF_UNICODETEXT: u32 = 13;
    const CF_ENHMETAFILE: u32 = 14;

    /// The clipboard, open for as long as this lives.
    struct Open;
    impl Open {
        fn new(owner: HWND) -> Result<Open, String> {
            // another program may be using it for a moment
            for _ in 0..20 {
                if unsafe { OpenClipboard(owner) } != 0 {
                    return Ok(Open);
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            Err("The clipboard is being used by another program. Try again.".into())
        }
    }
    impl Drop for Open {
        fn drop(&mut self) {
            unsafe { CloseClipboard() };
        }
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn format_id(name: &str) -> u32 {
        match name {
            "CF_DIB" => CF_DIB,
            "CF_UNICODETEXT" => CF_UNICODETEXT,
            "CF_ENHMETAFILE" => CF_ENHMETAFILE,
            // another program's object as it is (a compound file), for Paste as Object
            "Embedded Object" => unsafe { RegisterClipboardFormatW(wide("Embed Source").as_ptr()) },
            _ => unsafe { RegisterClipboardFormatW(wide(name).as_ptr()) },
        }
    }

    fn global(bytes: &[u8]) -> Result<HANDLE, String> {
        unsafe {
            let h = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1));
            if h.is_null() {
                return Err("Not enough memory to copy".into());
            }
            let p = GlobalLock(h) as *mut u8;
            if p.is_null() {
                GlobalFree(h);
                return Err("Not enough memory to copy".into());
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
            GlobalUnlock(h);
            Ok(h)
        }
    }

    pub fn write(owner: *mut c_void, items: &[(String, Vec<u8>)]) -> Result<(), String> {
        let _open = Open::new(owner)?;
        unsafe { EmptyClipboard() };
        for (name, data) in items {
            let id = format_id(name);
            if id == 0 {
                continue;
            }
            unsafe {
                if name == "Embed Source" {
                    // our own object, made from the drawing (see ole.rs)
                    let h = crate::ole::win::embed_source(data)?;
                    if SetClipboardData(id, h.0).is_null() {
                        GlobalFree(h.0);
                    }
                } else if id == CF_ENHMETAFILE {
                    let emf = SetEnhMetaFileBits(data.len() as u32, data.as_ptr());
                    if emf.is_null() {
                        return Err("The picture could not be copied".into());
                    }
                    if SetClipboardData(id, emf).is_null() {
                        DeleteEnhMetaFile(emf);
                    }
                } else {
                    let bytes: Vec<u8> = if name == "Object Descriptor" {
                        // sent as the picture's width and height in hundredths of a millimetre
                        let at = |i: usize| data.get(i..i + 4).map_or(0, |b| i32::from_le_bytes([b[0], b[1], b[2], b[3]]));
                        crate::ole::win::object_descriptor(windows::Win32::Foundation::SIZE { cx: at(0), cy: at(4) })
                    } else if id == CF_UNICODETEXT {
                        let text = String::from_utf8_lossy(data);
                        wide(&text).iter().flat_map(|u| u.to_le_bytes()).collect()
                    } else {
                        data.clone()
                    };
                    let h = global(&bytes)?;
                    if SetClipboardData(id, h).is_null() {
                        GlobalFree(h);
                    }
                }
            }
        }
        Ok(())
    }

    /// The data of the first of `names` that is on the clipboard.
    pub fn read(owner: *mut c_void, names: &[String]) -> Result<Option<(String, Vec<u8>)>, String> {
        let _open = Open::new(owner)?;
        for name in names {
            let id = format_id(name);
            if id == 0 || unsafe { IsClipboardFormatAvailable(id) } == 0 {
                continue;
            }
            unsafe {
                let h = GetClipboardData(id);
                if h.is_null() {
                    continue;
                }
                if id == CF_ENHMETAFILE {
                    // a metafile is a handle, not memory: ask for its bytes (an EMF file)
                    let n = GetEnhMetaFileBits(h, 0, null_mut());
                    if n == 0 {
                        continue;
                    }
                    let mut bytes = vec![0u8; n as usize];
                    if GetEnhMetaFileBits(h, n, bytes.as_mut_ptr()) == 0 {
                        continue;
                    }
                    return Ok(Some((name.clone(), bytes)));
                }
                if name == "Embed Source" {
                    // the drawing inside one of our objects (copied from Word); other programs' objects are skipped
                    match crate::ole::win::drawing_in(windows::Win32::Foundation::HGLOBAL(h)) {
                        Some(cdxml) => return Ok(Some((name.clone(), cdxml))),
                        None => continue,
                    }
                }
                let p = GlobalLock(h) as *const u8;
                if p.is_null() {
                    continue;
                }
                let mut bytes = std::slice::from_raw_parts(p, GlobalSize(h)).to_vec();
                GlobalUnlock(h);
                if id == CF_UNICODETEXT {
                    let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|&u| u != 0).collect();
                    bytes = String::from_utf16_lossy(&units).into_bytes();
                }
                return Ok(Some((name.clone(), bytes)));
            }
        }
        Ok(None)
    }

    /// Names of the formats on the clipboard (to find out what another program copied).
    pub fn formats(owner: *mut c_void) -> Result<Vec<String>, String> {
        let _open = Open::new(owner)?;
        let mut out = Vec::new();
        let mut id = 0u32;
        loop {
            id = unsafe { EnumClipboardFormats(id) };
            if id == 0 {
                break;
            }
            let mut buf = [0u16; 256];
            let n = unsafe { GetClipboardFormatNameW(id, buf.as_mut_ptr(), buf.len() as i32) };
            out.push(if n > 0 { String::from_utf16_lossy(&buf[..n as usize]) } else { format!("#{id}") });
        }
        Ok(out)
    }

    pub fn null() -> *mut c_void {
        null_mut()
    }
}

#[cfg(windows)]
fn owner(window: &tauri::WebviewWindow) -> *mut std::ffi::c_void {
    window.hwnd().map(|h| h.0 as *mut std::ffi::c_void).unwrap_or(win::null())
}

/// Put pictures, ChemDraw data and text on the clipboard (Windows only).
#[tauri::command]
pub fn clipboard_write(window: tauri::WebviewWindow, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(block) = request.body() else {
        return Err("expected clipboard data".into());
    };
    let items = unpack(block)?;
    #[cfg(windows)]
    return win::write(owner(&window), &items);
    #[cfg(not(windows))]
    {
        let _ = (window, items);
        Err("not available on this system".into())
    }
}

/// The first of the named formats found on the clipboard, packed as (name, data); empty if none.
#[tauri::command]
pub fn clipboard_read(window: tauri::WebviewWindow, names: Vec<String>) -> Result<tauri::ipc::Response, String> {
    #[cfg(windows)]
    return Ok(tauri::ipc::Response::new(match win::read(owner(&window), &names)? {
        Some((name, data)) => pack(&name, &data),
        None => Vec::new(),
    }));
    #[cfg(not(windows))]
    {
        let _ = (window, names);
        Ok(tauri::ipc::Response::new(Vec::new()))
    }
}

/// Names of the formats on the clipboard.
#[tauri::command]
pub fn clipboard_formats(window: tauri::WebviewWindow) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    return win::formats(owner(&window));
    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packs_and_unpacks() {
        let block = pack("PNG", &[1, 2, 3]);
        assert_eq!(unpack(&block).unwrap(), vec![("PNG".to_string(), vec![1, 2, 3])]);
        assert!(unpack(&block[..block.len() - 1]).is_err());
    }
}
