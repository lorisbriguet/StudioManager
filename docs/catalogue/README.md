# Component catalogue and deep dives

The pages that document the UI component library outside the code. The rules themselves live in [DESIGN-SYSTEM.md](../../DESIGN-SYSTEM.md); these pages show them.

## Component catalogue

Every building block in `src/components/ui/` with a live preview, its file, its main props and the deep dive that decided it, plus the tokens and the rules.

- Published: https://claude.ai/artifact/PPrCQ5FNSjXZzT9vUCRNgy
- Source: `make_catalogue.py`. Each component is one `add(category, name, path, props, preview_html, deep_dive_key, keywords)` call.

When a component is added or changes:

1. Add or edit its `add(...)` entry in `make_catalogue.py`.
2. Run `python3 docs/catalogue/make_catalogue.py` (writes `out/library.html`).
3. Republish `out/library.html` to the same artifact URL (in Claude Code: publish the file with that `url`).

## Deep dives

One page per topic: what's inconsistent today, the proposal, the rules, and the decisions. All of them are built.

| Topic | Page | Source |
|--|--|--|
| Dropdown | https://claude.ai/artifact/ByQ9fZTPqMmURLyBVYN5o2 | not kept (hand-written) |
| Button | https://claude.ai/artifact/1wWC1A5CxpM4qxsXjd6wbw | not kept; its `<style>` is `deep-dives/style-source.html` |
| IconButton | https://claude.ai/artifact/BMjCuNLsU3XthiC8Vjmewo | not kept |
| Pills | https://claude.ai/artifact/WcEWyoB8NSz8JSJTRS5Si3 | not kept |
| Tables | https://claude.ai/artifact/2ouWVX3Px4aJAjD1TmA35F | `deep-dives/make_tables.py` |
| Forms | https://claude.ai/artifact/Tc2Xgh2qUzpMoz2qugi3xu | `deep-dives/make_forms.py` |
| Input · Textarea | https://claude.ai/artifact/7oFApoaS3Kk8s4SueZFBum | `deep-dives/make_inputs.py` |
| Modals | https://claude.ai/artifact/Bgj1W8pdxUJVNog8TYCspt | `deep-dives/make_modals.py` |
| Headings | https://claude.ai/artifact/PW8i7ppaeocJjTmXYfugPE | `deep-dives/make_headings.py` |
| Cards | https://claude.ai/artifact/6UPEn5uEzA2j7bwRTXrv7g | `deep-dives/make_cards.py` |
| Toasts | https://claude.ai/artifact/Syq8ZG6ZUxqK9YEVQgxhfL | `deep-dives/make_toasts.py` |
| Confirmations | https://claude.ai/artifact/9osPvUjkXqF1FvYqFVYtqQ | `deep-dives/make_confirms.py` |
| Empty, loading and error states | https://claude.ai/artifact/RU53Wmo2RU1titRqLpJCkk | `deep-dives/make_states.py` |
| Colours | https://claude.ai/artifact/K5b9minhUmGVf2Ng11F9KS | `deep-dives/make_colours.py` |
| Icons | https://claude.ai/artifact/HodmptMk3P6XyoH1A2wLWh | `deep-dives/make_icons.py` |

The generators rebuild each page as it was proposed, with its "To decide" list. `deep-dives/mark_built.py <file>.html "<note>"` turns that list into "Decided · built" and adds the green banner, as the published pages show.

### Starting a new deep dive

`deep-dives/dd.py` is the shared kit (page skeleton, light and dark tokens, theme switch, `var`, `table`, `rules`, `code` helpers). Copy one of the `make_*.py` files, fill in today / proposal / rules / decisions, run it, and publish `deep-dives/out/<name>.html`. Add the page to the table above and to `DD` in `make_catalogue.py`.

The process: survey the code, publish the page, decide in its comments, build, then mark it built and update the catalogue.
