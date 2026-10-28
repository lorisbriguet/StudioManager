import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, FormField, Input } from "../ui";
import { useT } from "../../i18n/useT";
import { useCreateConnection, useDeleteConnection, useUpdateConnection } from "../../db/hooks/useConnections";
import { getConnection } from "../../db/queries/connections";
import { useUnsavedChangesWarning } from "../../hooks/useUnsavedChangesWarning";
import { saveConnectionSecret, testConnection } from "../../lib/upkeep/connections";
import {
  formatFingerprint, normalizeHost, parseSynologyError, synologySecret,
} from "../../lib/upkeep/synology";
import type { ConnectionFormProps } from "./connectionForms";

type Step = "account" | "cert" | "otp";

/**
 * Add a Synology NAS (spec §8). The connection and its Keychain secret are
 * created on the first "Connect", then tested: an unknown certificate is shown
 * for the user to trust, a 2-step account asks for its code. Leaving before it
 * works removes the half-made connection and its secret.
 *
 * With `connection` it reconnects that connection instead (same id, machine
 * links kept): the password may stay empty to keep the stored one, and
 * closing never removes anything.
 */
export function SynologyForm({ onDone, onCancel, connection }: ConnectionFormProps) {
  const t = useT();
  const create = useCreateConnection();
  const update = useUpdateConnection();
  const remove = useDeleteConnection();
  const existing = connection != null;
  const [initial] = useState(() => ({
    label: connection?.label ?? t.upkeep_connection_kind_synology,
    host: connection?.host ?? "",
    port: String(connection?.port ?? 5001),
    account: connection?.account ?? "",
    password: "",
  }));
  const [f, setF] = useState(initial);
  const [step, setStep] = useState<Step>("account");
  const [otp, setOtp] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idRef = useRef<number | null>(connection?.id ?? null);
  const doneRef = useRef(false);
  /** The password last written to the Keychain by this form (null: none yet). */
  const [savedPassword, setSavedPassword] = useState<string | null>(null);

  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => f[k] !== initial[k]);
  useUnsavedChangesWarning(dirty);

  // A new connection closed before it worked (Cancel, Escape, the dialog's
  // close button, another kind picked): no orphan. Never on Reconnect.
  const removeRef = useRef(remove.mutate);
  removeRef.current = remove.mutate;
  useEffect(() => () => {
    if (!existing && idRef.current != null && !doneRef.current) removeRef.current(idRef.current);
  }, [existing]);

  const set = <K extends keyof typeof f>(k: K, v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    setError(null);
  };

  /** Test the saved connection and move to whatever step it asks for. */
  const runTest = async (id: number) => {
    const conn = await getConnection(id);
    if (!conn) return;
    try {
      const devices = await testConnection(conn);
      doneRef.current = true;
      toast.success(t.upkeep_connection_test_ok.replace("{count}", String(devices.length)));
      onDone();
    } catch (e) {
      const r = parseSynologyError(e);
      if (r.kind === "cert") {
        setFingerprint(r.fingerprint);
        setStep("cert");
      } else if (r.kind === "otp") {
        setOtp("");
        setError(r.invalid ? t.upkeep_syno_otp_invalid : null);
        setStep("otp");
      } else {
        setError(r.message);
        setStep("account");
      }
    }
  };

  const busyWhile = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch {
      // The mutation hooks already show the error.
    } finally {
      setBusy(false);
    }
  };

  const connect = () => {
    const host = normalizeHost(f.host);
    const port = Number(f.port) || 5001;
    // On Reconnect an empty password keeps the stored one.
    if (!host || !f.account.trim() || (!existing && !f.password)) { setError(t.upkeep_syno_required); return; }
    const data = {
      kind: "synology" as const,
      label: f.label.trim() || t.upkeep_connection_kind_synology,
      host,
      port,
      account: f.account.trim(),
    };
    // Rewrite the Keychain secret only for a new password, so a device token
    // DSM gave earlier isn't thrown away by a retry.
    const password = f.password;
    const secret = password && password !== savedPassword ? synologySecret(password) : undefined;
    void busyWhile(async () => {
      if (idRef.current == null) {
        idRef.current = await create.mutateAsync({ data, secret });
      } else {
        await update.mutateAsync({ id: idRef.current, data, secret });
      }
      if (secret) setSavedPassword(password);
      await runTest(idRef.current);
    });
  };

  const trust = () => {
    const id = idRef.current;
    if (id == null) return;
    void busyWhile(async () => {
      await update.mutateAsync({ id, data: { cert_fingerprint: fingerprint } });
      await runTest(id);
    });
  };

  const sendCode = () => {
    const id = idRef.current;
    if (id == null || !otp.trim()) return;
    // The code goes into the Keychain blob with the password, so on
    // Reconnect without a typed password the form asks for it here.
    if (!f.password) { setError(t.upkeep_syno_required); return; }
    void busyWhile(async () => {
      await saveConnectionSecret(id, synologySecret(f.password, otp));
      setSavedPassword(f.password);
      await runTest(id);
    });
  };

  const primary = step === "cert"
    ? { label: t.upkeep_syno_cert_trust, run: trust }
    : step === "otp"
      ? { label: t.upkeep_syno_connect, run: sendCode }
      : { label: t.upkeep_syno_connect, run: connect };

  return (
    <div className="space-y-3">
      {step === "account" && (
        <>
          <FormField label={t.upkeep_connection_label}>
            <Input value={f.label} onChange={(e) => set("label", e.target.value)} />
          </FormField>
          <div className="flex gap-2">
            <FormField label={t.upkeep_syno_host} required>
              <Input
                value={f.host}
                placeholder={t.upkeep_syno_host_placeholder}
                autoFocus
                onChange={(e) => set("host", e.target.value)}
              />
            </FormField>
            <FormField label={t.upkeep_syno_port}>
              <Input type="number" min={1} max={65535} value={f.port} onChange={(e) => set("port", e.target.value)} />
            </FormField>
          </div>
          <FormField label={t.upkeep_syno_account} required>
            <Input value={f.account} autoComplete="off" onChange={(e) => set("account", e.target.value)} />
          </FormField>
          <FormField label={t.upkeep_syno_password} required={!existing} error={error ?? undefined}>
            <Input
              type="password"
              value={f.password}
              autoComplete="off"
              placeholder={existing ? t.upkeep_syno_password_keep : undefined}
              onChange={(e) => set("password", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") connect(); }}
            />
          </FormField>
          <p className="text-xs text-muted">{t.upkeep_syno_account_note}</p>
        </>
      )}

      {step === "cert" && (
        <div className="space-y-2">
          <div className="text-sm font-medium">{t.upkeep_syno_cert_title}</div>
          <p className="text-sm text-muted">{t.upkeep_syno_cert_desc}</p>
          <p className="text-sm text-muted">{t.upkeep_syno_cert_host_hint}</p>
          <div className="text-xs text-muted">{t.upkeep_syno_cert_fingerprint}</div>
          <p className="text-xs font-mono break-all">{formatFingerprint(fingerprint)}</p>
        </div>
      )}

      {step === "otp" && (
        <>
          <p className="text-sm text-muted">{t.upkeep_syno_otp_desc}</p>
          <FormField label={t.upkeep_syno_otp} required error={error ?? undefined}>
            <Input
              value={otp}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              onChange={(e) => { setOtp(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") sendCode(); }}
            />
          </FormField>
          {/* Reconnect without a typed password: needed to store the code with it. */}
          {savedPassword == null && (
            <FormField label={t.upkeep_syno_password} required>
              <Input
                type="password"
                value={f.password}
                autoComplete="off"
                onChange={(e) => set("password", e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendCode(); }}
              />
            </FormField>
          )}
        </>
      )}

      <div className="flex gap-2 justify-end pt-1">
        <Button variant="secondary" onClick={onCancel}>{t.cancel}</Button>
        <Button loading={busy} onClick={primary.run}>{primary.label}</Button>
      </div>
    </div>
  );
}
