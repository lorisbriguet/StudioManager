import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { listen } from "@tauri-apps/api/event";
import { useT } from "../../i18n/useT";
import { Button, Card, PANEL_TOP_BAR } from "../ui";
import {
  AGENTS_TERM,
  AGENTS_TERM_EXIT,
  termClose,
  termOpen,
  termResize,
  termWrite,
  type TermData,
  type TermExit,
} from "../../lib/agents";

interface TerminalPanelProps {
  shortId: string;
  onClose: () => void;
}

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Chunks kept while termOpen is pending: the first redraw is small, so only
// the newest few are needed; this bounds memory if the open hangs.
const MAX_BUFFERED = 256;

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function TerminalPanel({ shortId, onClose }: TerminalPanelProps) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      theme: {
        background: cssVar("--color-surface", "#161616"),
        foreground: cssVar("--color-text", "#e5e5e5"),
        cursor: cssVar("--color-accent", "#2563eb"),
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);

    // Fits whole rows into the panel, then makes sure the grid really is no taller than the
    // room: fit measures a row before the font has loaded (or on a rounding edge), and a grid
    // a fraction too tall hides Claude's last line, the footer with the sub-agent count.
    const fitToHost = (): boolean => {
      try {
        fit.fit();
      } catch {
        return false; // not laid out yet: keep the current size
      }
      const screen = el.querySelector<HTMLElement>(".xterm-screen");
      if (!screen) return true;
      const style = getComputedStyle(el);
      const room = el.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
      for (let i = 0; i < 3 && room > 0 && term.rows > 2 && screen.offsetHeight > room + 0.5; i++) {
        term.resize(term.cols, term.rows - 1);
      }
      return true;
    };
    fitToHost();

    let disposed = false;
    let termId: number | null = null;
    let exited = false;
    let buffered: TermData[] = [];
    const earlyExits = new Set<number>();
    const unlisten: Array<() => void> = [];

    // Output can still arrive while the panel closes (listeners unsubscribe asynchronously);
    // writing to a disposed xterm throws later from its renderer.
    const feed = (d: TermData) => {
      if (!disposed) term.write(decode(d.data));
    };

    // Shift+Enter adds a line in Claude's input instead of sending: Claude reads
    // Esc+Return as a newline (what its /terminal-setup binds). Plain Enter sends.
    term.attachCustomKeyEventHandler((e) => {
      if (e.key === "Enter" && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.type === "keydown" && termId !== null && !exited) termWrite(termId, "\x1b\r").catch(() => {});
        return false;
      }
      return true;
    });
    const onData = term.onData((data) => {
      if (termId !== null && !exited) termWrite(termId, data).catch(() => {});
    });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => refit());
      resizeObserver.observe(el);
    }
    // Tells the agent the new size once the terminal is open.
    function refit() {
      if (disposed || !fitToHost()) return;
      if (termId !== null && !exited) termResize(termId, term.cols, term.rows).catch(() => {});
    }
    // Once the font is in, a row measures differently: fit again.
    void document.fonts?.ready.then(refit);

    (async () => {
      // Subscribe first: the backend emits the first redraw before termOpen resolves.
      const subs = await Promise.all([
        listen<TermData>(AGENTS_TERM, (e) => {
          if (termId === null) {
            buffered.push(e.payload);
            if (buffered.length > MAX_BUFFERED) buffered.shift();
          }
          else if (e.payload.termId === termId) feed(e.payload);
        }),
        listen<TermExit>(AGENTS_TERM_EXIT, (e) => {
          if (termId === null) {
            if (earlyExits.size < MAX_BUFFERED) earlyExits.add(e.payload.termId);
          }
          else if (e.payload.termId === termId) {
            exited = true;
            setEnded(true);
          }
        }),
      ]);
      unlisten.push(...subs);
      if (disposed) {
        unlisten.forEach((u) => u());
        return;
      }
      try {
        const id = await termOpen(shortId, term.cols, term.rows);
        if (disposed) {
          termClose(id).catch(() => {});
          return;
        }
        termId = id;
        const early = buffered;
        buffered = [];
        early.filter((d) => d.termId === id).forEach(feed);
        if (earlyExits.has(id)) {
          exited = true;
          setEnded(true);
        }
      } catch (err) {
        // Open failed: nothing will ever be matched, so stop listening and drop buffers.
        buffered = [];
        earlyExits.clear();
        unlisten.splice(0).forEach((u) => u());
        if (!disposed) setError(String(err));
      }
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      unlisten.forEach((u) => u());
      onData.dispose();
      if (termId !== null && !exited) termClose(termId).catch(() => {});
      // xterm schedules its scroll-area refresh on the next animation frame; disposing
      // before it runs makes that refresh throw ("_renderer.value.dimensions").
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => requestAnimationFrame(() => term.dispose()));
      } else {
        term.dispose();
      }
    };
  }, [shortId]);

  return (
    // Tall enough for Claude's sub-agents list (about 30 rows); the toggle gives it most of the window.
    <Card
      tone="inset"
      padding="none"
      className={`overflow-hidden flex flex-col shrink-0 ${expanded ? "h-[80vh]" : "h-[min(28rem,60vh)]"}`}
    >
      <div className={`${PANEL_TOP_BAR} justify-between px-3 border-[var(--color-border)]`}>
        <span className="text-sm text-muted">
          {ended ? t.agents_terminal_closed : shortId}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" aria-pressed={expanded} onClick={() => setExpanded((e) => !e)}>
            {expanded ? t.agents_terminal_shrink : t.agents_terminal_expand}
          </Button>
          <Button variant="outline" onClick={onClose}>
            {t.agents_terminal_close}
          </Button>
        </div>
      </div>
      {error && <p role="alert" className="p-3 text-sm text-[var(--color-danger-text)]">{error}</p>}
      {/* The padding sits here, not on the host: xterm's fit reads its parent's height with the
          parent's own padding in it, and would count one row too many. */}
      <div className={error ? "hidden" : "flex-1 min-h-0 p-2"}>
        <div ref={host} className="h-full w-full overflow-hidden" />
      </div>
    </Card>
  );
}
