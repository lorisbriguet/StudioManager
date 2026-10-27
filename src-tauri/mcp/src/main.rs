//! StudioManager agent access: MCP server over stdio.

#[tokio::main]
async fn main() {
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
    // A missing data dir does not stop the server: every tool reports it.
    let dir = studiomanager_mcp::env::data_dir();
    if let Err(e) = studiomanager_mcp::server::serve_stdio(dir).await {
        eprintln!("studiomanager-mcp: {e}");
        std::process::exit(1);
    }
}
