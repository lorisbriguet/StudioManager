import { useEffect, useRef, useState } from "react";
import { conversation, type Item } from "../../lib/agents";
import { useT } from "../../i18n/useT";

const REFRESH_MS = 3000;

interface ConversationProps {
  sessionId: string;
  /** Refetch every 3 s while true. */
  working: boolean;
}

export function Conversation({ sessionId, working }: ConversationProps) {
  const t = useT();
  const [items, setItems] = useState<Item[]>([]);
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
        .then((list) => alive && setItems(list))
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

  if (items.length === 0) return <p className="text-sm text-muted">{t.agents_no_conversation}</p>;

  return (
    <div className="space-y-3">
      {items.map((it, i) =>
        it.kind === "tool" ? (
          <div key={i} className="text-xs text-muted font-mono truncate">
            {it.name} · {it.summary}
          </div>
        ) : (
          <div
            key={i}
            className={`text-sm whitespace-pre-wrap rounded-lg px-3 py-2 ${
              it.kind === "user" ? "bg-accent-light" : "bg-[var(--color-input-bg)]"
            }`}
          >
            {it.text}
          </div>
        ),
      )}
      <div ref={endRef} />
    </div>
  );
}
