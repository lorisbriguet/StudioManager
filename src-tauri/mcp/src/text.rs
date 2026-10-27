//! Accent- and case-insensitive matching for names.

use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

/// Lowercase with accents removed: canonical decomposition (NFD), then the
/// combining marks are dropped. "Étude" and "ETUDE" both fold to "etude".
pub fn fold(s: &str) -> String {
    s.nfd()
        .filter(|c| !is_combining_mark(*c))
        .collect::<String>()
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fold_lowercases_and_strips_accents() {
        assert_eq!(fold("Étude Générale"), "etude generale");
        assert_eq!(fold("ÇA"), "ca");
    }
}
