import { useState } from "react";
import { Button, FormActions, FormField, FormGrid, FormLayout, Input } from "../ui";
import { useT } from "../../i18n/useT";
import { useUnsavedChangesWarning } from "../../hooks/useUnsavedChangesWarning";
import { normalizeHost, parsePort } from "../../lib/upkeep/synology";
import type { ConnectionFormProps } from "./connectionForms";
import { useConnectionSetup } from "./useConnectionSetup";

/** Example shown in the empty address field; nothing is prefilled. */
const HOST_PLACEHOLDER = "paperless.example.ts.net";
const DEFAULT_PORT = 8443;

/**
 * Add a Paperless-ngx server: address, port and API token. The token goes to
 * the Keychain as-is and is never shown again. With `connection` (Reconnect)
 * the token may stay empty to keep the stored one, unless the address moved.
 */
export function PaperlessForm({ onDone, onCancel, connection }: ConnectionFormProps) {
  const t = useT();
  const { existing, busy, busyWhile, save, test } = useConnectionSetup(connection, onDone);
  const [initial] = useState(() => ({
    label: connection?.label ?? t.upkeep_connection_kind_paperless,
    host: connection?.host ?? "",
    port: String(connection?.port ?? DEFAULT_PORT),
    token: "",
  }));
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => f[k] !== initial[k]);
  useUnsavedChangesWarning(dirty);

  const portBad = f.port.trim() !== "" && parsePort(f.port) == null;

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    setError(null);
  };

  const connect = () => {
    const host = normalizeHost(f.host);
    const port = f.port.trim() ? parsePort(f.port) : DEFAULT_PORT;
    if (port == null) return;
    const token = f.token.trim();
    if (!host || (!existing && !token)) { setError(t.upkeep_paperless_required); return; }
    // The stored token belongs to the address it was saved for.
    const moved = connection != null
      && (host.toLowerCase() !== (connection.host ?? "").toLowerCase()
        || port !== (connection.port ?? DEFAULT_PORT));
    if (moved && !token) { setError(t.upkeep_paperless_reenter_token); return; }
    const data = {
      kind: "paperless" as const,
      label: f.label.trim() || t.upkeep_connection_kind_paperless,
      host,
      port,
    };
    busyWhile(async () => {
      await test(await save(data, token || undefined), (e) => {
        setError(e instanceof Error ? e.message : String(e));
      });
    });
  };

  return (
    <FormLayout dense capped={false}>
      <FormField label={t.upkeep_connection_label}>
        <Input value={f.label} onChange={(e) => set("label", e.target.value)} />
      </FormField>
      <FormGrid>
        <FormField label={t.upkeep_paperless_host} required span={2}>
          <Input value={f.host} autoComplete="off" placeholder={HOST_PLACEHOLDER} onChange={(e) => set("host", e.target.value)} />
        </FormField>
        <FormField label={t.upkeep_syno_port} error={portBad ? t.upkeep_syno_port_invalid : undefined}>
          <Input type="number" min={1} max={65535} value={f.port} onChange={(e) => set("port", e.target.value)} />
        </FormField>
      </FormGrid>
      <FormField label={t.upkeep_paperless_token} required={!existing} error={error ?? undefined}>
        <Input
          type="password"
          value={f.token}
          autoComplete="off"
          placeholder={existing ? t.upkeep_paperless_token_keep : undefined}
          onChange={(e) => set("token", e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") connect(); }}
        />
      </FormField>
      <p className="text-xs text-muted">{t.upkeep_paperless_token_hint}</p>
      <FormActions>
        <Button variant="secondary" onClick={onCancel}>{t.cancel}</Button>
        <Button loading={busy} onClick={connect}>{t.upkeep_paperless_connect}</Button>
      </FormActions>
    </FormLayout>
  );
}
