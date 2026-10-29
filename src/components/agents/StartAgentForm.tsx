import { useEffect, useState } from "react";
import { open as openDirectory } from "@tauri-apps/plugin-dialog";
import { isInside, startAgent, startFolders, trustFolder, type StartFolder } from "../../lib/agents";
import { useT } from "../../i18n/useT";
import { useConfirm } from "../../lib/confirm";
import { Button, Callout, FormActions, FormField, FormGrid, FormLayout, ICONS, Input, Select, Textarea } from "../ui";
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

function folderOptionText(f: StartFolder, untrusted: string): string {
  const l = f.label;
  const text = l ? `${l.orgName} › ${l.clientName} › ${l.projectName} — ${f.path}` : f.path;
  return f.trusted ? text : `${text} · ${untrusted}`;
}

interface StartAgentFormProps {
  onStarted: (shortId: string) => void;
  onCancel: () => void;
}

export function StartAgentForm({ onStarted, onCancel }: StartAgentFormProps) {
  const t = useT();
  const confirm = useConfirm();
  const [folders, setFolders] = useState<StartFolder[]>([]);
  const [folder, setFolder] = useState("");
  const [task, setTask] = useState("");
  const [model, setModel] = useState("sonnet");
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  /** What failed; shown translated, the raw error goes to the log. */
  const [error, setError] = useState<"folders" | "start" | "trust" | null>(null);
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

  /** Any folder from the system picker; trusted when a trusted folder holds it. */
  const chooseFolder = async () => {
    const dir = await openDirectory({ directory: true, title: t.agents_choose_folder });
    if (typeof dir !== "string") return;
    setFolders((list) => {
      if (list.some((f) => f.path === dir)) return list;
      const trusted = list.some((f) => f.trusted && isInside(dir, f.path));
      return [...list, { path: dir, label: null, trusted, home: false }];
    });
    setFolder(dir);
  };

  const valid =
    folder !== "" && task.trim() !== "" && !task.startsWith("-") && NAME_RE.test(name);

  const submit = async () => {
    setError(null);
    let target = folder;
    const picked = folders.find((f) => f.path === folder);
    if (picked && !picked.trusted) {
      const yes = await confirm({
        title: t.agents_trust_title.replace("{folder}", folder),
        message: picked.home ? t.agents_trust_home_message : t.agents_trust_message,
        confirmLabel: t.agents_trust_confirm,
        tone: picked.home ? "danger" : "default",
      });
      if (!yes) return;
      setBusy(true);
      try {
        target = await trustFolder(folder);
      } catch (e) {
        void logError("Agents: couldn't trust the folder:", e);
        setError("trust");
        setBusy(false);
        return;
      }
      setFolders((list) =>
        list.map((f) => (isInside(f.path, folder) ? { ...f, trusted: true } : f)),
      );
    }
    setBusy(true);
    try {
      onStarted(await startAgent(target, task, model, name));
    } catch (e) {
      void logError("Agents: start failed:", e);
      setError("start");
    } finally {
      setBusy(false);
    }
  };

  const errorText =
    error === "folders"
      ? t.agents_folders_load_failed
      : error === "trust"
        ? t.agents_trust_failed
        : t.agents_start_failed;

  return (
    <FormLayout
      as="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) void submit();
      }}
    >
      <FormField label={t.agents_folder}>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Select value={folder} onChange={(e) => setFolder(e.target.value)}>
              {folders.length === 0 && <option value="">{t.agents_no_folders}</option>}
              {folders.map((f) => (
                <option key={f.path} value={f.path}>
                  {folderOptionText(f, t.agents_folder_untrusted)}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="secondary" icon={ICONS.openFolder} onClick={() => void chooseFolder()}>
            {t.agents_choose_folder}
          </Button>
        </div>
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
      {error && <Callout tone="danger">{errorText}</Callout>}
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
