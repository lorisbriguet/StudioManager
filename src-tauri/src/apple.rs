//! macOS integrations (Calendar, PDFKit text extraction, HEIC conversion).
//!
//! Every osascript invocation uses a FIXED script constant; user data is
//! passed exclusively through `argv` (AppleScript `on run argv` / JXA
//! `function run(argv)`), so nothing is ever interpolated into script source
//! and script injection is impossible by construction.

// ── Fixed scripts ───────────────────────────────────────────────────────────

/// JXA: extract text from a PDF via the native PDFKit bridge.
/// argv[0] = absolute file path.
pub(crate) const PDF_TEXT_JXA: &str = r#"
function run(argv) {
  ObjC.import('PDFKit');
  ObjC.import('Foundation');
  var url = $.NSURL.fileURLWithPath($(argv[0]));
  var doc = $.PDFDocument.alloc.initWithURL(url);
  if (!doc || doc.isNil()) return '';
  var text = '';
  for (var i = 0; i < doc.pageCount; i++) {
    var page = doc.pageAtIndex(i);
    if (page) {
      var s = page.string;
      if (s) text += s.js + String.fromCharCode(10);
    }
  }
  return text;
}
"#;

/// JXA: OCR an image via the native Vision framework (VNRecognizeTextRequest).
/// Reads JPEG/PNG/HEIC natively; recognition languages match the receipt
/// locales previously configured for tesseract (fr/de/en).
/// argv[0] = absolute file path.
pub(crate) const OCR_VISION_JXA: &str = r#"
function run(argv) {
  ObjC.import('Vision');
  ObjC.import('Foundation');
  var url = $.NSURL.fileURLWithPath($(argv[0]));
  var handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $({}));
  var request = $.VNRecognizeTextRequest.alloc.init;
  request.recognitionLevel = $.VNRequestTextRecognitionLevelAccurate;
  request.usesLanguageCorrection = true;
  request.recognitionLanguages = $(['fr-FR', 'de-DE', 'en-US']);
  var error = Ref();
  var ok = handler.performRequestsError($([request]), error);
  if (!ok) {
    throw new Error('Vision request failed');
  }
  var results = request.results;
  var lines = [];
  for (var i = 0; i < results.count; i++) {
    var top = results.objectAtIndex(i).topCandidates(1);
    if (top.count > 0) lines.push(top.objectAtIndex(0).string.js);
  }
  return lines.join(String.fromCharCode(10));
}
"#;

/// List names of writable calendars, "||"-separated.
pub(crate) const CAL_LIST_WRITABLE: &str = r#"
tell application "Calendar"
  set output to ""
  repeat with c in every calendar
    if writable of c then
      set output to output & name of c & "||"
    end if
  end repeat
  return output
end tell
"#;

/// Create a timed event.
/// argv: calendar, title, notes, year, month, day, hours, minutes, durationSecs.
pub(crate) const CAL_CREATE_TIMED: &str = r#"
on run argv
  set calName to item 1 of argv
  set evTitle to item 2 of argv
  set evNotes to item 3 of argv
  set y to (item 4 of argv) as integer
  set m to (item 5 of argv) as integer
  set d to (item 6 of argv) as integer
  set hh to (item 7 of argv) as integer
  set mm to (item 8 of argv) as integer
  set durSecs to (item 9 of argv) as integer
  tell application "Calendar"
    tell calendar calName
      set startDate to current date
      set hours of startDate to 0
      set minutes of startDate to 0
      set seconds of startDate to 0
      -- Pin day to 1 before year/month: prevents month-overflow (e.g. Jan 31 + set month 2 = March) and the Feb 29 non-leap-year edge
      set day of startDate to 1
      set year of startDate to y
      set month of startDate to m
      set day of startDate to d
      set hours of startDate to hh
      set minutes of startDate to mm
      set endDate to startDate + durSecs
      set newEvent to make new event with properties {summary:evTitle, start date:startDate, end date:endDate, description:evNotes}
      return uid of newEvent
    end tell
  end tell
end run
"#;

/// Create an all-day event.
/// argv: calendar, title, notes, year, month, day.
pub(crate) const CAL_CREATE_ALLDAY: &str = r#"
on run argv
  set calName to item 1 of argv
  set evTitle to item 2 of argv
  set evNotes to item 3 of argv
  set y to (item 4 of argv) as integer
  set m to (item 5 of argv) as integer
  set d to (item 6 of argv) as integer
  tell application "Calendar"
    tell calendar calName
      set eventDate to current date
      -- Pin day to 1 before year/month: prevents month-overflow (e.g. Jan 31 + set month 2 = March) and the Feb 29 non-leap-year edge
      set day of eventDate to 1
      set year of eventDate to y
      set month of eventDate to m
      set day of eventDate to d
      set hours of eventDate to 0
      set minutes of eventDate to 0
      set seconds of eventDate to 0
      set newEvent to make new event with properties {summary:evTitle, start date:eventDate, end date:eventDate, allday event:true, description:evNotes}
      return uid of newEvent
    end tell
  end tell
end run
"#;

/// Open Apple Mail with a new message and the PDF attached.
/// argv: subject, to, absolute file path.
pub(crate) const MAIL_SHARE: &str = r#"
on run argv
  set theSubject to item 1 of argv
  set theTo to item 2 of argv
  set thePath to item 3 of argv
  tell application "Mail"
    set newMessage to make new outgoing message with properties {subject:theSubject, visible:true}
    tell newMessage
      make new to recipient at end of to recipients with properties {address:theTo}
      set mailAttachment to make new attachment with properties {file name:(POSIX file thePath)} at after the last paragraph of content
    end tell
    activate
  end tell
end run
"#;

/// Delete every event with the given uid.
/// argv: calendar, uid.
pub(crate) const CAL_DELETE_EVENT: &str = r#"
on run argv
  set calName to item 1 of argv
  set evUid to item 2 of argv
  tell application "Calendar"
    tell calendar calName
      set theEvents to (every event whose uid is evUid)
      repeat with e in theEvents
        delete e
      end repeat
    end tell
  end tell
end run
"#;

// ── Pure helpers ────────────────────────────────────────────────────────────

/// Parse a strict `yyyy-MM-dd` date into (year, month, day).
pub(crate) fn parse_date(date: &str) -> Result<(u32, u32, u32), String> {
    let bytes = date.as_bytes();
    let valid_shape = bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| if i == 4 || i == 7 { true } else { b.is_ascii_digit() });
    if !valid_shape {
        return Err(format!("Invalid date format: {date}"));
    }
    let year: u32 = date[0..4].parse().map_err(|_| format!("Invalid date: {date}"))?;
    let month: u32 = date[5..7].parse().map_err(|_| format!("Invalid date: {date}"))?;
    let day: u32 = date[8..10].parse().map_err(|_| format!("Invalid date: {date}"))?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err(format!("Invalid date: {date}"));
    }
    Ok((year, month, day))
}

/// Parse a strict `HH:mm` time into (hours, minutes).
pub(crate) fn parse_time(time: &str) -> Result<(u32, u32), String> {
    let bytes = time.as_bytes();
    let valid_shape = bytes.len() == 5
        && bytes[2] == b':'
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| if i == 2 { true } else { b.is_ascii_digit() });
    if !valid_shape {
        return Err(format!("Invalid time format: {time}"));
    }
    let hours: u32 = time[0..2].parse().map_err(|_| format!("Invalid time: {time}"))?;
    let minutes: u32 = time[3..5].parse().map_err(|_| format!("Invalid time: {time}"))?;
    if hours > 23 || minutes > 59 {
        return Err(format!("Invalid time: {time}"));
    }
    Ok((hours, minutes))
}

/// Event duration in seconds; falls back to one hour when the span is not
/// positive (matches the historical frontend behavior).
pub(crate) fn duration_secs(start: (u32, u32), end: (u32, u32)) -> i64 {
    let secs = (end.0 as i64 - start.0 as i64) * 3600 + (end.1 as i64 - start.1 as i64) * 60;
    if secs <= 0 { 3600 } else { secs }
}

// ── osascript runner ────────────────────────────────────────────────────────

/// Generous ceiling for legitimate output (PDF text of a large document is
/// well under 1 MB); anything beyond this indicates a runaway script.
const OUTPUT_CAP_BYTES: usize = 16 * 1024 * 1024;

/// Read up to `cap` bytes, then keep DRAINING (discarding) so a chatty child
/// never blocks on a full pipe. Returns (data, exceeded_cap).
fn read_capped(mut reader: impl std::io::Read, cap: usize) -> (Vec<u8>, bool) {
    let mut buf = vec![0u8; 64 * 1024];
    let mut out: Vec<u8> = Vec::new();
    let mut exceeded = false;
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if out.len() < cap {
                    let take = (cap - out.len()).min(n);
                    out.extend_from_slice(&buf[..take]);
                    if n > take {
                        exceeded = true;
                    }
                } else {
                    exceeded = true;
                }
            }
            Err(_) => break,
        }
    }
    (out, exceeded)
}

/// Run a FIXED osascript script, passing user data as argv only.
/// `language_flags` is either empty (AppleScript) or ["-l", "JavaScript"].
/// The child is killed after `timeout`; output beyond `cap` is an error
/// (truncated data would be silently wrong for OCR/PDF text).
fn run_osascript_impl(
    language_flags: &[&str],
    script: &str,
    argv: &[&str],
    timeout: std::time::Duration,
    cap: usize,
) -> Result<String, String> {
    use std::process::Stdio;

    let mut child = std::process::Command::new("osascript")
        .args(language_flags)
        .arg("-e")
        .arg(script)
        .args(argv)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to run osascript: {e}"))?;

    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let out_reader = std::thread::spawn(move || read_capped(stdout, cap));
    let err_reader = std::thread::spawn(move || read_capped(stderr, 64 * 1024));

    let deadline = std::time::Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = out_reader.join();
                    let _ = err_reader.join();
                    return Err(format!(
                        "osascript timed out after {}s",
                        timeout.as_secs()
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            Err(e) => {
                let _ = child.kill();
                return Err(format!("failed to wait for osascript: {e}"));
            }
        }
    };

    let (out, out_exceeded) = out_reader
        .join()
        .map_err(|_| "osascript output reader panicked".to_string())?;
    let (err_bytes, _) = err_reader
        .join()
        .map_err(|_| "osascript stderr reader panicked".to_string())?;

    if out_exceeded {
        return Err("osascript output exceeded the size limit".to_string());
    }
    if status.success() {
        Ok(String::from_utf8_lossy(&out).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&err_bytes).trim().to_string();
        if stderr.is_empty() {
            Err(format!("osascript failed with status {status}"))
        } else {
            Err(stderr)
        }
    }
}

fn run_osascript(
    language_flags: &[&str],
    script: &str,
    argv: &[&str],
    timeout: std::time::Duration,
) -> Result<String, String> {
    run_osascript_impl(language_flags, script, argv, timeout, OUTPUT_CAP_BYTES)
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Extract text from a PDF using the native PDFKit bridge (JXA).
#[tauri::command]
pub(crate) async fn extract_pdf_text(path: String) -> Result<String, String> {
    spawn_osascript(move || {
        let canonical =
            std::fs::canonicalize(&path).map_err(|e| format!("path not found: {path} ({e})"))?;
        run_osascript(
            &["-l", "JavaScript"],
            PDF_TEXT_JXA,
            &[&canonical.to_string_lossy()],
            PDF_TIMEOUT,
        )
    })
    .await
}

// Per-integration timeouts: Rust-side backstop so a hung osascript never
// keeps a process (or a spawn_blocking thread) alive forever. The frontend
// races shorter timeouts for UX; these just guarantee cleanup.
const PDF_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const OCR_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const CAL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const MAIL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// Run Vision OCR on an image file and return the recognized lines.
fn run_vision_ocr(path: &str) -> Result<String, String> {
    run_osascript(&["-l", "JavaScript"], OCR_VISION_JXA, &[path], OCR_TIMEOUT)
}

/// OCR an image (JPEG/PNG/HEIC) with the native Vision framework.
#[tauri::command]
pub(crate) async fn ocr_image_text(path: String) -> Result<String, String> {
    spawn_osascript(move || {
        let canonical =
            std::fs::canonicalize(&path).map_err(|e| format!("path not found: {path} ({e})"))?;
        run_vision_ocr(&canonical.to_string_lossy())
    })
    .await
}

/// List writable Apple Calendar calendars.
#[tauri::command]
pub(crate) async fn calendar_list_writable() -> Result<Vec<String>, String> {
    spawn_osascript(move || {
        let raw = run_osascript(&[], CAL_LIST_WRITABLE, &[], CAL_TIMEOUT)?;
        Ok(raw
            .split("||")
            .filter(|n| !n.is_empty())
            .map(str::to_string)
            .collect())
    })
    .await
}

/// Create an Apple Calendar event (timed or all-day) and return its uid.
#[tauri::command]
pub(crate) async fn calendar_create_event(
    calendar: String,
    title: String,
    notes: String,
    date: String,
    start_time: Option<String>,
    end_time: Option<String>,
) -> Result<String, String> {
    spawn_osascript(move || {
        let (y, m, d) = parse_date(&date)?;
        let start = start_time.as_deref().filter(|s| !s.is_empty());
        match start {
            Some(st) => {
                let start = parse_time(st)?;
                let end = match end_time.as_deref().filter(|s| !s.is_empty()) {
                    Some(et) => parse_time(et)?,
                    None => start,
                };
                let dur = duration_secs(start, end);
                run_osascript(
                    &[],
                    CAL_CREATE_TIMED,
                    &[
                        &calendar,
                        &title,
                        &notes,
                        &y.to_string(),
                        &m.to_string(),
                        &d.to_string(),
                        &start.0.to_string(),
                        &start.1.to_string(),
                        &dur.to_string(),
                    ],
                    CAL_TIMEOUT,
                )
            }
            None => run_osascript(
                &[],
                CAL_CREATE_ALLDAY,
                &[
                    &calendar,
                    &title,
                    &notes,
                    &y.to_string(),
                    &m.to_string(),
                    &d.to_string(),
                ],
                CAL_TIMEOUT,
            ),
        }
    })
    .await
}

/// Delete every Apple Calendar event with the given uid.
#[tauri::command]
pub(crate) async fn calendar_delete_event(calendar: String, uid: String) -> Result<(), String> {
    spawn_osascript(move || {
        run_osascript(&[], CAL_DELETE_EVENT, &[&calendar, &uid], CAL_TIMEOUT)?;
        Ok(())
    })
    .await
}

/// Open Apple Mail with a new message containing the PDF as attachment.
#[tauri::command]
pub(crate) async fn share_pdf_via_mail(
    path: String,
    to: String,
    subject: String,
) -> Result<(), String> {
    spawn_osascript(move || {
        let canonical = std::fs::canonicalize(&path)
            .map_err(|e| format!("Attachment not found: {path} ({e})"))?;
        run_osascript(
            &[],
            MAIL_SHARE,
            &[&subject, &to, &canonical.to_string_lossy()],
            MAIL_TIMEOUT,
        )?;
        Ok(())
    })
    .await
}

/// Run blocking osascript work on Tauri's blocking pool so a slow or hung
/// process never ties up an async runtime worker.
async fn spawn_osascript<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("osascript task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_date_accepts_iso_dates() {
        assert_eq!(parse_date("2026-03-01").unwrap(), (2026, 3, 1));
        assert_eq!(parse_date("1999-12-31").unwrap(), (1999, 12, 31));
    }

    #[test]
    fn parse_date_rejects_bad_input() {
        assert!(parse_date("2026-3-1").is_err());
        assert!(parse_date("01-03-2026").is_err());
        assert!(parse_date("2026-13-01").is_err());
        assert!(parse_date("2026-00-10").is_err());
        assert!(parse_date("2026-01-32").is_err());
        assert!(parse_date("nonsense").is_err());
        assert!(parse_date("2026-03-01'; drop --").is_err());
    }

    #[test]
    fn parse_time_accepts_hh_mm() {
        assert_eq!(parse_time("00:00").unwrap(), (0, 0));
        assert_eq!(parse_time("23:59").unwrap(), (23, 59));
        assert_eq!(parse_time("09:05").unwrap(), (9, 5));
    }

    #[test]
    fn parse_time_rejects_bad_input() {
        assert!(parse_time("9:05").is_err());
        assert!(parse_time("24:00").is_err());
        assert!(parse_time("12:60").is_err());
        assert!(parse_time("").is_err());
        assert!(parse_time("12:34:56").is_err());
    }

    #[test]
    fn duration_secs_computes_positive_spans() {
        assert_eq!(duration_secs((9, 0), (10, 30)), 5400);
        assert_eq!(duration_secs((23, 0), (23, 45)), 2700);
    }

    #[test]
    fn duration_secs_defaults_to_one_hour_when_not_positive() {
        // start == end and end before start both fall back to 1h,
        // matching the historical frontend behavior
        assert_eq!(duration_secs((9, 0), (9, 0)), 3600);
        assert_eq!(duration_secs((10, 0), (9, 0)), 3600);
    }

    #[test]
    fn vision_ocr_reads_fixture_text() {
        // Live Vision OCR on a committed fixture (macOS-only app, macOS-only test)
        let fixture = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/ocr_sample.png");
        let text = run_vision_ocr(fixture).unwrap();
        assert!(text.contains("FACTURE 2026"), "got: {text}");
        assert!(text.contains("123.45"), "got: {text}");
        assert!(text.contains("ACME"), "got: {text}");
    }

    #[test]
    fn run_osascript_kills_a_hung_script_after_the_timeout() {
        let start = std::time::Instant::now();
        let result = run_osascript_impl(
            &[],
            "delay 30",
            &[],
            std::time::Duration::from_secs(1),
            1024,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("timed out"));
        assert!(start.elapsed() < std::time::Duration::from_secs(5));
    }

    #[test]
    fn run_osascript_rejects_output_beyond_the_cap() {
        // ~200 KB of output against a 1 KB cap
        let result = run_osascript_impl(
            &["-l", "JavaScript"],
            "function run() { return 'x'.repeat(200 * 1024); }",
            &[],
            std::time::Duration::from_secs(15),
            1024,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("output"));
    }

    #[test]
    fn run_osascript_still_returns_normal_output() {
        let result = run_osascript_impl(
            &["-l", "JavaScript"],
            "function run(argv) { return 'ok:' + argv[0]; }",
            &["hello"],
            std::time::Duration::from_secs(15),
            1024 * 1024,
        );
        assert_eq!(result.unwrap(), "ok:hello");
    }

    #[test]
    fn scripts_take_data_via_argv_only() {
        // Fixed scripts must not contain any interpolation and must read
        // their inputs from argv.
        for script in [
            CAL_LIST_WRITABLE,
            CAL_CREATE_TIMED,
            CAL_CREATE_ALLDAY,
            CAL_DELETE_EVENT,
            MAIL_SHARE,
        ] {
            assert!(!script.contains("${"), "unexpected interpolation in script");
        }
        for script in [CAL_CREATE_TIMED, CAL_CREATE_ALLDAY, CAL_DELETE_EVENT, MAIL_SHARE] {
            assert!(script.contains("on run argv"), "script must use on run argv");
        }
        assert!(PDF_TEXT_JXA.contains("function run(argv)"));
        assert!(!OCR_VISION_JXA.contains("${"));
        assert!(OCR_VISION_JXA.contains("function run(argv)"));
    }
}
