//! StudioManager agent access: MCP server over stdio.

fn main() {
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
