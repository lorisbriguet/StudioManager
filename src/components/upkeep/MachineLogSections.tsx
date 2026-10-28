import { useState } from "react";
import { FileText, Link2, Paperclip, Plus, X } from "lucide-react";
import { open as pickFile } from "@tauri-apps/plugin-dialog";
import { openMachineAttachment } from "../../lib/upkeep/openAttachment";
import { Button, Input } from "../ui";
import { SectionTitle } from "./SectionTitle";
import { useT } from "../../i18n/useT";
import {
  useAddMachineFile,
  useAddServiceLog,
  useMachineFiles,
  useRemoveMachineFile,
  useServiceLog,
} from "../../db/hooks/useUpkeep";
import { notifyError } from "../../lib/notifyError";
import { formatDisplayDate } from "../../utils/formatDate";
import { todayLocalISO } from "../../utils/localDate";

const iconBtn =
  "p-1 rounded-md text-muted hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-row)] transition-colors";

/** Attached files (copied into the org folder) and links, each with a label. */
export function FilesSection({ machineId }: { machineId: number }) {
  const t = useT();
  const { data: files = [] } = useMachineFiles(machineId);
  const add = useAddMachineFile();
  const remove = useRemoveMachineFile();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  const attach = async () => {
    try {
      const picked = await pickFile({ multiple: false });
      if (typeof picked !== "string") return;
      add.mutate({
        machineId,
        file: { label: picked.split("/").pop() ?? picked, kind: "file", path_or_url: picked },
      });
    } catch (e) {
      notifyError(t.upkeep_file_failed, e);
    }
  };

  const saveLink = () => {
    const target = url.trim();
    if (!target) return;
    add.mutate({ machineId, file: { label: label.trim() || target, kind: "link", path_or_url: target } });
    setAdding(false); setLabel(""); setUrl("");
  };

  return (
    <section>
      <SectionTitle aside={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" icon={<Paperclip size={14} />} onClick={() => void attach()}>
              {t.upkeep_attach_file}
            </Button>
            <Button size="sm" variant="secondary" icon={<Link2 size={14} />} onClick={() => setAdding((a) => !a)}>
              {t.upkeep_add_link}
            </Button>
          </div>
        }>{t.upkeep_files_links}</SectionTitle>
      {adding && (
        <div className="flex items-center gap-2 mb-3">
          <Input placeholder={t.label} value={label} onChange={(e) => setLabel(e.target.value)} />
          <Input placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button size="sm" onClick={saveLink}>{t.add}</Button>
        </div>
      )}
      {files.length === 0 ? (
        <p className="text-sm text-muted">{t.upkeep_files_empty}</p>
      ) : (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-sm">
              {f.kind === "link" ? <Link2 size={14} className="text-muted" /> : <FileText size={14} className="text-muted" />}
              <button
                type="button"
                className="truncate text-left hover:text-accent"
                onClick={() => void openMachineAttachment(f).catch((e) => notifyError(t.upkeep_file_failed, e))}
              >
                {f.label}
              </button>
              <button
                type="button"
                aria-label={t.upkeep_remove_file}
                title={t.upkeep_remove_file}
                className={`${iconBtn} ml-auto`}
                onClick={() => remove.mutate({ fileId: f.id, machineId })}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Dated log of what was done; entries come from mark-done or by hand. */
export function ServiceLogSection({ machineId }: { machineId: number }) {
  const t = useT();
  const { data: log = [] } = useServiceLog(machineId);
  const add = useAddServiceLog();
  const [adding, setAdding] = useState(false);
  const [doneOn, setDoneOn] = useState(todayLocalISO());
  const [what, setWhat] = useState("");
  const [cost, setCost] = useState("");
  const [reading, setReading] = useState("");

  const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));

  const save = () => {
    if (!what.trim()) return;
    add.mutate({
      machine_id: machineId, upkeep_item_id: null, done_on: doneOn, description: what.trim(),
      cost: num(cost), expense_id: null, reading: num(reading),
    });
    setAdding(false); setWhat(""); setCost(""); setReading("");
  };

  const head = "px-2 py-1.5 text-left text-xs font-normal text-muted border-b border-[var(--color-border-header)]";
  return (
    <section>
      <SectionTitle aside={
          <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setAdding((a) => !a)}>
            {t.upkeep_log_add}
          </Button>
        }>{t.upkeep_service_log}</SectionTitle>
      {adding && (
        <div className="grid grid-cols-[8rem_1fr_6rem_6rem_auto] gap-2 mb-3 items-center">
          <Input type="date" aria-label={t.date} value={doneOn} onChange={(e) => setDoneOn(e.target.value)} />
          <Input placeholder={t.upkeep_log_what} aria-label={t.upkeep_log_what} value={what} onChange={(e) => setWhat(e.target.value)} />
          <Input type="number" min={0} placeholder={t.upkeep_cost} aria-label={t.upkeep_cost} value={cost} onChange={(e) => setCost(e.target.value)} />
          <Input type="number" min={0} placeholder={t.upkeep_reading} aria-label={t.upkeep_reading} value={reading} onChange={(e) => setReading(e.target.value)} />
          <Button size="sm" onClick={save}>{t.add}</Button>
        </div>
      )}
      {log.length === 0 ? (
        <p className="text-sm text-muted">{t.upkeep_log_empty}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={head}>{t.date}</th>
              <th className={head}>{t.upkeep_log_what}</th>
              <th className={`${head} text-right`}>{t.upkeep_cost}</th>
              <th className={`${head} text-right`}>{t.upkeep_reading}</th>
            </tr>
          </thead>
          <tbody>
            {log.map((e) => (
              <tr key={e.id} className="border-b border-[var(--color-border-divider)]">
                <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">{formatDisplayDate(e.done_on)}</td>
                <td className="px-2 py-1.5">{e.description}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-muted">{e.cost != null ? e.cost.toFixed(2) : ""}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-muted">{e.reading ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
