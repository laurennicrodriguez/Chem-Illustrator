// Data > Get Data > From Web: a page, CSV or JSON file read from the internet for a query. The
// page itself can't fetch from other sites (they don't allow it), so the app does, and hands
// back the bytes for the page to read the tables in. Only http and https addresses are read.

use std::time::Duration;

/// The largest answer read (a web table or data file, not a download of anything else).
const MAX_BYTES: usize = 50 * 1024 * 1024;

#[tauri::command]
pub async fn web_get(url: String) -> Result<tauri::ipc::Response, String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("Only http:// and https:// addresses can be read.".into());
    }
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("ChemIllustrator/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Could not get ready to read the address: {e}"))?;
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Could not read {url}: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("{url} answered with an error ({}).", res.status()));
    }
    if res.content_length().is_some_and(|n| n as usize > MAX_BYTES) {
        return Err("The answer is larger than 50 MB.".into());
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("Could not read {url}: {e}"))?;
    if bytes.len() > MAX_BYTES {
        return Err("The answer is larger than 50 MB.".into());
    }
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}
