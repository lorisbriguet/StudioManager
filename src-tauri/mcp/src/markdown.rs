//! Markdown to the HTML the app's wiki editor stores. Raw HTML in the
//! Markdown is never passed through: it is shown as text.

use pulldown_cmark::{html, Event, Options, Parser, Tag, TagEnd};

/// Render CommonMark (plus strikethrough, which the editor supports) to
/// HTML. Raw HTML blocks and inline tags become escaped text.
///
/// Only `~~double~~` tildes strike through. With strikethrough alone,
/// pulldown-cmark also treats `~single~` pairs as strikethrough, so a line
/// with two `~/` paths came out struck through. The subscript option claims
/// single tildes instead, and they are put back as plain text here.
pub fn to_html(md: &str) -> String {
    let options = Options::ENABLE_STRIKETHROUGH | Options::ENABLE_SUBSCRIPT;
    let parser = Parser::new_ext(md, options).map(|ev| match ev {
        Event::Html(raw) | Event::InlineHtml(raw) => Event::Text(raw),
        Event::Start(Tag::Subscript) | Event::End(TagEnd::Subscript) => Event::Text("~".into()),
        other => other,
    });
    let mut out = String::new();
    html::push_html(&mut out, parser);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_basic_markdown() {
        let html = to_html("## Goals\n\nFresh **and** clear\n\n- one\n- two\n");
        assert!(html.contains("<h2>Goals</h2>"), "{html}");
        assert!(html.contains("<strong>and</strong>"), "{html}");
        assert!(html.contains("<li>one</li>"), "{html}");
        assert!(to_html("~~old~~").contains("<del>old</del>"));
    }

    #[test]
    fn markdown_script_tag_escaped() {
        let html = to_html("Hello <script>alert(1)</script>\n\n<div onclick=\"x\">block</div>\n");
        assert!(!html.contains("<script"), "{html}");
        assert!(!html.contains("<div"), "{html}");
        assert!(html.contains("&lt;script&gt;"), "{html}");
        assert!(html.contains("&lt;div onclick="), "{html}");
    }

    #[test]
    fn single_tildes_stay_text() {
        let html = to_html("Copy ~/a.key to ~/b and ~~drop~~ it");
        assert_eq!(html, "<p>Copy ~/a.key to ~/b and <del>drop</del> it</p>\n");
    }

    #[test]
    fn text_is_escaped() {
        assert_eq!(to_html("a & b < c"), "<p>a &amp; b &lt; c</p>\n");
    }
}
