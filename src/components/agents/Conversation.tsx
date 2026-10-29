import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronRight } from "lucide-react";
import { conversation, type Item } from "../../lib/agents";
import { useT } from "../../i18n/useT";
import { EmptyState, ICONS, ICON_SIZE } from "../ui";

const REFRESH_MS = 3000;

interface ConversationProps {
  sessionId: string;
  /** Refetch every 3 s while true. */
  working: boolean;
}

export function Conversation({ sessionId, working }: ConversationProps) {
  const t = useT();
  const [items, setItems] = useState<Item[]>([]);
  /** The session whose first load is in: from then on, new replies are announced. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setItems([]);
  }, [sessionId]);

  useEffect(() => {
    // Per-effect token: a response for a previous session is ignored.
    let alive = true;
    // One call at a time: a slow call never piles up or resolves out of order.
    let inflight = false;
    const load = () => {
      if (inflight) return;
      inflight = true;
      conversation(sessionId)
        .then((list) => {
          if (!alive) return;
          setItems(list);
          setLoadedFor(sessionId);
        })
        // Keep what is shown; the next refresh may succeed.
        .catch(() => {})
        .finally(() => {
          inflight = false;
        });
    };
    void load();
    const timer = working ? setInterval(load, REFRESH_MS) : null;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [sessionId, working]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [items]);

  // A live region: replies that arrive (or grow, while the agent works) are read out
  // without moving focus. It turns on after a session's first load, so opening an
  // agent doesn't read out its whole history.
  const live = loadedFor === sessionId;
  return (
    <div role={live ? "log" : undefined} aria-live={live ? "polite" : undefined}>
      {items.length === 0 ? (
        <EmptyState icon={ICONS.agents} message={t.agents_no_conversation} />
      ) : (
        <div className="max-w-3xl mx-auto px-5 py-5 space-y-6">
          {groupTools(items).map((g, i) =>
            g.kind === "tools" ? (
              <ToolRun key={i} tools={g.tools} />
            ) : g.item.kind === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-xl bg-[var(--color-input-bg)] px-4 py-2.5 text-sm whitespace-pre-wrap break-words">
                  {g.item.text}
                </div>
              </div>
            ) : g.item.kind === "assistant" ? (
              <div key={i} className="agent-markdown text-sm leading-relaxed break-words">
                <Markdown remarkPlugins={[remarkGfm]}>{g.item.text}</Markdown>
              </div>
            ) : null,
          )}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}

type ToolItem = Extract<Item, { kind: "tool" }>;
type Group = { kind: "tools"; tools: ToolItem[] } | { kind: "message"; item: Item };

/** Folds each run of consecutive tool calls into one group, like the desktop app. */
function groupTools(items: Item[]): Group[] {
  const out: Group[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (it.kind === "tool") {
      if (last?.kind === "tools") last.tools.push(it);
      else out.push({ kind: "tools", tools: [it] });
    } else {
      out.push({ kind: "message", item: it });
    }
  }
  return out;
}

function ToolRun({ tools }: { tools: ToolItem[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = tools.length === 1 ? `${t.agents_used_tool} ${tools[0].name}` : t.agents_used_tools.replace("{n}", String(tools.length));
  return (
    <div className="text-xs text-muted">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 -mx-1.5 hover:bg-[var(--color-hover-row)] hover:text-[var(--color-text)]"
      >
        <ChevronRight size={ICON_SIZE.control} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        {label}
      </button>
      {open && (
        <ul className="mt-1.5 ml-1.5 pl-3 border-l border-[var(--color-border-divider)] space-y-1">
          {tools.map((tool, i) => (
            <li key={i} className="font-mono truncate">
              <span className="text-[var(--color-text)]">{tool.name}</span>
              {tool.summary && <span> · {tool.summary}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
