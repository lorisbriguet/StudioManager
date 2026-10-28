import { useEffect, useState } from "react";
import { startAgent, startFolders, type StartFolder } from "../../lib/agents";
import { useT } from "../../i18n/useT";
import { Button, FormField, Select } from "../ui";

const MODELS = ["sonnet", "opus", "haiku", "fable"];
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Lowercase, spaces to "-", only [a-z0-9._-], repeats collapsed, leading non-alphanumerics trimmed, max 64. */
export function slugifyName(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/([._-])\1+/g, "$1")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 64);
}

function folderOptionText(f: StartFolder): string {
  const l = f.label;
  return l ? `${l.orgName} › ${l.clientName} › ${l.projectName} — ${f.path}` : f.path;
}

interface StartAgentFormProps {
  onStarted: (shortId: string) => void;
  onCancel: () => void;
}

export function StartAgentForm({ onStarted, onCancel }: StartAgentFormProps) {
  const t = useT();
  const [folders, setFolders] = useState<StartFolder[]>([]);
  const [folder, setFolder] = useState("");
  const [task, setTask] = useState("");
  const [model, setModel] = useState("sonnet");
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    startFolders()
      .then((list) => {
        if (!alive) return;
        setFolders(list);
        setFolder((cur) => cur || list[0]?.path || "");
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const changeTask = (v: string) => {
    setTask(v);
    if (!nameEdited) setName(slugifyName(v));
  };

  const valid =
    folder !== "" && task.trim() !== "" && !task.startsWith("-") && NAME_RE.test(name);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onStarted(await startAgent(folder, task, model, name));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="max-w-xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) void submit();
      }}
    >
      <FormField label={t.agents_folder}>
        <Select value={folder} onChange={(e) => setFolder(e.target.value)}>
          {folders.length === 0 && <option value="">{t.agents_no_folders}</option>}
          {folders.map((f) => (
            <option key={f.path} value={f.path}>
              {folderOptionText(f)}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t.agents_task}>
        <textarea
          value={task}
          maxLength={8000}
          rows={5}
          onChange={(e) => changeTask(e.target.value)}
          className="w-full bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-lg px-3 py-2 text-sm focus-accent"
        />
      </FormField>
      <div className="grid grid-cols-[auto_1fr] gap-3">
        <FormField label={t.agents_model}>
          <Select fullWidth={false} className="w-32" value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t.agents_name}>
          <input
            value={name}
            maxLength={64}
            onChange={(e) => {
              setNameEdited(true);
              setName(e.target.value);
            }}
            className="w-full bg-[var(--color-input-bg)] border border-[var(--color-input-border)] rounded-lg px-3 py-2 text-sm focus-accent"
          />
        </FormField>
      </div>
      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger-text)]">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={!valid} loading={busy}>
          {t.agents_start}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}
