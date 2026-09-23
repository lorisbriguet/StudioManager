//! Dev helper: run the organisation layout upgrade on a folder path.
fn main() {
    let dir = std::env::args().nth(1).expect("usage: rehearse-upgrade <app data dir copy>");
    match app_lib::upgrade::run(std::path::Path::new(&dir)) {
        Ok(reg) => println!("upgraded; active org {}", reg.active_id),
        Err(e) => { eprintln!("upgrade failed: {e}"); std::process::exit(1); }
    }
}
