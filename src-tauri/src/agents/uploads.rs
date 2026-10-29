//! Images attached to a message: saved under `<app data>/agent-uploads/` and referred to
//! by path in the message text, so the agent can open them.

use base64::Engine;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub const DIR: &str = "agent-uploads";
pub const MAX_BYTES: usize = 20 * 1024 * 1024;
const MAX_AGE: std::time::Duration = std::time::Duration::from_secs(30 * 86_400);

/// The file extension for an allowed image type.
pub fn ext_for(mime: &str) -> Option<&'static str> {
    match mime.trim().to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

/// The extension for the image type the bytes start with, whatever the webview said.
pub fn sniff_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn unique_name(ext: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{nanos}-{}-{n}.{ext}", std::process::id())
}

const ONLY_IMAGES: &str = "Only PNG, JPEG, GIF and WebP images can be attached";

/// Saves one image and returns its absolute path. The declared `mime` must be an image type
/// and the bytes must really be one: the extension comes from the bytes, not the webview.
pub fn save(app_dir: &Path, mime: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    ext_for(mime).ok_or(ONLY_IMAGES)?;
    if bytes.is_empty() {
        return Err("The image is empty".into());
    }
    if bytes.len() > MAX_BYTES {
        return Err("The image is over 20 MB".into());
    }
    let ext = sniff_ext(bytes).ok_or(ONLY_IMAGES)?;
    let dir = app_dir.join(DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    let path = dir.join(unique_name(ext));
    std::fs::write(&path, bytes).map_err(|e| format!("Failed to save the image: {e}"))?;
    Ok(path)
}

/// Removes saved images older than 30 days. Returns how many were removed.
pub fn clean_old(app_dir: &Path, now: std::time::SystemTime) -> usize {
    let Ok(entries) = std::fs::read_dir(app_dir.join(DIR)) else {
        return 0;
    };
    let mut n = 0;
    for e in entries.flatten() {
        let Ok(meta) = e.metadata() else { continue };
        let old = meta
            .modified()
            .ok()
            .and_then(|m| now.duration_since(m).ok())
            .is_some_and(|age| age > MAX_AGE);
        if meta.is_file() && old && std::fs::remove_file(e.path()).is_ok() {
            n += 1;
        }
    }
    n
}

#[tauri::command]
pub async fn agents_save_image(
    state: tauri::State<'_, super::AgentsState>,
    mime: String,
    data: String,
) -> Result<String, String> {
    super::actions::switched_on(&state)?;
    let app_dir = state.app_dir.clone();
    super::pty::blocking(move || {
        // Base64 of 20 MB is under 27 MB; refuse anything larger before decoding.
        if data.len() > MAX_BYTES / 3 * 4 + 8 {
            return Err("The image is over 20 MB".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data.as_bytes())
            .map_err(|_| "The image could not be read".to_string())?;
        save(&app_dir, &mime, &bytes).map(|p| p.to_string_lossy().into_owned())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sm-uploads-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n data";
    const JPEG: &[u8] = b"\xff\xd8\xff\xe0 data";
    const GIF: &[u8] = b"GIF89a data";
    const WEBP: &[u8] = b"RIFF\x10\0\0\0WEBPVP8 data";

    #[test]
    fn saves_allowed_images_with_their_extension() {
        let d = tmp("save");
        let p = save(&d, "image/png", PNG).unwrap();
        assert!(p.starts_with(d.join(DIR)));
        assert_eq!(p.extension().unwrap(), "png");
        assert_eq!(std::fs::read(&p).unwrap(), PNG);
        let q = save(&d, "image/jpeg", JPEG).unwrap();
        assert_ne!(p, q);
        assert_eq!(q.extension().unwrap(), "jpg");
        assert_eq!(save(&d, "image/gif", GIF).unwrap().extension().unwrap(), "gif");
        assert_eq!(save(&d, "image/webp", WEBP).unwrap().extension().unwrap(), "webp");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn extension_comes_from_the_bytes_not_the_mime() {
        let d = tmp("sniff");
        // A JPEG the webview calls a PNG is saved as what it is.
        assert_eq!(save(&d, "image/png", JPEG).unwrap().extension().unwrap(), "jpg");
        // Anything else claiming to be an image is refused, and nothing is written.
        for bytes in [&b"#!/bin/sh\necho hi"[..], b"<svg/>", b"%PDF-1.7", b"RIFF\0\0\0\0WAVE", b"\x89PN"] {
            assert!(save(&d, "image/png", bytes).is_err(), "{bytes:?}");
        }
        assert!(std::fs::read_dir(d.join(DIR)).unwrap().count() == 1);
        assert_eq!(sniff_ext(b"GIF87a"), Some("gif"));
        assert_eq!(sniff_ext(b"RIFF\0\0\0\0WEB"), None);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn refuses_other_types_empty_and_oversize() {
        let d = tmp("refuse");
        assert!(save(&d, "application/pdf", b"x").is_err());
        assert!(save(&d, "image/svg+xml", b"x").is_err());
        assert!(save(&d, "image/png", b"").is_err());
        assert!(save(&d, "image/png", &vec![0u8; MAX_BYTES + 1]).is_err());
        assert!(!d.join(DIR).exists() || std::fs::read_dir(d.join(DIR)).unwrap().next().is_none());
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn cleans_only_files_older_than_30_days() {
        let d = tmp("clean");
        let p = save(&d, "image/gif", GIF).unwrap();
        let now = std::time::SystemTime::now();
        assert_eq!(clean_old(&d, now), 0);
        assert!(p.exists());
        assert_eq!(clean_old(&d, now + std::time::Duration::from_secs(31 * 86_400)), 1);
        assert!(!p.exists());
        std::fs::remove_dir_all(&d).ok();
    }
}
