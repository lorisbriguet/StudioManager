import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Input, Kbd, Tag, Textarea } from "../ui";
import { useT } from "../../i18n/useT";
import { addCapture, captureProjects, type CaptureProject } from "../../lib/captures";

interface CaptureFieldProps {
  source: "hotkey" | "menubar";
  autoFocus?: boolean;
  onSaved?: () => void;
  onClose?: () => void;
}

/**
 * CaptureField: one line to note a thought in the active organisation's inbox. Enter saves,
 * Shift+Enter adds a line, Tab picks a project (optional), Esc closes. It talks to the Rust
 * capture commands only (the menu bar panel and the capture panel have no SQL).
 */
export function CaptureField({ source, autoFocus, onSaved, onClose }: CaptureFieldProps) {
  const t = useT();
  const [text, setText] = useState("");
  const [project, setProject] = useState<CaptureProject | null>(null);
  const [picking, setPicking] = useState(false);
  const [projects, setProjects] = useState<CaptureProject[]>([]);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!picking) return;
    let live = true;
    captureProjects()
      .then((rows) => live && setProjects(rows ?? []))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [picking]);

  const q = filter.trim().toLowerCase();
  const shown = projects.filter((p) => !q || p.name.toLowerCase().includes(q) || p.client.toLowerCase().includes(q));

  const closePicker = () => {
    setPicking(false);
    setFilter("");
    setActive(0);
    fieldRef.current?.focus();
  };
  const pick = (p: CaptureProject) => {
    setProject(p);
    closePicker();
  };

  const save = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await addCapture(body, source, project?.id ?? null);
      setText("");
      setProject(null);
      setError(null);
      setSaved(true);
      onSaved?.();
    } catch (e) {
      // The text stays so nothing typed is lost.
      setSaved(false);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onFieldKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void save();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      setPicking(true);
    } else if (e.key === "Escape") {
      onClose?.();
    }
  };

  const onPickerKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      // Closes the picker only: the panel's own Escape handler ignores a handled key.
      e.preventDefault();
      e.stopPropagation();
      closePicker();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const p = shown[active];
      if (p) pick(p);
    }
  };

  return (
    <div className="m-2 mb-0">
      <Textarea
        ref={fieldRef}
        rows={1}
        maxRows={6}
        autoFocus={autoFocus}
        aria-label={t.capture_placeholder}
        placeholder={t.capture_placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
        onKeyDown={onFieldKey}
      />
      {project && (
        <div className="mt-1">
          <Tag name={project.name} size="xs" onRemove={() => setProject(null)} />
        </div>
      )}
      {picking && (
        <div className="mt-1 rounded-md border border-[var(--color-border-divider)]">
          <Input
            autoFocus
            aria-label={t.capture_file_project}
            placeholder={t.capture_file_project}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setActive(0);
            }}
            onKeyDown={onPickerKey}
          />
          <ul role="listbox" aria-label={t.capture_file_project} className="max-h-40 overflow-y-auto py-1">
            {shown.map((p, i) => (
              <li
                key={p.id}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
                className={`flex items-baseline gap-2 px-2 py-1 text-sm cursor-pointer ${i === active ? "bg-[var(--color-hover-row)]" : ""}`}
              >
                <span className="truncate">{p.name}</span>
                {p.client && <span className="truncate text-xs text-muted">{p.client}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-[var(--color-danger-text)]">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="mt-1 text-xs text-muted">
          {t.capture_saved}
        </p>
      )}
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <Kbd>Enter</Kbd> {t.capture_hint_enter}
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Tab</Kbd> {t.capture_hint_tab}
        </span>
        <Kbd>Esc</Kbd>
      </p>
    </div>
  );
}
