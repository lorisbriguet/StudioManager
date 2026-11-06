use super::projects::wiki_for_project;
use super::*;

pub fn list_wiki(conn: &Connection, project: &str) -> R<Vec<ArticleRef>> {
    let id = resolve_project(conn, project)?;
    wiki_for_project(conn, id)
}

pub fn get_wiki_article(conn: &Connection, project: &str, title: &str) -> R<Article> {
    let id = resolve_project(conn, project)?;
    let mut stmt = db(conn.prepare(
        "SELECT id, title, content FROM wiki_articles WHERE project_id = ?1 \
         ORDER BY sort_order ASC, id ASC",
    ))?;
    let rows: Vec<(i64, String, String)> = db(stmt
        .query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .and_then(|rows| rows.collect()))?;
    let items: Vec<(usize, String, String)> = rows
        .iter()
        .enumerate()
        .map(|(i, (aid, t, _))| (i, aid.to_string(), t.clone()))
        .collect();
    let i = pick("article", title, &items)?;
    let (_, t, html) = &rows[i];
    Ok(Article {
        title: t.clone(),
        markdown: html_to_markdown(html),
        html: html.clone(),
    })
}

fn decode_entities(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
}

/// Make `out` end with exactly `n` newlines (no-op when empty).
fn end_with_newlines(out: &mut String, n: usize) {
    if out.is_empty() {
        return;
    }
    let trimmed = out.trim_end_matches([' ', '\n']).len();
    out.truncate(trimmed);
    for _ in 0..n {
        out.push('\n');
    }
}

/// Pulls one attribute out of a tag's source, e.g. `href` from `a href="x"`.
fn tag_attr(tag: &str, name: &str) -> Option<String> {
    // ASCII lowercasing keeps byte offsets, so indexes match `tag`.
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(i) = lower[from..].find(name) {
        let at = from + i;
        from = at + name.len();
        if at == 0 || !lower.as_bytes()[at - 1].is_ascii_whitespace() {
            continue;
        }
        let Some(rest) = tag[from..].trim_start().strip_prefix('=') else {
            continue;
        };
        let rest = rest.trim_start();
        let value = match rest.chars().next() {
            Some(q @ ('"' | '\'')) => rest[1..].split(q).next().unwrap_or(""),
            _ => rest.split(char::is_whitespace).next().unwrap_or(""),
        };
        return Some(decode_entities(value));
    }
    None
}

/// Backslash-escapes the characters that would turn plain text into
/// Markdown formatting when the article is written back. Intraword `_`
/// (file_name) and lone `~` (~/path) are left alone: they can't format.
fn escape_markdown(text: &str, at_line_start: bool) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut line_start = at_line_start;
    for (i, &c) in chars.iter().enumerate() {
        let before = i.checked_sub(1).map(|j| chars[j]);
        let after = chars.get(i + 1).copied();
        let escape = match c {
            '\\' | '*' | '`' | '[' => true,
            '_' => !(before.is_some_and(char::is_alphanumeric)
                && after.is_some_and(char::is_alphanumeric)),
            '~' => before == Some('~') || after == Some('~'),
            // Would start a heading, quote or list at the start of a line.
            '#' | '>' | '-' | '+' => line_start,
            _ => false,
        };
        if escape {
            out.push('\\');
        }
        out.push(c);
        if c == '\n' {
            line_start = true;
        } else if !c.is_whitespace() {
            line_start = false;
        }
    }
    out
}

/// Inline formatting open while walking the HTML.
enum Mark {
    /// Markdown delimiter (`**`, `*`, `~~`) and where its content starts.
    Wrap(&'static str, usize),
    /// Link target and where the link text starts.
    Link(Option<String>, usize),
    /// Inline code: where its content starts.
    Code(usize),
}

/// The editor's HTML as Markdown that `markdown::to_html` turns back into
/// the same article: headings, lists, links, code, bold, italic and
/// strikethrough are kept, so reading an article and writing it back with
/// a small edit loses nothing else.
pub fn html_to_markdown(html: &str) -> String {
    let mut out = String::new();
    // One entry per open list: Some(next number) for <ol>, None for <ul>.
    let mut lists: Vec<Option<usize>> = Vec::new();
    // Width of each open list item's marker, for nested indentation.
    let mut li_widths: Vec<usize> = Vec::new();
    let mut marks: Vec<Mark> = Vec::new();
    let mut in_pre = false;
    let mut rest = html;

    let push_text = |out: &mut String, raw: &str, marks: &[Mark], in_pre: bool| {
        let text = decode_entities(raw);
        let in_code = marks.iter().any(|m| matches!(m, Mark::Code(_)));
        // A line break between tags is source layout, not content.
        if !in_pre && text.contains('\n') && text.trim().is_empty() {
            return;
        }
        if in_pre || in_code {
            out.push_str(&text);
        } else {
            let at_line_start = out.is_empty() || out.ends_with('\n');
            out.push_str(&escape_markdown(&text, at_line_start));
        }
    };

    while let Some(lt) = rest.find('<') {
        push_text(&mut out, &rest[..lt], &marks, in_pre);
        let after = &rest[lt + 1..];
        let Some(gt) = after.find('>') else {
            rest = "";
            break;
        };
        let tag = after[..gt].trim();
        rest = &after[gt + 1..];
        let closing = tag.starts_with('/');
        let name: String = tag
            .trim_start_matches('/')
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_lowercase();
        let wrap = match name.as_str() {
            "strong" | "b" => Some("**"),
            "em" | "i" => Some("*"),
            "s" | "del" | "strike" => Some("~~"),
            _ => None,
        };
        match (name.as_str(), closing) {
            ("h1" | "h2" | "h3", false) => {
                end_with_newlines(&mut out, 2);
                out.push_str(&"#".repeat(name[1..].parse::<usize>().unwrap_or(1)));
                out.push(' ');
            }
            ("h1" | "h2" | "h3", true) => end_with_newlines(&mut out, 2),
            // A top-level list is its own block; a nested one sits under its item.
            ("ul", false) => {
                end_with_newlines(&mut out, if lists.is_empty() { 2 } else { 1 });
                lists.push(None);
            }
            ("ol", false) => {
                end_with_newlines(&mut out, if lists.is_empty() { 2 } else { 1 });
                let first = tag_attr(tag, "start").and_then(|v| v.parse().ok());
                lists.push(Some(first.unwrap_or(1)));
            }
            ("ul" | "ol", true) => {
                lists.pop();
                end_with_newlines(&mut out, if lists.is_empty() { 2 } else { 1 });
            }
            ("li", false) => {
                // Start a new line, but keep a blank line the list opened with.
                if !out.is_empty() && !out.ends_with('\n') {
                    end_with_newlines(&mut out, 1);
                }
                let marker = match lists.last_mut() {
                    Some(Some(n)) => {
                        *n += 1;
                        format!("{}. ", *n - 1)
                    }
                    _ => "- ".to_string(),
                };
                out.push_str(&" ".repeat(li_widths.iter().sum()));
                out.push_str(&marker);
                li_widths.push(marker.len());
            }
            ("li", true) => {
                li_widths.pop();
                end_with_newlines(&mut out, 1);
            }
            ("p", true) => end_with_newlines(&mut out, if li_widths.is_empty() { 2 } else { 1 }),
            ("br", _) => out.push('\n'),
            ("hr", _) => {
                end_with_newlines(&mut out, 2);
                out.push_str("---");
                end_with_newlines(&mut out, 2);
            }
            ("pre", false) => {
                end_with_newlines(&mut out, 2);
                out.push_str("```\n");
                in_pre = true;
            }
            ("pre", true) => {
                in_pre = false;
                end_with_newlines(&mut out, 1);
                out.push_str("```");
                end_with_newlines(&mut out, 2);
            }
            ("code", false) if !in_pre => marks.push(Mark::Code(out.len())),
            ("a", false) => {
                marks.push(Mark::Link(tag_attr(tag, "href"), out.len()));
                out.push('[');
            }
            (_, false) if wrap.is_some() => {
                let delim = wrap.unwrap_or_default();
                out.push_str(delim);
                marks.push(Mark::Wrap(delim, out.len()));
            }
            (_, true) => close_mark(&mut out, &mut marks, &name),
            _ => {}
        }
    }
    push_text(&mut out, rest, &marks, in_pre);
    out.trim().to_string()
}

/// Closes the innermost open mark matching the closing tag `name`.
fn close_mark(out: &mut String, marks: &mut Vec<Mark>, name: &str) {
    let matches = |m: &Mark| {
        matches!(
            (m, name),
            (Mark::Code(_), "code")
                | (Mark::Link(..), "a")
                | (Mark::Wrap("**", _), "strong" | "b")
                | (Mark::Wrap("*", _), "em" | "i")
                | (Mark::Wrap("~~", _), "s" | "del" | "strike")
        )
    };
    let Some(i) = marks.iter().rposition(matches) else {
        return;
    };
    match marks.remove(i) {
        Mark::Wrap(delim, start) => {
            if out.len() == start {
                // Empty bold/italic: drop the opening delimiter.
                out.truncate(start - delim.len());
            } else {
                out.push_str(delim);
            }
        }
        Mark::Link(href, start) => match href {
            Some(href) if !href.is_empty() => {
                if href.contains([' ', '(', ')', '<', '>']) {
                    out.push_str(&format!("](<{href}>)"));
                } else {
                    out.push_str(&format!("]({href})"));
                }
            }
            // No target: keep the text, drop the bracket.
            _ => {
                out.remove(start);
            }
        },
        Mark::Code(start) => {
            let inner = out.split_off(start);
            // Fence longer than any backtick run inside, padded when the
            // content starts or ends with a backtick.
            let longest = inner
                .split(|c| c != '`')
                .map(str::len)
                .max()
                .unwrap_or(0);
            let fence = "`".repeat(longest + 1);
            let pad = if inner.starts_with('`') || inner.ends_with('`') { " " } else { "" };
            out.push_str(&format!("{fence}{pad}{inner}{pad}{fence}"));
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::read::test_util::*;
    use super::*;

    #[test]
    fn wiki_list_and_article() {
        let c = fixture();
        let l = list_wiki(&c, "1").unwrap();
        assert_eq!(
            l.iter().map(|a| a.title.as_str()).collect::<Vec<_>>(),
            ["Brief", "Decisions"]
        );
        let a = get_wiki_article(&c, "Identité Visuelle", "brief").unwrap();
        assert_eq!(a.title, "Brief");
        assert!(a.html.starts_with("<h2>"));
        assert_eq!(a.markdown, "## Goals\n\nFresh & clear");
        assert!(get_wiki_article(&c, "1", "missing")
            .unwrap_err()
            .starts_with("No article matches"));
    }

    #[test]
    fn wiki_markdown_rendering_of_list() {
        let c = fixture();
        let a = get_wiki_article(&c, "1", "Decisions").unwrap();
        assert_eq!(a.markdown, "- **2026-10-01** Use blue\n- Keep it <simple>");
        assert_eq!(
            html_to_markdown("a<br>b &quot;q&quot; &#39;s&#39;"),
            "a\nb \"q\" 's'"
        );
    }

    #[test]
    fn wiki_markdown_keeps_links_code_and_marks() {
        let html = "<h2>Run</h2><ul><li><p>Copy <code>~/a.key</code> to <code>~/b</code></p></li>\
            <li><p><code>__tests__/</code> holds the suites</p></li></ul>\
            <p>See <a href=\"/wiki?article=36\">Decisions</a>, <strong>bold</strong>, \
            <em>it</em> and <s>old</s>.</p>";
        let md = html_to_markdown(html);
        assert_eq!(
            md,
            "## Run\n\n- Copy `~/a.key` to `~/b`\n- `__tests__/` holds the suites\n\n\
             See [Decisions](/wiki?article=36), **bold**, *it* and ~~old~~."
        );
        let back = crate::markdown::to_html(&md);
        assert!(back.contains("<code>~/a.key</code>"), "{back}");
        assert!(back.contains("<a href=\"/wiki?article=36\">Decisions</a>"), "{back}");
        assert!(back.contains("<del>old</del>"), "{back}");
        // Writing it back and reading it again changes nothing.
        assert_eq!(html_to_markdown(&back), md);
    }

    #[test]
    fn wiki_markdown_plain_text_stays_plain() {
        let html = "<p>__init__ and 5 * 3 and [x] and a_b and ~/x and ~~y</p><p>- not a list</p>";
        let back = crate::markdown::to_html(&html_to_markdown(html));
        assert_eq!(
            back,
            "<p>__init__ and 5 * 3 and [x] and a_b and ~/x and ~~y</p>\n<p>- not a list</p>\n"
        );
    }

    #[test]
    fn wiki_markdown_ordered_and_nested_lists() {
        let html = "<ol><li><p>one</p><ul><li><p>sub</p></li></ul></li><li><p>two</p></li></ol>";
        let md = html_to_markdown(html);
        assert_eq!(md, "1. one\n   - sub\n2. two");
        let back = crate::markdown::to_html(&md);
        assert!(back.contains("<ol>") && back.contains("<ul>"), "{back}");
    }

    #[test]
    fn wiki_markdown_code_block_and_odd_links() {
        let md = html_to_markdown(
            "<pre><code>npm run *dev*\n</code></pre><p><a href=\"https://x.ch/a b\">x</a> <a>bare</a> <code>a`b</code></p>",
        );
        assert_eq!(
            md,
            "```\nnpm run *dev*\n```\n\n[x](<https://x.ch/a b>) bare ``a`b``"
        );
    }

}
