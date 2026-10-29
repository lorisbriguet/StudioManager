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
    try {
      fit.fit();
    } catch {
      /* not laid out yet: keep the default size */
    }

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
      resizeObserver = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          return;
        }
        if (termId !== null && !exited) termResize(termId, term.cols, term.rows).catch(() => {});
      });
      resizeObserver.observe(el);
    }

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
    <Card tone="inset" padding="none" className="overflow-hidden flex flex-col h-72 shrink-0">
      <div className={`${PANEL_TOP_BAR} justify-between px-3 border-[var(--color-border)]`}>
        <span className="text-sm text-muted">
          {ended ? t.agents_terminal_closed : shortId}
        </span>
        <Button variant="outline" onClick={onClose}>
          {t.agents_terminal_close}
        </Button>
      </div>
      {error && <p role="alert" className="p-3 text-sm text-[var(--color-danger-text)]">{error}</p>}
      <div ref={host} className={error ? "hidden" : "flex-1 min-h-0 p-2 overflow-hidden"} />
    </Card>
  );
}
