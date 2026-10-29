import { useMemo, useState } from "react";
import { Badge, Button, Callout, EmptyState, ICONS, IconButton, Table } from "../ui";
import { useConfirm } from "../../lib/confirm";
import { PrefilledExpenseModal } from "./PrefilledExpenseModal";
import { SubscriptionForm } from "./SubscriptionForm";
import { useT } from "../../i18n/useT";
import {
  useCancelSubscription,
  useDecideRenewal,
  useDeleteSubscription,
  usePendingRenewals,
  useSubscriptions,
} from "../../db/hooks/useUpkeep";
import { yearlyTotal, type PendingRenewal } from "../../db/queries/subscriptions";
import { formatMoney } from "../../lib/upkeep/money";
import { formatDisplayDate } from "../../utils/formatDate";
import type { Subscription } from "../../types/upkeep";

/** Subscriptions table, yearly total per currency and the renewals waiting for an expenses answer. */
export function SubscriptionsTab() {
  const t = useT();
  const confirm = useConfirm();
  const { data: subs = [] } = useSubscriptions();
  const { data: pending = [] } = usePendingRenewals();
  const decide = useDecideRenewal();
  const cancel = useCancelSubscription();
  const del = useDeleteSubscription();
  const [editing, setEditing] = useState<Subscription | "new" | null>(null);
  const [adding, setAdding] = useState<PendingRenewal | null>(null);

  const totals = useMemo(() => [...yearlyTotal(subs).entries()], [subs]);

  const yearly = (s: Subscription) => (s.period === "month" ? s.cost * 12 : s.cost);

  const doCancel = async (s: Subscription) => {
    if (!(await confirm({ title: t.upkeep_sub_cancel_confirm, confirmLabel: t.upkeep_sub_cancel, tone: "danger" }))) return;
    cancel.mutate(s.id);
  };
  const remove = async (s: Subscription) => {
    if (!(await confirm({ title: t.upkeep_sub_delete_confirm, confirmLabel: t.delete, tone: "danger" }))) return;
    del.mutate(s.id);
  };

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <div className="space-y-2">
          {pending.map((r) => (
            <Callout
              key={r.id}
              tone="warning"
              action={<>
                <span className="text-xs tabular-nums">{formatDisplayDate(r.renewed_on)}</span>
                <Button onClick={() => setAdding(r)}>{t.upkeep_renewal_add}</Button>
                <Button variant="secondary" onClick={() => decide.mutate({ id: r.id, decision: "skipped" })}>
                  {t.upkeep_renewal_skip}
                </Button>
              </>}
            >
              {t.upkeep_renewed_add
                .replace("{name}", r.name)
                .replace("{amount}", formatMoney(r.amount, r.currency))}
            </Callout>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted tabular-nums">
          {totals.map(([cur, amount]) => (
            <div key={cur}>{t.upkeep_yearly_total.replace("{amount}", formatMoney(amount, cur))}</div>
          ))}
        </div>
        <Button icon={ICONS.add} onClick={() => setEditing("new")}>{t.upkeep_add_subscription}</Button>
      </div>

      <Table>
        <Table.Head>
          <Table.Th>{t.name}</Table.Th>
          <Table.Th>{t.upkeep_col_renews}</Table.Th>
          <Table.Th>{t.upkeep_col_period}</Table.Th>
          <Table.Th numeric>{t.upkeep_col_cost}</Table.Th>
          <Table.Th numeric>{t.upkeep_col_per_year}</Table.Th>
          <Table.Th>{t.upkeep_col_status}</Table.Th>
          <Table.ActionsTh />
        </Table.Head>
        <Table.Body>
          {subs.map((s) => {
            const off = s.status === "cancelled";
            return (
              <Table.Row key={s.id} className={off ? "opacity-50" : ""}>
                <Table.Td>
                  <div className="font-medium">{s.name}</div>
                  {s.plan && <div className="text-xs text-muted">{s.plan}</div>}
                </Table.Td>
                <Table.Td className="tabular-nums">{off ? "" : formatDisplayDate(s.renews_on)}</Table.Td>
                <Table.Td muted>
                  {s.period === "month" ? t.upkeep_period_month : t.upkeep_period_year}
                </Table.Td>
                <Table.Td numeric>{formatMoney(s.cost, s.currency)}</Table.Td>
                <Table.Td numeric>{formatMoney(yearly(s), s.currency)}</Table.Td>
                <Table.Td>
                  <Badge variant={off ? "neutral" : "success"}>{off ? t.cancelled : t.active}</Badge>
                </Table.Td>
                <Table.Actions>
                  <IconButton size="xs" icon={ICONS.edit} label={t.edit} onClick={() => setEditing(s)} />
                  {!off && (
                    <IconButton size="xs" icon={ICONS.danger} label={t.upkeep_sub_cancel} onClick={() => void doCancel(s)} />
                  )}
                  <IconButton size="xs" icon={ICONS.delete} label={t.delete} tone="danger" onClick={() => void remove(s)} />
                </Table.Actions>
              </Table.Row>
            );
          })}
          {subs.length === 0 && (
            <Table.Empty colSpan={7}>
              <EmptyState
                icon={ICONS.recurring}
                message={t.upkeep_subs_empty}
                action={<Button icon={ICONS.add} onClick={() => setEditing("new")}>{t.upkeep_add_subscription}</Button>}
              />
            </Table.Empty>
          )}
        </Table.Body>
      </Table>

      {editing && (
        <SubscriptionForm subscription={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />
      )}
      {adding && (
        <PrefilledExpenseModal
          title={t.upkeep_renewal_expense_title}
          supplier={subs.find((s) => s.id === adding.subscription_id)?.vendor ?? adding.name}
          amount={adding.amount}
          date={adding.renewed_on}
          onCancel={() => setAdding(null)}
          onSaved={async (expenseId) => {
            await decide.mutateAsync({ id: adding.id, decision: "added", expenseId });
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}
