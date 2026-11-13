//! Hubs: other stores of work (a client's knowledge repository) that StudioManager reads through a
//! connector program. The contract is in docs/hub-connector.md.

// Nothing outside the module calls these yet (`mod agents` is private to the crate): the task
// that adds the hub commands removes this allow.
#![allow(dead_code)]

pub mod contract;
pub mod retry;
pub mod run;

#[cfg(test)]
mod tests {
    use std::path::Path;

    fn rust_files(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let p = entry.path();
            if p.is_dir() {
                rust_files(&p, out);
            } else if p.extension().is_some_and(|e| e == "rs") {
                out.push(p);
            }
        }
    }

    /// A hub's connector is a program that only answers: nothing here starts a model session or
    /// an agent. The needles are built in pieces so this file does not contain them.
    #[test]
    fn hubs_start_no_session() {
        let needles = [
            ["start_with", "("].concat(),
            ["actions::", "start"].concat(),
            ["real_", "cli"].concat(),
            ["\"cl", "aude\""].concat(),
        ];
        let mut files = Vec::new();
        rust_files(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src/agents/hubs"), &mut files);
        assert!(files.len() >= 3);
        for f in files {
            let text = std::fs::read_to_string(&f).unwrap();
            for n in &needles {
                assert!(!text.contains(n.as_str()), "{} contains {n}", f.display());
            }
        }
    }
}
