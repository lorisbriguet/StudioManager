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
 */
export function SynologyForm({ onDone, onCancel }: ConnectionFormProps) {
  const t = useT();
  const create = useCreateConnection();
  const update = useUpdateConnection();
  const remove = useDeleteConnection();
  const [f, setF] = useState({
    label: t.upkeep_connection_kind_synology,
    host: "",
    port: "5001",
    account: "",
    password: "",
  });
  const [step, setStep] = useState<Step>("account");
  const [otp, setOtp] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idRef = useRef<number | null>(null);
  const doneRef = useRef(false);

  const dirty = !!(f.host || f.account || f.password);
  useUnsavedChangesWarning(dirty);

  // Closed before it worked (Cancel, Escape, the dialog's close button): no orphan.
  const removeRef = useRef(remove.mutate);
  removeRef.current = remove.mutate;
  useEffect(() => () => {
    if (idRef.current != null && !doneRef.current) removeRef.current(idRef.current);
  }, []);

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
    if (!host || !f.account.trim() || !f.password) { setError(t.upkeep_syno_required); return; }
    const data = {
      kind: "synology" as const,
      label: f.label.trim() || t.upkeep_connection_kind_synology,
      host,
      port,
      account: f.account.trim(),
    };
    const secret = synologySecret(f.password);
    void busyWhile(async () => {
      if (idRef.current == null) {
        idRef.current = await create.mutateAsync({ data, secret });
      } else {
        await update.mutateAsync({ id: idRef.current, data, secret });
      }
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
    void busyWhile(async () => {
      await saveConnectionSecret(id, synologySecret(f.password, otp));
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
          <FormField label={t.upkeep_syno_password} required error={error ?? undefined}>
            <Input
              type="password"
              value={f.password}
              autoComplete="off"
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
        </>
      )}

      <div className="flex gap-2 justify-end pt-1">
        <Button variant="secondary" onClick={onCancel}>{t.cancel}</Button>
        <Button loading={busy} onClick={primary.run}>{primary.label}</Button>
      </div>
    </div>
  );
}
