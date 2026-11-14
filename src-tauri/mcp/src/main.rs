//! StudioManager agent access: MCP server over stdio.

fn main() {
    // The PreToolUse guard of the watcher's workers: refuses with exit code 2 and one line on
    // stderr, and fails closed (a panic, bad input or a missing argument is a refusal too).
    if std::env::args().any(|a| a == "--worker-guard") {
        let args: Vec<String> = std::env::args().collect();
        std::process::exit(studiomanager_mcp::workerguard::run_process(&args));
    }
    // The only stdout use outside JSON-RPC: lets the app and docs check where
    // this binary will look for data.
    if std::env::args().any(|a| a == "--print-data-dir") {
        match studiomanager_mcp::env::data_dir() {
            Ok(dir) => println!("{}", dir.display()),
            Err(e) => {
                println!("{e}");
                std::process::exit(1);
            }
        }
        return;
    }
    // Claude Code's status line command: silent, fast, always exit 0. Claude
    // shows anything we print in the status line, so even a panic says nothing.
    // No async runtime is built for it.
    if std::env::args().any(|a| a == "--statusline") {
        std::panic::set_hook(Box::new(|_| {}));
        let _ = std::panic::catch_unwind(|| {
            if let Ok(dir) = studiomanager_mcp::env::data_dir() {
                let now_s = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0.0, |d| d.as_secs_f64());
                let _ = studiomanager_mcp::statusline::run(&dir, now_s);
            }
        });
        std::process::exit(0);
    }
    // Claude Code's Stop hook for the watcher's workers: prints only the
    // decision, never panics out, always exits 0.
    if std::env::args().any(|a| a == "--stop-hook") {
        std::panic::set_hook(Box::new(|_| {}));
        let _ = std::panic::catch_unwind(|| {
            if let Ok(dir) = studiomanager_mcp::env::data_dir() {
                studiomanager_mcp::stophook::run(&dir);
            }
        });
        std::process::exit(0);
    }
    serve();
}

#[tokio::main]
async fn serve() {
    // A missing data dir does not stop the server: every tool reports it.
    let dir = studiomanager_mcp::env::data_dir();
    if let Err(e) = studiomanager_mcp::server::serve_stdio(dir).await {
        eprintln!("studiomanager-mcp: {e}");
        std::process::exit(1);
    }
}
