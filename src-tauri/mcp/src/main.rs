//! StudioManager agent access: MCP server over stdio.

#[tokio::main]
async fn main() {
    // A missing data dir does not stop the server: every tool reports it.
    let dir = studiomanager_mcp::env::data_dir();
    if let Err(e) = studiomanager_mcp::server::serve_stdio(dir).await {
        eprintln!("studiomanager-mcp: {e}");
        std::process::exit(1);
    }
}
