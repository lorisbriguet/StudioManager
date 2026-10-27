fn main() {
    // Tauri's externalBin needs the MCP server binary for the build target.
    // It is git-ignored, so a fresh clone lacks it; say how to create it.
    if let Ok(triple) = std::env::var("TARGET") {
        let dir = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default())
            .join("binaries");
        let bin = dir.join(format!("studiomanager-mcp-{triple}"));
        if !bin.exists() {
            println!(
                "cargo:warning=missing {}: run `bash scripts/build-mcp.sh` once before cargo commands in src-tauri",
                bin.display()
            );
        }
    }
    tauri_build::build()
}
