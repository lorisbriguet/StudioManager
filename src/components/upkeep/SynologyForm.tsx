import { useRef, useState } from "react";
import { Button, Callout, FIELD_LABEL, FormActions, FormField, FormGrid, FormLayout, HEADING_2, Input } from "../ui";
import { useT } from "../../i18n/useT";
import { useUnsavedChangesWarning } from "../../hooks/useUnsavedChangesWarning";
import { saveConnectionSecret } from "../../lib/upkeep/connections";
import {
  DEFAULT_SYNOLOGY_PORT, formatFingerprint, normalizeHost, parsePort, parseSynologyError, sameFingerprint,
  synologySecret,
} from "../../lib/upkeep/synology";
import type { ConnectionFormProps } from "./connectionForms";
import { useConnectionSetup } from "./useConnectionSetup";

type Step = "account" | "cert" | "otp";

/**
 * Add a Synology NAS (spec §8). The connection and its Keychain secret are
 * created on the first "Connect", then tested: an unknown certificate is shown
 * for the user to trust, a 2-step account asks for its code. Leaving before it
 * works removes the half-made connection and its secret.
 *
 * With `connection` it reconnects that connection instead (same id, machine
 * links kept): the password may stay empty to keep the stored one, and
 * closing never removes anything. Reconnect shows the NAS certificate again
 * (unless the system trusts it) instead of keeping the old pin silently.
 *
 * The password is stored bound to the host, port and pin it was typed for
 * (Rust sends it nowhere else): a new address or a newly trusted certificate
 * needs the password again.
 */
export function SynologyForm({ onDone, onCancel, connection }: ConnectionFormProps) {
  const t = useT();
  const { existing, busy, busyWhile, save, test, update, id: savedId } = useConnectionSetup(connection, onDone);
  const [initial] = useState(() => ({
    label: connection?.label ?? t.upkeep_connection_kind_synology,
    host: connection?.host ?? "",
    port: String(connection?.port ?? DEFAULT_SYNOLOGY_PORT),
    account: connection?.account ?? "",
    password: "",
  }));
  const [f, setF] = useState(initial);
  const [step, setStep] = useState<Step>("account");
  const [otp, setOtp] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** The password last written to the Keychain by this form (null: none yet). */
  const [savedPassword, setSavedPassword] = useState<string | null>(null);
  /** The secret (without a code) last written by this form: unchanged, a retry keeps DSM's device token. */
  const [savedSecret, setSavedSecret] = useState<string | null>(null);
  /** The certificate pinned on the connection row right now. */
  const [pin, setPin] = useState<string | null>(connection?.cert_fingerprint ?? null);
  /** The stored password can't be used here (Rust said `reenter_password`, or the address changed). */
  const [needPassword, setNeedPassword] = useState(
    () => connection != null && parseSynologyError(connection.last_error ?? "").kind === "password"
  );
  /** Reconnect: the certificate was shown again (or the system trusts it) in this form. */
  const certChecked = useRef(false);
  const portBad = parsePort(f.port) == null;

  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => f[k] !== initial[k]);
  useUnsavedChangesWarning(dirty);

  const set = <K extends keyof typeof f>(k: K, v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    setError(null);
  };

  /** Where the password may go: the form's host and port, and `cert`. */
  const nas = (cert: string | null) => ({
    host: normalizeHost(f.host),
    port: parsePort(f.port) ?? DEFAULT_SYNOLOGY_PORT,
    cert_fingerprint: cert,
  });

  /** Test the saved connection and move to whatever step it asks for. */
  const runTest = (id: number) => test(id, (e) => {
    const r = parseSynologyError(e);
    // Anything but a certificate error means the TLS check passed.
    if (r.kind !== "cert") certChecked.current = true;
    if (r.kind === "cert") {
      setFingerprint(r.fingerprint);
      setError(null);
      setStep("cert");
    } else if (r.kind === "password") {
      setNeedPassword(true);
      setSavedPassword(null);
      setSavedSecret(null);
      setError(t.upkeep_syno_reenter_password);
      setStep("account");
    } else if (r.kind === "otp") {
      setOtp("");
      setError(r.invalid ? t.upkeep_syno_otp_invalid : null);
      setStep("otp");
    } else {
      setError(r.message);
      setStep("account");
    }
  }, { recheckCert: existing && !certChecked.current });

  const connect = () => {
    const host = normalizeHost(f.host);
    const port = parsePort(f.port);
    if (port == null) return;
    // On Reconnect an empty password keeps the stored one, unless it can't
    // go to this address: it is bound to the host and port it was saved for.
    const moved = connection != null
      && (host.toLowerCase() !== (connection.host ?? "").toLowerCase()
        || port !== (connection.port ?? DEFAULT_SYNOLOGY_PORT));
    if (!f.password && (needPassword || moved)) {
      setNeedPassword(true);
      setError(t.upkeep_syno_reenter_password);
      return;
    }
    if (!host || !f.account.trim() || (!existing && !f.password)) { setError(t.upkeep_syno_required); return; }
    const data = {
      kind: "synology" as const,
      label: f.label.trim() || t.upkeep_connection_kind_synology,
      host,
      port,
      account: f.account.trim(),
    };
    // Rewrite the Keychain secret only for a new password or address, so a
    // device token DSM gave earlier isn't thrown away by a retry.
    const password = f.password;
    const full = password ? synologySecret(password, { host, port, cert_fingerprint: pin }) : undefined;
    const secret = full && full !== savedSecret ? full : undefined;
    busyWhile(async () => {
      const id = await save(data, secret);
      if (secret) {
        setSavedPassword(password);
        setSavedSecret(secret);
        setNeedPassword(false);
      }
      await runTest(id);
    });
  };

  /** The certificate shown is the one already pinned: trusting it changes nothing. */
  const samePin = sameFingerprint(fingerprint, pin);

  const trust = () => {
    const id = savedId();
    if (id == null) return;
    if (samePin) {
      certChecked.current = true;
      busyWhile(() => runTest(id));
      return;
    }
    // A new pin is stored with the password, so it is needed here.
    if (!f.password) { setError(t.upkeep_syno_reenter_password); return; }
    const secret = synologySecret(f.password, nas(fingerprint));
    busyWhile(async () => {
      await update.mutateAsync({ id, data: { cert_fingerprint: fingerprint }, secret });
      setPin(fingerprint);
      setSavedPassword(f.password);
      setSavedSecret(secret);
      certChecked.current = true;
      await runTest(id);
    });
  };

  const sendCode = () => {
    const id = savedId();
    if (id == null || !otp.trim()) return;
    // The code goes into the Keychain blob with the password, so on
    // Reconnect without a typed password the form asks for it here.
    if (!f.password) { setError(t.upkeep_syno_required); return; }
    busyWhile(async () => {
      await saveConnectionSecret(id, synologySecret(f.password, nas(pin), otp));
      setSavedPassword(f.password);
      // Rust drops the code once used: what stays stored is this.
      setSavedSecret(synologySecret(f.password, nas(pin)));
      await runTest(id);
    });
  };

  const primary = step === "cert"
    ? { label: t.upkeep_syno_cert_trust, run: trust }
    : step === "otp"
      ? { label: t.upkeep_syno_connect, run: sendCode }
      : { label: t.upkeep_syno_connect, run: connect };

  return (
    <FormLayout dense capped={false}>
      {step === "account" && (
        <>
          <FormField label={t.upkeep_connection_label}>
            <Input value={f.label} onChange={(e) => set("label", e.target.value)} />
          </FormField>
          <FormGrid cols={3}>
            <FormField label={t.upkeep_syno_host} required span={2}>
              <Input
                value={f.host}
                placeholder={t.upkeep_syno_host_placeholder}
                autoFocus
                onChange={(e) => set("host", e.target.value)}
              />
            </FormField>
            <FormField label={t.upkeep_syno_port} error={portBad ? t.upkeep_syno_port_invalid : undefined}>
              <Input type="number" min={1} max={65535} value={f.port} onChange={(e) => set("port", e.target.value)} />
            </FormField>
          </FormGrid>
          <FormField label={t.upkeep_syno_account} required>
            <Input value={f.account} autoComplete="off" onChange={(e) => set("account", e.target.value)} />
          </FormField>
          <FormField label={t.upkeep_password} required={!existing || needPassword} error={error ?? undefined}>
            <Input
              type="password"
              value={f.password}
              autoComplete="off"
              placeholder={existing && !needPassword ? t.upkeep_syno_password_keep : undefined}
              onChange={(e) => set("password", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") connect(); }}
            />
          </FormField>
          <p className="text-xs text-muted">{t.upkeep_syno_account_note}</p>
        </>
      )}

      {step === "cert" && (
        <div className="space-y-2">
          <h3 className={HEADING_2}>{t.upkeep_syno_cert_title}</h3>
          <p className="text-sm text-muted">{t.upkeep_syno_cert_desc}</p>
          <p className="text-sm text-muted">{t.upkeep_syno_cert_host_hint}</p>
          <div className={FIELD_LABEL}>{t.upkeep_syno_cert_fingerprint}</div>
          <p className="text-xs font-mono break-all">{formatFingerprint(fingerprint)}</p>
          <p className="text-sm text-muted">{t.upkeep_syno_cert_compare}</p>
          {pin && (
            <Callout tone={samePin ? "info" : "warning"}>
              {samePin ? t.upkeep_syno_cert_same : t.upkeep_syno_cert_changed}
            </Callout>
          )}
          {/* A new pin is stored with the password: asked here on Reconnect without one. */}
          {!samePin && savedPassword == null && (
            <FormField label={t.upkeep_password} required error={error ?? undefined}>
              <Input
                type="password"
                value={f.password}
                autoComplete="off"
                autoFocus
                onChange={(e) => set("password", e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") trust(); }}
              />
            </FormField>
          )}
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
            <FormField label={t.upkeep_password} required>
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

      <FormActions>
        <Button variant="secondary" onClick={onCancel}>{t.cancel}</Button>
        <Button loading={busy} onClick={primary.run}>{primary.label}</Button>
      </FormActions>
    </FormLayout>
  );
}
