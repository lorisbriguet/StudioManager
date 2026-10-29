import { useState } from "react";
import { Badge, Button, EmptyState, FormField, FormGrid, ICONS, IconButton, Modal, Select, SettingRow, SettingsCard } from "../ui";
import { notify } from "../../lib/notify";
import { useConfirm } from "../../lib/confirm";
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
      footer={Form ? undefined : <Button variant="secondary" onClick={onClose}>{t.cancel}</Button>}
    >
      <FormGrid cols={1}>
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
      </FormGrid>
    </Modal>
  );
}

function ConnectionRow({ c }: { c: Connection }) {
  const t = useT();
  const syncNow = useSyncNow();
  const remove = useDeleteConnection();
  const [testing, setTesting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const confirm = useConfirm();
  const Form = CONNECTION_FORMS[c.kind];

  const test = async () => {
    setTesting(true);
    try {
      const devices = await testConnection(c);
      notify.success(t.upkeep_connection_test_ok.replace("{count}", String(devices.length)));
    } catch (e) {
      // The connector's own words (translated, or already redacted by Rust).
      notify.error(connectionErrorText(e, t), e);
    } finally {
      setTesting(false);
    }
  };

  const onRemove = async () => {
    if (!(await confirm({ title: t.upkeep_connection_remove_confirm, confirmLabel: t.remove, tone: "danger" }))) return;
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
        <Button variant="secondary" loading={testing} onClick={() => void test()}>
          {t.upkeep_connection_test}
        </Button>
        <Button variant="secondary" loading={syncNow.isPending} onClick={() => syncNow.mutate(c.id)}>
          {t.upkeep_sync_now}
        </Button>
        {Form && (
          <Button variant="secondary" onClick={() => setReconnecting(true)}>
            {t.upkeep_connection_reconnect}
          </Button>
        )}
        <IconButton icon={ICONS.delete} label={t.remove} tone="danger" onClick={() => void onRemove()} />
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
        <EmptyState size="sm" message={t.upkeep_connections_empty} />
      ) : (
        connections.map((c) => <ConnectionRow key={c.id} c={c} />)
      )}
      <div className="py-3">
        <Button variant="secondary" icon={ICONS.add} onClick={() => setAdding(true)}>
          {t.upkeep_connection_add}
        </Button>
      </div>
      {adding && <AddConnectionDialog onClose={() => setAdding(false)} />}
    </SettingsCard>
  );
}
