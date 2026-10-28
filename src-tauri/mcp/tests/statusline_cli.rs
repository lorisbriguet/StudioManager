use std::io::Write;
use std::path::Path;
use std::process::{Command, Output, Stdio};

fn run_statusline(data_dir: &Path, stdin: &[u8]) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_studiomanager-mcp"))
        .arg("--statusline")
        .env("STUDIOMANAGER_DATA_DIR", data_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(stdin).unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn prints_nothing() {
    let dir = std::env::temp_dir().join(format!("sm-statusline-cli-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);

    let out = run_statusline(
        &dir,
        br#"{"rate_limits":{"five_hour":{"used_percentage":12,"resets_at":1800003600}}}"#,
    );
    assert!(out.status.success());
    assert!(out.stdout.is_empty(), "stdout: {:?}", out.stdout);
    assert!(out.stderr.is_empty(), "stderr: {:?}", out.stderr);
    assert!(dir.join("limits.json").exists());
    assert!(dir.join("limits-history.jsonl").exists());

    // Garbage input still exits 0, silently.
    let out = run_statusline(&dir.join("nested"), b"\xff\xfe nope");
    assert!(out.status.success());
    assert!(out.stdout.is_empty() && out.stderr.is_empty());

    // So does a data dir that cannot be created.
    let blocker = dir.join("limits.json");
    let out = run_statusline(&blocker.join("x"), b"{}");
    assert!(out.status.success());
    assert!(out.stdout.is_empty() && out.stderr.is_empty());

    let _ = std::fs::remove_dir_all(&dir);
}
