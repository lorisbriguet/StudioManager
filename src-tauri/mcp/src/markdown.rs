//! Markdown to the HTML the app's wiki editor stores. Raw HTML in the
//! Markdown is never passed through: it is shown as text.

use pulldown_cmark::{html, Event, Options, Parser, Tag, TagEnd};

/// Hrefs the wiki editor accepts (`isAllowedWikiLink` in
/// `src/lib/wikiLinks.ts`): web links and the app's own `/wiki?` links.
pub fn allowed_href(url: &str) -> bool {
    let u = url.trim().to_ascii_lowercase();
    u.starts_with("https://") || u.starts_with("http://") || u.starts_with("/wiki?")
}

/// Render CommonMark (plus strikethrough, which the editor supports) to
/// HTML. Raw HTML blocks and inline tags become escaped text, and a link
/// the editor would refuse (`javascript:`, `data:`, `mailto:`, …) keeps
/// only its text.
///
/// Only `~~double~~` tildes strike through. With strikethrough alone,
/// pulldown-cmark also treats `~single~` pairs as strikethrough, so a line
/// with two `~/` paths came out struck through. The subscript option claims
/// single tildes instead, and they are put back as plain text here.
pub fn to_html(md: &str) -> String {
    let options = Options::ENABLE_STRIKETHROUGH | Options::ENABLE_SUBSCRIPT;
    // One entry per open link: true when its tags were dropped.
    let mut dropped: Vec<bool> = Vec::new();
    let parser = Parser::new_ext(md, options).filter_map(|ev| match ev {
        Event::Html(raw) | Event::InlineHtml(raw) => Some(Event::Text(raw)),
        Event::Start(Tag::Subscript) | Event::End(TagEnd::Subscript) => Some(Event::Text("~".into())),
        Event::Start(Tag::Link { link_type, dest_url, title, id }) => {
            let keep = allowed_href(&dest_url);
            dropped.push(!keep);
            keep.then(|| {
                let dest_url = dest_url.trim().to_string().into();
                Event::Start(Tag::Link { link_type, dest_url, title, id })
            })
        }
        Event::End(TagEnd::Link) => (!dropped.pop().unwrap_or(false)).then_some(Event::End(TagEnd::Link)),
        other => Some(other),
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
    fn only_links_the_editor_accepts_are_kept() {
        let html = to_html(
            "[a](javascript:alert(1)) [b](https://x.test/p) [c](/wiki?article=4) \
             [d](mailto:me@x.test) [e](data:text/html,x) [f](HTTP://X.TEST) <javascript:alert(2)> \
             [g]( /wiki?file=2:a.md)",
        );
        assert_eq!(html.matches("href=").count(), 4, "{html}");
        assert!(html.contains("<p>a <a"), "{html}");
        // An autolink to a refused scheme stays as text.
        assert!(html.contains("</a> javascript:alert(2) <a"), "{html}");
        assert!(html.contains("a <a href=\"https://x.test/p\">b</a>"), "{html}");
        assert!(html.contains("<a href=\"/wiki?article=4\">c</a> d e"), "{html}");
        assert!(html.contains("<a href=\"HTTP://X.TEST\">f</a>"), "{html}");
        assert!(html.contains("<a href=\"/wiki?file=2:a.md\">g</a>"), "{html}");
    }

    #[test]
    fn text_is_escaped() {
        assert_eq!(to_html("a & b < c"), "<p>a &amp; b &lt; c</p>\n");
    }
}
