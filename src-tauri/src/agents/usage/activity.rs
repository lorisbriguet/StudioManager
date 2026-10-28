//! Tokens per client and agent time, read from Claude Code's transcripts
//! (`~/.claude/projects/*/*.jsonl`). A guide, not a timesheet.
//!
//! A scan keeps a byte offset per file, so the next one reads only appended bytes.

use crate::agents::projects::FolderIndex;
use crate::agents::transcript::model_label;
use chrono::{DateTime, Duration, Local};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime};

/// Where unlinked folders are counted.
pub const OTHER: &str = "Other";
/// Message gaps at or above this are not agent time.
const MAX_GAP_MS: i64 = 5 * 60 * 1000;
const DAYS: i64 = 7;
/// Files untouched for longer than this cannot hold anything of the last 7 days.
const MAX_FILE_AGE_DAYS: u64 = 8;
/// The command's cache lifetime.
pub const CACHE_SECS: u64 = 60;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DayTokens {
    /// Local calendar day, `YYYY-MM-DD`.
    pub date: String,
    pub by_client: BTreeMap<String, u64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClientTime {
    pub client: String,
    pub minutes: u32,
    /// (project, minutes), largest first.
    pub projects: Vec<(String, u32)>,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimeTotals {
    pub today: Vec<ClientTime>,
    pub week: Vec<ClientTime>,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    /// The last 7 days, oldest first.
    pub days: Vec<DayTokens>,
    /// Stacking order: largest first.
    pub clients: Vec<String>,
    pub model_mix: String,
    pub time: TimeTotals,
}

#[derive(Default)]
struct FileState {
    offset: u64,
    /// Last message time (epoch ms) and its folder.
    last: Option<(i64, String)>,
}

/// What earlier scans read: per-file offsets and the aggregates of what they found.
#[derive(Default)]
pub struct ScanState {
    files: HashMap<PathBuf, FileState>,
    /// (day, cwd, model label or "") -> tokens.
    tokens: HashMap<(String, String, String), u64>,
    /// (day, cwd) -> agent time in ms.
    time_ms: HashMap<(String, String), i64>,
    /// Message ids already counted (a reply is written as several lines).
    seen: HashSet<String>,
    /// Bytes read over this state's life (tests check scans only read new bytes).
    pub bytes_read: u64,
}

/// The command's state: the incremental scan plus the last result.
#[derive(Default)]
pub struct ActivityCache {
    pub scan: ScanState,
    pub last: Option<(Instant, Activity)>,
}

fn day_key(t: DateTime<Local>) -> String {
    t.format("%Y-%m-%d").to_string()
}

/// Every `*.jsonl` directly under a project folder of `~/.claude/projects`.
fn transcripts(home: &Path) -> Vec<(PathBuf, u64)> {
    let mut out = Vec::new();
    let Ok(dirs) = std::fs::read_dir(home.join(".claude/projects")) else {
        return out;
    };
    let max_age = std::time::Duration::from_secs(MAX_FILE_AGE_DAYS * 86400);
    for dir in dirs.flatten() {
        let Ok(files) = std::fs::read_dir(dir.path()) else { continue };
        for f in files.flatten() {
            let path = f.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(meta) = f.metadata() else { continue };
            let fresh = meta
                .modified()
                .ok()
                .and_then(|m| SystemTime::now().duration_since(m).ok())
                .map_or(true, |age| age <= max_age);
            if fresh {
                out.push((path, meta.len()));
            }
        }
    }
    out.sort();
    out
}

impl ScanState {
    pub fn scan(&mut self, home: &Path, index: &FolderIndex, now: DateTime<Local>) -> Activity {
        let files = transcripts(home);
        // A file that got shorter was rotated or rewritten: its old lines are not
        // separable from the totals, so start over.
        if files.iter().any(|(p, len)| self.files.get(p).is_some_and(|s| s.offset > *len)) {
            *self = Self { bytes_read: self.bytes_read, ..Self::default() };
        }
        for (path, len) in &files {
            let offset = self.files.get(path).map_or(0, |s| s.offset);
            if *len > offset {
                self.read_new(path, offset);
            }
        }
        self.prune(now);
        self.build(index, now)
    }

    fn read_new(&mut self, path: &Path, offset: u64) {
        let mut buf = Vec::new();
        let read = std::fs::File::open(path).and_then(|mut f| {
            f.seek(SeekFrom::Start(offset))?;
            f.read_to_end(&mut buf)
        });
        if read.is_err() {
            return;
        }
        // Only whole lines: a partial last line waits for its newline.
        let Some(end) = buf.iter().rposition(|b| *b == b'\n') else { return };
        let consumed = end + 1;
        self.bytes_read += consumed as u64;
        let mut state = self.files.remove(path).unwrap_or_default();
        state.offset = offset + consumed as u64;
        for line in buf[..consumed].split(|b| *b == b'\n') {
            self.add_line(&mut state, &String::from_utf8_lossy(line));
        }
        self.files.insert(path.to_path_buf(), state);
    }

    fn add_line(&mut self, file: &mut FileState, line: &str) {
        if !line.contains("\"timestamp\"") {
            return;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { return };
        let Some(at) = v
            .get("timestamp")
            .and_then(|t| t.as_str())
            .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
        else {
            return;
        };
        let ms = at.timestamp_millis();
        let day = day_key(at.with_timezone(&Local));
        let cwd = v
            .get("cwd")
            .and_then(|c| c.as_str())
            .map(str::to_string)
            .or_else(|| file.last.as_ref().map(|(_, c)| c.clone()));
        let Some(cwd) = cwd else { return };

        if let Some((prev, _)) = &file.last {
            let gap = ms - prev;
            if (0..MAX_GAP_MS).contains(&gap) {
                *self.time_ms.entry((day.clone(), cwd.clone())).or_default() += gap;
            }
        }
        if file.last.as_ref().map_or(true, |(prev, _)| ms >= *prev) {
            file.last = Some((ms, cwd.clone()));
        }

        let Some(msg) = v.get("message") else { return };
        let Some(usage) = msg.get("usage") else { return };
        let tokens = ["output_tokens", "input_tokens"]
            .iter()
            .filter_map(|k| usage.get(*k).and_then(|n| n.as_u64()))
            .sum::<u64>();
        if tokens == 0 {
            return;
        }
        if let Some(id) = msg.get("id").and_then(|i| i.as_str()) {
            let req = v.get("requestId").and_then(|r| r.as_str()).unwrap_or("");
            if !self.seen.insert(format!("{id}:{req}")) {
                return;
            }
        }
        let model = msg
            .get("model")
            .and_then(|m| m.as_str())
            .and_then(model_label)
            .unwrap_or_default();
        *self.tokens.entry((day, cwd, model)).or_default() += tokens;
    }

    /// Drops what is older than the 7 days shown.
    fn prune(&mut self, now: DateTime<Local>) {
        let oldest = day_key(now - Duration::days(DAYS - 1));
        self.tokens.retain(|(d, _, _), _| *d >= oldest);
        self.time_ms.retain(|(d, _), _| *d >= oldest);
    }

    fn build(&self, index: &FolderIndex, now: DateTime<Local>) -> Activity {
        let mut attribution: HashMap<&str, (String, String)> = HashMap::new();
        let attribute = |cwd: &str| -> (String, String) {
            index.label_for(cwd).map_or_else(
                || {
                    let last = cwd.trim_end_matches('/').rsplit('/').next().unwrap_or("");
                    (OTHER.to_string(), if last.is_empty() { cwd.to_string() } else { last.to_string() })
                },
                |l| (l.client_name, l.project_name),
            )
        };
        // Resolve each folder once.
        let cwds: HashSet<&str> = self
            .tokens
            .keys()
            .map(|(_, c, _)| c.as_str())
            .chain(self.time_ms.keys().map(|(_, c)| c.as_str()))
            .collect();
        for c in cwds {
            attribution.insert(c, attribute(c));
        }

        let dates: Vec<String> =
            (0..DAYS).rev().map(|i| day_key(now - Duration::days(i))).collect();
        let mut days: Vec<DayTokens> = dates
            .iter()
            .map(|d| DayTokens { date: d.clone(), by_client: BTreeMap::new() })
            .collect();
        let mut per_client: HashMap<String, u64> = HashMap::new();
        let mut per_model: HashMap<String, u64> = HashMap::new();
        for ((day, cwd, model), n) in &self.tokens {
            let Some(slot) = days.iter_mut().find(|d| d.date == *day) else { continue };
            let client = attribution[cwd.as_str()].0.clone();
            *slot.by_client.entry(client.clone()).or_default() += n;
            *per_client.entry(client).or_default() += n;
            if !model.is_empty() {
                *per_model.entry(model.clone()).or_default() += n;
            }
        }
        let mut clients: Vec<(String, u64)> = per_client.into_iter().collect();
        clients.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

        let today = &dates[dates.len() - 1];
        let mut today_ms: HashMap<(String, String), i64> = HashMap::new();
        let mut week_ms: HashMap<(String, String), i64> = HashMap::new();
        for ((day, cwd), ms) in &self.time_ms {
            let key = attribution[cwd.as_str()].clone();
            *week_ms.entry(key.clone()).or_default() += ms;
            if day == today {
                *today_ms.entry(key).or_default() += ms;
            }
        }
        Activity {
            days,
            clients: clients.into_iter().map(|(c, _)| c).collect(),
            model_mix: model_mix(per_model),
            time: TimeTotals { today: client_times(today_ms), week: client_times(week_ms) },
        }
    }
}

/// "All Opus 5.5" from 99%, else "Mostly Opus 5.5 92%, Sonnet 5.5 8%".
fn model_mix(per_model: HashMap<String, u64>) -> String {
    let total: u64 = per_model.values().sum();
    if total == 0 {
        return String::new();
    }
    let mut models: Vec<(String, u64)> = per_model.into_iter().collect();
    models.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let pct = |n: u64| (n as f64 * 100.0 / total as f64).round() as u64;
    if models[0].1 * 100 >= total * 99 {
        return format!("All {}", models[0].0);
    }
    let list: Vec<String> = models
        .iter()
        .map(|(m, n)| format!("{m} {}%", pct(*n)))
        .collect();
    let lead = if models[0].1 * 2 >= total { "Mostly" } else { "A mix of" };
    format!("{lead} {}", list.join(", "))
}

/// Minutes per client and project, largest first; groups under a minute are left out.
fn client_times(ms: HashMap<(String, String), i64>) -> Vec<ClientTime> {
    let mut by_client: HashMap<String, Vec<(String, u32)>> = HashMap::new();
    for ((client, project), ms) in ms {
        let minutes = (ms as f64 / 60_000.0).round() as u32;
        if minutes > 0 {
            by_client.entry(client).or_default().push((project, minutes));
        }
    }
    let mut out: Vec<ClientTime> = by_client
        .into_iter()
        .map(|(client, mut projects)| {
            projects.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
            ClientTime { client, minutes: projects.iter().map(|p| p.1).sum(), projects }
        })
        .collect();
    out.sort_by(|a, b| b.minutes.cmp(&a.minutes).then_with(|| a.client.cmp(&b.client)));
    out
}

#[tauri::command]
pub async fn agents_usage_activity(
    state: tauri::State<'_, crate::agents::AgentsState>,
) -> Result<Activity, String> {
    crate::agents::actions::switched_on(&state)?;
    let app_dir = state.app_dir.clone();
    let cache = state.activity.clone();
    crate::agents::pty::blocking(move || {
        let mut cache = cache.lock().map_err(|e| e.to_string())?;
        if let Some((at, activity)) = &cache.last {
            if at.elapsed().as_secs() < CACHE_SECS {
                return Ok(activity.clone());
            }
        }
        let index = crate::agents::projects::load_index(&app_dir);
        let home = crate::agents::actions::home_dir();
        let activity = cache.scan.scan(&home, &index, Local::now());
        cache.last = Some((Instant::now(), activity.clone()));
        Ok(activity)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::projects::ProjectLabel;
    use std::fs;
    use std::io::Write;

    fn tmp() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        let n = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir()
            .join(format!("sm-activity-{n}-{}", N.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(d.join(".claude/projects/-tmp-demo")).unwrap();
        d
    }

    fn file(home: &Path, name: &str) -> PathBuf {
        home.join(".claude/projects/-tmp-demo").join(name)
    }

    fn ts(t: DateTime<Local>) -> String {
        t.with_timezone(&chrono::Utc).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    }

    fn assistant(
        t: DateTime<Local>,
        cwd: &str,
        id: &str,
        model: &str,
        input: u64,
        output: u64,
        cache: u64,
    ) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{}","cwd":"{cwd}","requestId":"req-{id}","message":{{"id":"msg-{id}","model":"{model}","usage":{{"input_tokens":{input},"output_tokens":{output},"cache_read_input_tokens":{cache},"cache_creation_input_tokens":{cache}}}}}}}"#,
            ts(t)
        ) + "\n"
    }

    fn user(t: DateTime<Local>, cwd: &str) -> String {
        format!(
            r#"{{"type":"user","timestamp":"{}","cwd":"{cwd}","message":{{"role":"user","content":"hi"}}}}"#,
            ts(t)
        ) + "\n"
    }

    fn append(path: &Path, text: &str) {
        let mut f = fs::OpenOptions::new().create(true).append(true).open(path).unwrap();
        f.write_all(text.as_bytes()).unwrap();
    }

    fn index() -> FolderIndex {
        FolderIndex(vec![ProjectLabel {
            org_id: "o1".into(),
            org_name: "Demo Org".into(),
            client_name: "Acme".into(),
            project_id: 1,
            project_name: "Website".into(),
            folder: "/tmp/demo/acme-site".into(),
        }])
    }

    fn total(a: &Activity) -> u64 {
        a.days.iter().flat_map(|d| d.by_client.values()).sum()
    }

    #[test]
    fn tokens_exclude_cache_reads() {
        let home = tmp();
        let now = Local::now();
        append(
            &file(&home, "s1.jsonl"),
            &assistant(now, "/tmp/demo/acme-site", "a", "claude-opus-5-5", 10, 90, 100_000),
        );
        let a = ScanState::default().scan(&home, &index(), now);
        assert_eq!(total(&a), 100);
    }

    #[test]
    fn days_grouped_by_client_via_folder_index() {
        let home = tmp();
        let now = Local::now();
        let f = file(&home, "s1.jsonl");
        append(&f, &assistant(now, "/tmp/demo/acme-site/src", "a", "claude-opus-5-5", 0, 100, 0));
        append(&f, &assistant(now, "/tmp/demo/scratch", "b", "claude-opus-5-5", 0, 30, 0));
        append(
            &f,
            &assistant(now - Duration::days(2), "/tmp/demo/acme-site", "c", "claude-opus-5-5", 0, 50, 0),
        );
        append(
            &f,
            &assistant(now - Duration::days(9), "/tmp/demo/acme-site", "d", "claude-opus-5-5", 0, 999, 0),
        );
        let a = ScanState::default().scan(&home, &index(), now);
        assert_eq!(a.days.len(), 7);
        let today = a.days.last().unwrap();
        assert_eq!(today.date, now.format("%Y-%m-%d").to_string());
        assert_eq!(today.by_client.get("Acme"), Some(&100));
        assert_eq!(today.by_client.get(OTHER), Some(&30));
        assert_eq!(a.days[4].by_client.get("Acme"), Some(&50));
        assert_eq!(a.clients, vec!["Acme".to_string(), OTHER.to_string()]);
        assert_eq!(total(&a), 180);
    }

    #[test]
    fn model_mix_text() {
        let now = Local::now();
        let mix = |opus: u64, sonnet: u64| {
            let home = tmp();
            let f = file(&home, "s1.jsonl");
            append(&f, &assistant(now, "/tmp/demo/x", "a", "claude-opus-5-5", 0, opus, 0));
            if sonnet > 0 {
                append(&f, &assistant(now, "/tmp/demo/x", "b", "claude-sonnet-5-5", 0, sonnet, 0));
            }
            ScanState::default().scan(&home, &FolderIndex::default(), now).model_mix
        };
        assert_eq!(mix(1000, 0), "All Opus 5.5");
        assert_eq!(mix(920, 80), "Mostly Opus 5.5 92%, Sonnet 5.5 8%");
        assert_eq!(mix(995, 5), "All Opus 5.5");
    }

    #[test]
    fn incremental_scan_reads_only_new_bytes() {
        let home = tmp();
        let now = Local::now();
        let f = file(&home, "s1.jsonl");
        append(&f, &assistant(now, "/tmp/demo/x", "a", "claude-opus-5-5", 0, 10, 0));
        let mut st = ScanState::default();
        assert_eq!(total(&st.scan(&home, &index(), now)), 10);
        let first = st.bytes_read;
        assert_eq!(first, fs::metadata(&f).unwrap().len());
        assert_eq!(total(&st.scan(&home, &index(), now)), 10);
        assert_eq!(st.bytes_read, first);

        let line = assistant(now, "/tmp/demo/x", "b", "claude-opus-5-5", 0, 5, 0);
        let (head, tail) = line.split_at(line.len() / 2);
        append(&f, head); // partial last line: not consumed yet
        assert_eq!(total(&st.scan(&home, &index(), now)), 10);
        append(&f, tail);
        assert_eq!(total(&st.scan(&home, &index(), now)), 15);
        assert_eq!(st.bytes_read, first + line.len() as u64);

        // A file that shrank is read again from the start.
        fs::write(&f, assistant(now, "/tmp/demo/x", "z", "claude-opus-5-5", 0, 7, 0)).unwrap();
        assert_eq!(total(&st.scan(&home, &index(), now)), 7);
    }

    #[test]
    fn agent_time_gaps_over_5_min_not_counted() {
        let home = tmp();
        let now = Local::now();
        let t0 = now - Duration::hours(1);
        let f = file(&home, "s1.jsonl");
        // 2 min + 3 min counted, then a 20 min pause, then 4 min counted.
        for m in [0, 2, 5, 25, 29] {
            append(&f, &user(t0 + Duration::minutes(m), "/tmp/demo/acme-site"));
        }
        // Another session in an unlinked folder: 1 minute.
        let g = file(&home, "s2.jsonl");
        append(&g, &user(t0, "/tmp/demo/scratch"));
        append(&g, &user(t0 + Duration::minutes(1), "/tmp/demo/scratch"));
        let a = ScanState::default().scan(&home, &index(), now);
        // Midnight may fall between the samples: only the week is certain to hold them all.
        let week: BTreeMap<_, _> = a.time.week.iter().map(|c| (c.client.clone(), c)).collect();
        assert_eq!(week["Acme"].minutes, 9);
        assert_eq!(week["Acme"].projects, vec![("Website".to_string(), 9)]);
        assert_eq!(week[OTHER].minutes, 1);
        assert_eq!(week[OTHER].projects, vec![("scratch".to_string(), 1)]);
    }
}
