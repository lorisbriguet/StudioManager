import { useState } from "react";
import { Button, FormField, Input, Select } from "../ui";
import { useT } from "../../i18n/useT";
import { useUnsavedChangesWarning } from "../../hooks/useUnsavedChangesWarning";
import { saveConnectionSecret } from "../../lib/upkeep/connections";
import {
  BAMBU_REGIONS, bambuCodeSecret, bambuPasswordSecret, parseBambuError, type BambuRegion,
} from "../../lib/upkeep/bambu";
import type { ConnectionFormProps } from "./connectionForms";
import { useConnectionSetup } from "./useConnectionSetup";

type Step = "account" | "code";

/**
 * Add a Bambu Lab cloud account (spec §8): region, email and password. The
 * password goes to the Keychain for one sign-in only; Rust swaps it for
 * Bambu's token whatever the outcome. An account that signs in with an
 * emailed code gets a code step. Leaving before it works removes the
 * half-made connection.
 *
 * With `connection` it signs that connection in again (same id, machine links
 * kept): an empty password keeps the current sign-in, and closing never
 * removes anything.
 */
export function BambuForm({ onDone, onCancel, connection }: ConnectionFormProps) {
  const t = useT();
  const { existing, busy, busyWhile, save, test, id: savedId } = useConnectionSetup(connection, onDone);
  const [initial] = useState(() => ({
    label: connection?.label ?? t.upkeep_connection_kind_bambu_cloud,
    region: (connection?.region === "china" ? "china" : "global") as BambuRegion,
    account: connection?.account ?? "",
    password: "",
  }));
  const [f, setF] = useState(initial);
  const [step, setStep] = useState<Step>("account");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => f[k] !== initial[k]);
  useUnsavedChangesWarning(dirty);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    setError(null);
  };

  const runTest = (id: number) => test(id, (e) => {
    const r = parseBambuError(e);
    if (r.kind === "code") {
      setCode("");
      setError(r.invalid ? t.upkeep_bambu_code_invalid : null);
      setStep("code");
    } else {
      setError(r.kind === "signin" ? t.upkeep_bambu_signin_again : r.message);
      setStep("account");
    }
  });

  const signIn = () => {
    const account = f.account.trim();
    // On Reconnect an empty password keeps the current sign-in.
    if (!account || (!existing && !f.password)) { setError(t.upkeep_bambu_required); return; }
    const data = {
      kind: "bambu_cloud" as const,
      label: f.label.trim() || t.upkeep_connection_kind_bambu_cloud,
      region: f.region,
      account,
    };
    // Sent on every try: Rust never keeps it past one sign-in.
    const secret = f.password ? bambuPasswordSecret(f.password) : undefined;
    busyWhile(async () => {
      await runTest(await save(data, secret));
    });
  };

  const sendCode = () => {
    const id = savedId();
    if (id == null || !code.trim()) return;
    busyWhile(async () => {
      await saveConnectionSecret(id, bambuCodeSecret(code));
      await runTest(id);
    });
  };

  const primary = step === "code" ? sendCode : signIn;

  return (
    <div className="space-y-3">
      {step === "account" && (
        <>
          <p className="text-xs text-muted">{t.upkeep_bambu_note}</p>
          <FormField label={t.upkeep_connection_label}>
            <Input value={f.label} onChange={(e) => set("label", e.target.value)} />
          </FormField>
          <FormField label={t.upkeep_bambu_region}>
            <Select value={f.region} onChange={(e) => set("region", e.target.value as BambuRegion)}>
              {BAMBU_REGIONS.map((r) => (
                <option key={r} value={r}>{t[`upkeep_bambu_region_${r}` as const]}</option>
              ))}
            </Select>
          </FormField>
          <FormField label={t.upkeep_bambu_account} required>
            <Input
              type="email"
              value={f.account}
              autoComplete="off"
              autoFocus
              onChange={(e) => set("account", e.target.value)}
            />
          </FormField>
          <FormField label={t.upkeep_syno_password} required={!existing} error={error ?? undefined}>
            <Input
              type="password"
              value={f.password}
              autoComplete="off"
              placeholder={existing ? t.upkeep_bambu_password_keep : undefined}
              onChange={(e) => set("password", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") signIn(); }}
            />
          </FormField>
        </>
      )}

      {step === "code" && (
        <>
          <p className="text-sm text-muted">{t.upkeep_bambu_code_desc}</p>
          <FormField label={t.upkeep_bambu_code} required error={error ?? undefined}>
            <Input
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              onChange={(e) => { setCode(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") sendCode(); }}
            />
          </FormField>
        </>
      )}

      <div className="flex gap-2 justify-end pt-1">
        <Button variant="secondary" onClick={onCancel}>{t.cancel}</Button>
        <Button loading={busy} onClick={primary}>{t.upkeep_bambu_sign_in}</Button>
      </div>
    </div>
  );
}
