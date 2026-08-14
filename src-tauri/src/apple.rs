//! macOS integrations (Calendar, PDFKit text extraction, HEIC conversion).
//!
//! Every osascript invocation uses a FIXED script constant; user data is
//! passed exclusively through `argv` (AppleScript `on run argv` / JXA
//! `function run(argv)`), so nothing is ever interpolated into script source
//! and script injection is impossible by construction.

use tauri::Manager;

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

/// Run a FIXED osascript script, passing user data as argv only.
/// `language_flags` is either empty (AppleScript) or ["-l", "JavaScript"].
fn run_osascript(language_flags: &[&str], script: &str, argv: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("osascript")
        .args(language_flags)
        .arg("-e")
        .arg(script)
        .args(argv)
        .output()
        .map_err(|e| format!("failed to run osascript: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!("osascript failed with status {}", output.status))
        } else {
            Err(stderr)
        }
    }
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Extract text from a PDF using the native PDFKit bridge (JXA).
#[tauri::command]
pub(crate) fn extract_pdf_text(path: String) -> Result<String, String> {
    let canonical =
        std::fs::canonicalize(&path).map_err(|e| format!("path not found: {path} ({e})"))?;
    run_osascript(
        &["-l", "JavaScript"],
        PDF_TEXT_JXA,
        &[&canonical.to_string_lossy()],
    )
}

/// Run Vision OCR on an image file and return the recognized lines.
fn run_vision_ocr(path: &str) -> Result<String, String> {
    run_osascript(&["-l", "JavaScript"], OCR_VISION_JXA, &[path])
}

/// OCR an image (JPEG/PNG/HEIC) with the native Vision framework.
#[tauri::command]
pub(crate) fn ocr_image_text(path: String) -> Result<String, String> {
    let canonical =
        std::fs::canonicalize(&path).map_err(|e| format!("path not found: {path} ({e})"))?;
    run_vision_ocr(&canonical.to_string_lossy())
}

/// List writable Apple Calendar calendars.
#[tauri::command]
pub(crate) fn calendar_list_writable() -> Result<Vec<String>, String> {
    let raw = run_osascript(&[], CAL_LIST_WRITABLE, &[])?;
    Ok(raw
        .split("||")
        .filter(|n| !n.is_empty())
        .map(str::to_string)
        .collect())
}

/// Create an Apple Calendar event (timed or all-day) and return its uid.
#[tauri::command]
pub(crate) fn calendar_create_event(
    calendar: String,
    title: String,
    notes: String,
    date: String,
    start_time: Option<String>,
    end_time: Option<String>,
) -> Result<String, String> {
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
        ),
    }
}

/// Delete every Apple Calendar event with the given uid.
#[tauri::command]
pub(crate) fn calendar_delete_event(calendar: String, uid: String) -> Result<(), String> {
    run_osascript(&[], CAL_DELETE_EVENT, &[&calendar, &uid])?;
    Ok(())
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
    fn scripts_take_data_via_argv_only() {
        // Fixed scripts must not contain any interpolation and must read
        // their inputs from argv.
        for script in [CAL_LIST_WRITABLE, CAL_CREATE_TIMED, CAL_CREATE_ALLDAY, CAL_DELETE_EVENT] {
            assert!(!script.contains("${"), "unexpected interpolation in script");
        }
        for script in [CAL_CREATE_TIMED, CAL_CREATE_ALLDAY, CAL_DELETE_EVENT] {
            assert!(script.contains("on run argv"), "script must use on run argv");
        }
        assert!(PDF_TEXT_JXA.contains("function run(argv)"));
        assert!(!OCR_VISION_JXA.contains("${"));
        assert!(OCR_VISION_JXA.contains("function run(argv)"));
    }
}
