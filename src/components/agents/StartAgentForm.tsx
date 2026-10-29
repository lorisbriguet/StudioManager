import { useEffect, useState } from "react";
import { startAgent, startFolders, type StartFolder } from "../../lib/agents";
import { useT } from "../../i18n/useT";
import { Button, Callout, FormActions, FormField, FormGrid, FormLayout, Input, Select, Textarea } from "../ui";
import { ModelMenu } from "./ModelMenu";
import { logError } from "../../lib/log";

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
  /** What failed; shown translated, the raw error goes to the log. */
  const [error, setError] = useState<"folders" | "start" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    startFolders()
      .then((list) => {
        if (!alive) return;
        setFolders(list);
        setFolder((cur) => cur || list[0]?.path || "");
      })
      .catch((e) => {
        void logError("Agents: couldn't list the start folders:", e);
        if (alive) setError("folders");
      });
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
      void logError("Agents: start failed:", e);
      setError("start");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormLayout
      as="form"
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
        <Textarea value={task} maxLength={8000} rows={5} onChange={(e) => changeTask(e.target.value)} />
      </FormField>
      <FormGrid>
        <FormField label={t.agents_model}>
          <ModelMenu label={t.agents_model} value={model} onChange={setModel} />
        </FormField>
        <FormField label={t.agents_name}>
          <Input
            value={name}
            maxLength={64}
            onChange={(e) => {
              setNameEdited(true);
              setName(e.target.value);
            }}
          />
        </FormField>
      </FormGrid>
      {error && (
        <Callout tone="danger">{error === "folders" ? t.agents_folders_load_failed : t.agents_start_failed}</Callout>
      )}
      <FormActions>
        <Button variant="secondary" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button type="submit" disabled={!valid} loading={busy}>
          {t.agents_start}
        </Button>
      </FormActions>
    </FormLayout>
  );
}
