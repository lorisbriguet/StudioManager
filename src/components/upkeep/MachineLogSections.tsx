import { useState } from "react";
import { open as pickFile } from "@tauri-apps/plugin-dialog";
import { openMachineAttachment } from "../../lib/upkeep/openAttachment";
import { Button, DatePicker, EmptyState, ICONS, ICON_SIZE, IconButton, Input, PanelTitle, Table } from "../ui";
import { useT } from "../../i18n/useT";
import {
  useAddMachineFile,
  useAddServiceLog,
  useMachineFiles,
  useRemoveMachineFile,
  useServiceLog,
} from "../../db/hooks/useUpkeep";
import { notify } from "../../lib/notify";
import { formatDisplayDate } from "../../utils/formatDate";
import { todayLocalISO } from "../../utils/localDate";

/** Attached files (copied into the org folder) and links, each with a label. */
export function FilesSection({ machineId, headingAs = "h2" }: { machineId: number; headingAs?: "h2" | "h3" }) {
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
      notify.error(t.upkeep_file_failed, e);
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
      <PanelTitle
        as={headingAs}
        title={t.upkeep_files_links}
        className="mb-3"
        action={<>
          <Button variant="secondary" icon={ICONS.attachment} onClick={() => void attach()}>
            {t.upkeep_attach_file}
          </Button>
          <Button variant="secondary" icon={ICONS.link} onClick={() => setAdding((a) => !a)}>
            {t.upkeep_add_link}
          </Button>
        </>}
      />
      {adding && (
        <div className="flex items-center gap-2 mb-3">
          <Input placeholder={t.label} aria-label={t.label} value={label} onChange={(e) => setLabel(e.target.value)} />
          <Input placeholder="https://" aria-label={t.upkeep_add_link} value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button onClick={saveLink}>{t.add}</Button>
        </div>
      )}
      {files.length === 0 ? (
        <EmptyState size="sm" message={t.upkeep_files_empty} />
      ) : (
        <ul className="space-y-1">
          {files.map((f) => {
            const Icon = f.kind === "link" ? ICONS.link : ICONS.document;
            return (
              <li key={f.id} className="group flex items-center gap-2 text-sm">
                <Icon size={ICON_SIZE.control} className="text-muted shrink-0" />
                <Button
                  variant="link"
                  className="truncate text-sm"
                  onClick={() => void openMachineAttachment(f).catch((e) => notify.error(t.upkeep_file_failed, e))}
                >
                  {f.label}
                </Button>
                <IconButton
                  size="xs"
                  icon={ICONS.close}
                  label={t.upkeep_remove_file}
                  tone="danger"
                  reveal
                  className="ml-auto"
                  onClick={() => remove.mutate({ fileId: f.id, machineId })}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Dated log of what was done; entries come from mark-done or by hand. */
export function ServiceLogSection({ machineId, headingAs = "h2" }: { machineId: number; headingAs?: "h2" | "h3" }) {
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

  return (
    <section>
      <PanelTitle
        as={headingAs}
        title={t.upkeep_service_log}
        className="mb-3"
        action={
          <Button variant="secondary" icon={ICONS.add} onClick={() => setAdding((a) => !a)}>
            {t.upkeep_log_add}
          </Button>
        }
      />
      {adding && (
        <div className="grid grid-cols-[8rem_1fr_6rem_6rem_auto] gap-2 mb-3 items-center">
          <DatePicker aria-label={t.date} value={doneOn} onChange={(v) => setDoneOn(v ?? todayLocalISO())} />
          <Input placeholder={t.upkeep_log_what} aria-label={t.upkeep_log_what} value={what} onChange={(e) => setWhat(e.target.value)} />
          <Input type="number" min={0} numeric placeholder={t.upkeep_cost} aria-label={t.upkeep_cost} value={cost} onChange={(e) => setCost(e.target.value)} />
          <Input type="number" min={0} numeric placeholder={t.upkeep_reading} aria-label={t.upkeep_reading} value={reading} onChange={(e) => setReading(e.target.value)} />
          <Button onClick={save}>{t.add}</Button>
        </div>
      )}
      {log.length === 0 ? (
        <EmptyState size="sm" message={t.upkeep_log_empty} />
      ) : (
        <Table density="compact">
          <Table.Head>
            <Table.Th>{t.date}</Table.Th>
            <Table.Th>{t.upkeep_log_what}</Table.Th>
            <Table.Th numeric>{t.upkeep_cost}</Table.Th>
            <Table.Th numeric>{t.upkeep_reading}</Table.Th>
          </Table.Head>
          <Table.Body>
            {log.map((e) => (
              <Table.Row key={e.id}>
                <Table.Td className="tabular-nums whitespace-nowrap">{formatDisplayDate(e.done_on)}</Table.Td>
                <Table.Td>{e.description}</Table.Td>
                <Table.Td numeric muted>{e.cost != null ? e.cost.toFixed(2) : ""}</Table.Td>
                <Table.Td numeric muted>{e.reading ?? ""}</Table.Td>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </section>
  );
}
