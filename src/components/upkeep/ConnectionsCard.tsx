import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Badge, Button, FormField, Modal, Select } from "../ui";
import { SettingRow, SettingsCard } from "../settings/SettingsPrimitives";
import { useT } from "../../i18n/useT";
import { useConnections, useDeleteConnection, useSyncNow } from "../../db/hooks/useConnections";
import { connectionErrorText, connectionStatusText, testConnection } from "../../lib/upkeep/connections";
import { connectionVariant } from "../../lib/statusColors";
import { CONNECTION_FORMS, CONNECTION_KINDS } from "./connectionForms";
import type { Connection, ConnectionKind } from "../../types/upkeep";

function AddConnectionDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<ConnectionKind>("synology");
  const Form = CONNECTION_FORMS[kind];
  return (
    <Modal
      open
      onClose={onClose}
      title={t.upkeep_connection_add}
      footer={Form ? undefined : (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>{t.cancel}</Button>
        </div>
      )}
    >
      <div className="space-y-3">
        <FormField label={t.upkeep_connection_kind}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as ConnectionKind)}>
            {CONNECTION_KINDS.map((k) => (
              <option key={k} value={k}>{t[`upkeep_connection_kind_${k}` as const]}</option>
            ))}
          </Select>
        </FormField>
        {Form ? <Form onDone={onClose} onCancel={onClose} /> : (
          <p className="text-sm text-muted">{t.upkeep_connection_form_soon}</p>
        )}
      </div>
    </Modal>
  );
}

function ConnectionRow({ c }: { c: Connection }) {
  const t = useT();
  const syncNow = useSyncNow();
  const remove = useDeleteConnection();
  const [testing, setTesting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const Form = CONNECTION_FORMS[c.kind];

  const test = async () => {
    setTesting(true);
    try {
      const devices = await testConnection(c);
      toast.success(t.upkeep_connection_test_ok.replace("{count}", String(devices.length)));
    } catch (e) {
      toast.error(connectionErrorText(e, t));
    } finally {
      setTesting(false);
    }
  };

  const onRemove = async () => {
    if (!(await ask(t.upkeep_connection_remove_confirm, { kind: "warning" }))) return;
    remove.mutate(c.id);
  };

  return (
    <SettingRow
      label={`${c.label} · ${t[`upkeep_connection_kind_${c.kind}` as const]}`}
      desc={connectionStatusText(c, t)}
    >
      <div className="flex items-center gap-2">
        {c.last_sync_at && (
          <Badge variant={connectionVariant(c.failing_since != null)}>
            {c.failing_since ? t.upkeep_connection_failing : t.upkeep_connection_ok}
          </Badge>
        )}
        <Button size="sm" variant="secondary" loading={testing} onClick={() => void test()}>
          {t.upkeep_connection_test}
        </Button>
        <Button size="sm" variant="secondary" loading={syncNow.isPending} onClick={() => syncNow.mutate(c.id)}>
          {t.upkeep_sync_now}
        </Button>
        {Form && (
          <Button size="sm" variant="secondary" onClick={() => setReconnecting(true)}>
            {t.upkeep_connection_reconnect}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={t.remove} title={t.remove}
          onClick={() => void onRemove()} />
      </div>
      {Form && reconnecting && (
        <Modal open onClose={() => setReconnecting(false)} title={t.upkeep_connection_reconnect}>
          <Form
            connection={c}
            onCancel={() => setReconnecting(false)}
            // Sync at once so the row's error clears and readings come in.
            onDone={() => { setReconnecting(false); syncNow.mutate(c.id); }}
          />
        </Modal>
      )}
    </SettingRow>
  );
}

/** Settings › Upkeep › Connections: list, add, test, sync now, remove. */
export function ConnectionsCard() {
  const t = useT();
  const { data: connections = [] } = useConnections();
  const [adding, setAdding] = useState(false);
  return (
    <SettingsCard title={t.upkeep_connections} desc={t.upkeep_connections_desc}>
      {connections.length === 0 ? (
        <p className="text-sm text-muted py-2">{t.upkeep_connections_empty}</p>
      ) : (
        connections.map((c) => <ConnectionRow key={c.id} c={c} />)
      )}
      <div className="pt-3">
        <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
          {t.upkeep_connection_add}
        </Button>
      </div>
      {adding && <AddConnectionDialog onClose={() => setAdding(false)} />}
    </SettingsCard>
  );
}
