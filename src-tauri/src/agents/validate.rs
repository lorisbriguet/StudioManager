pub fn valid_model(m: &str) -> bool {
    matches!(m, "haiku" | "sonnet" | "opus" | "fable")
}

/// `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`
pub fn valid_name(n: &str) -> bool {
    let mut chars = n.chars();
    let Some(first) = chars.next() else { return false };
    first.is_ascii_alphanumeric()
        && n.chars().count() <= 64
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

pub fn valid_task(t: &str) -> bool {
    t.chars().count() <= 8000 && !t.starts_with('-')
}

/// `^[0-9a-f]{8}$`
pub fn valid_short_id(s: &str) -> bool {
    s.len() == 8 && s.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))
}

/// Normalises line endings; rejects empty, over-long or control-char messages.
pub fn normalise_message(s: &str) -> Option<String> {
    if s.chars().count() > 20_000 {
        return None;
    }
    let s = s.replace("\r\n", "\n").replace(['\r', '\u{2028}', '\u{2029}'], "\n");
    if s.chars().any(|c| c.is_control() && c != '\n' && c != '\t') {
        return None;
    }
    if s.trim().is_empty() {
        return None;
    }
    Some(s)
}

pub fn clamp_size(cols: u16, rows: u16) -> (u16, u16) {
    (cols.clamp(20, 400), rows.clamp(5, 200))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation_rules() {
        assert!(valid_model("fable"));
        assert!(!valid_model("gpt"));
        assert!(valid_name("a.b_c-1"));
        assert!(!valid_name("-x"));
        assert!(!valid_name(""));
        assert!(valid_name(&"a".repeat(64)));
        assert!(!valid_name(&"a".repeat(65)));
        assert!(valid_task("do it"));
        assert!(!valid_task("-rf"));
        assert!(valid_task(&"a".repeat(8000)));
        assert!(!valid_task(&"a".repeat(8001)));
        assert!(valid_short_id("0a1b2c3d"));
        assert!(!valid_short_id("0A1B2C3D"));
        assert!(!valid_short_id("0a1b2c3"));
        assert_eq!(normalise_message("a\r\nb"), Some("a\nb".to_string()));
        assert_eq!(normalise_message("a\rb\u{2028}c\u{2029}d"), Some("a\nb\nc\nd".to_string()));
        assert_eq!(normalise_message("x\u{7}"), None);
        assert_eq!(normalise_message(&"a".repeat(20_001)), None);
        assert!(normalise_message(&"a".repeat(20_000)).is_some());
        assert_eq!(normalise_message("   "), None);
        assert_eq!(normalise_message("a\tb"), Some("a\tb".to_string()));
        assert_eq!(clamp_size(5, 999), (20, 200));
        assert_eq!(clamp_size(999, 1), (400, 5));
        assert_eq!(clamp_size(80, 24), (80, 24));
    }
}
