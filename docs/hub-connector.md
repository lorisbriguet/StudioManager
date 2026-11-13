# Writing a hub connector

A hub is another store of work with its own files, for example a client's knowledge repository. StudioManager does not read the hub itself: it runs the hub's **connector**, a program you write, and shows what it answers. This page is the contract, version 1, for whoever writes a connector. The Agents feature is described in [the Agents guide](agents.md); the design behind hubs is in [the orchestrator design](superpowers/specs/2026-11-12-agent-orchestrator-design.md).

The app starts the connector as a program with arguments, never through a shell. The request is the last argument (`open` is followed by an id when it is for one item). Answers are one JSON object on stdout.

## Requests

| Request (last argument) | Stdin | Stdout |
|---|---|---|
| `counts` | closed | `{"version":1,"waiting":3}`, 0 to 9999 |
| `open` | closed | `{"version":1,"url":"https://…"}` or `{"version":1,"path":"/absolute/path"}`: the hub itself |
| `open <id>` | closed | the same, for one item the connector listed |
| `events` | closed | `{"version":1,"events":[{"id":"…","title":"…","start":"YYYY-MM-DD","end":"YYYY-MM-DD","note":"…"}]}`; `end` is the last day, inclusive, optional; `note` optional |
| `questions` | closed | `{"version":1,"questions":[{"id":"…","text":"…","since":"YYYY-MM-DD","recommendation":"…"}]}`; only questions waiting on the owner; `since` and `recommendation` optional |
| `capture` | `{"text":"…"}` | `{"version":1,"saved":true}` |
| anything else | | `{"version":1,"error":"unsupported"}` |

A connector may offer only some of these: answer `unsupported` to the others.

## Failures

A failure is `{"version":1,"error":"<one line>"}`, or a non-zero exit (the first line of stderr is then the message). `"error":"unsupported"` means the request is not offered: the app hides that feature for the hub and does not count it as a failure.

## Limits

- An id is 1 to 128 characters of `A-Z a-z 0-9 . _ : -`, not starting with a punctuation mark, and stable from one call to the next.
- A title is at most 200 characters; a note and a question text at most 1000; a recommendation at most 500.
- At most 2000 events and 200 questions.
- An event spans at most 366 days, between 2000-01-01 and 2100-12-31.
- No other key, at any level: an unknown key makes the whole answer invalid. `version` must be `1`. The whole stdout must be the one JSON object, with nothing after it.
- Stdout is at most 1 MiB.

## What a connector must do

- Answer within 10 seconds (30 for `capture`: write and commit first, and push afterwards, detached).
- Write nothing for `counts`, `open`, `events` and `questions`.
- Never delete anything.
- Start no model session and no agent.
- Print nothing else on stdout (logs go to stderr).
- Treat the capture text as plain data.

## What the app does with it

- It runs the connector with a cleared environment (the login `PATH`, `HOME`, `LANG`, `USER`, `TMPDIR`), in its own process group, stdin closed except for `capture`.
- Past the time limit it stops the connector and everything the connector started; past the output limit it does the same and refuses the answer.
- An answer that is not valid against this page is refused whole, and never partly used.
- Text from a connector is shown as plain text only: it is never shown as HTML or Markdown, never stored, never logged and never typed into an agent.
- Control characters are removed from the text and white space is made one space.
- A `url` is opened only if it is `http` or `https`; a `path` only if it is inside the hub's own folder.
- It never deletes anything in a hub.

A made-up connector for tests and hand checks lives at `src-tauri/src/agents/hubs/fixtures/demo-hub/connector.sh`.
