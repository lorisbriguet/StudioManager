use std::io::Write;
use std::process::{Command, Output, Stdio};

fn run_guard(args: &[&str], stdin: &[u8]) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_studiomanager-mcp"))
        .arg("--worker-guard")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // The guard may exit before it reads a thing (a missing argument): ignore a broken pipe.
    let _ = child.stdin.take().unwrap().write_all(stdin);
    child.wait_with_output().unwrap()
}

const ARGS: [&str; 6] = ["--worktree", "/tmp/sm-guard-none/wt", "--branch", "sm/task-1", "--settings", "/tmp/sm-guard-none/app/hook-settings-sm-task-1.json"];

#[test]
fn a_refusal_is_exit_code_2_with_one_line_on_stderr() {
    let out = run_guard(
        &ARGS,
        br#"{"tool_name":"Bash","tool_input":{"command":"gh pr create --title x"},"cwd":"/tmp"}"#,
    );
    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty());
    let err = String::from_utf8(out.stderr).unwrap();
    assert_eq!(err.trim_end().lines().count(), 1, "{err:?}");
    assert!(err.contains("The app opens the pull request after your push"), "{err}");
}

#[test]
fn a_pass_is_exit_code_0_and_silent() {
    let out = run_guard(&ARGS, br#"{"tool_name":"Bash","tool_input":{"command":"git status"},"cwd":"/tmp"}"#);
    assert_eq!(out.status.code(), Some(0));
    assert!(out.stdout.is_empty() && out.stderr.is_empty());
    let out = run_guard(&ARGS, br#"{"tool_name":"Write","tool_input":{"file_path":"/tmp/sm-guard-none/wt/src/a.rs"}}"#);
    assert_eq!(out.status.code(), Some(0));
}

#[test]
fn bad_input_or_missing_arguments_fail_closed() {
    for stdin in [&b""[..], b"garbage", b"\xff\xfe nope", b"{}", b"[]", b"null"] {
        let out = run_guard(&ARGS, stdin);
        assert_eq!(out.status.code(), Some(2), "{stdin:?}");
        assert!(out.stdout.is_empty());
        assert_eq!(String::from_utf8(out.stderr).unwrap().trim_end().lines().count(), 1);
    }
    let ok = br#"{"tool_name":"Bash","tool_input":{"command":"git status"}}"#;
    assert_eq!(run_guard(&[], ok).status.code(), Some(2));
    assert_eq!(run_guard(&ARGS[..4], ok).status.code(), Some(2));
    assert_eq!(run_guard(&["--worktree", "rel", "--branch", "b", "--settings", "rel.json"], ok).status.code(), Some(2));
}
