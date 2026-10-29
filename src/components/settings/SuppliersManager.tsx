import { useState, useMemo, useId } from "react";
import { useT } from "../../i18n/useT";
import { Checkbox, Select, Button, FIELD_LABEL, EmptyState, PanelTitle } from "../ui";
import { useSupplierCounts, useMergeSuppliers } from "../../db/hooks/useExpenses";
import { suggestSupplierGroups, type SupplierCount } from "../../lib/supplierMerge";
import { undoableFromStore, undoTop } from "../../lib/undo";

/** One suggested variant group: pick the canonical name and merge. */
function SupplierGroupCard({
  group,
  onMerge,
  merging,
}: {
  group: SupplierCount[];
  onMerge: (canonical: string, names: string[]) => void;
  merging: boolean;
}) {
  const t = useT();
  const [canonical, setCanonical] = useState(group[0].supplier);
  const selectId = useId();
  return (
    <div className="rounded-xl bg-[var(--color-input-bg)] p-3 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {group.map((g) => (
          <span
            key={g.supplier}
            className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-border-divider)]"
          >
            {g.supplier} <span className="text-muted">×{g.count}</span>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={selectId} className={`${FIELD_LABEL} shrink-0`}>{t.merge_into}</label>
        <Select id={selectId} value={canonical} onChange={(e) => setCanonical(e.target.value)}>
          {group.map((g) => (
            <option key={g.supplier} value={g.supplier}>{g.supplier}</option>
          ))}
        </Select>
        <Button onClick={() => onMerge(canonical, group.map((g) => g.supplier))} disabled={merging}>
          {t.merge}
        </Button>
      </div>
    </div>
  );
}

export function SuppliersManager() {
  const t = useT();
  const { data: counts } = useSupplierCounts();
  const mergeSuppliers = useMergeSuppliers();
  const groups = useMemo(() => suggestSupplierGroups(counts ?? []), [counts]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manualCanonical, setManualCanonical] = useState("");
  const manualSelectId = useId();

  const doMerge = (canonical: string, names: string[]) => {
    const variants = names.filter((n) => n !== canonical);
    if (!canonical || variants.length === 0) return;
    const before = undoTop();
    mergeSuppliers.mutate(
      { canonical, variants },
      {
        onSuccess: () => {
          undoableFromStore(t.suppliers_merged, before);
          setSelected(new Set());
          setManualCanonical("");
        },
      }
    );
  };

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const selectedList = [...selected];
  const manualTarget = selected.has(manualCanonical) ? manualCanonical : selectedList[0] ?? "";

  return (
    <div className="space-y-6">
      <div>
        <PanelTitle as="h3" title={t.suggested_merges} className="mb-2" />
        {groups.length === 0 ? (
          <EmptyState size="sm" message={t.no_merge_suggestions} />
        ) : (
          <div className="space-y-2">
            {groups.map((g) => (
              <SupplierGroupCard
                key={g[0].supplier}
                group={g}
                onMerge={doMerge}
                merging={mergeSuppliers.isPending}
              />
            ))}
          </div>
        )}
      </div>
      <div>
        <PanelTitle as="h3" title={t.all_suppliers} className="mb-2" />
        {selected.size >= 2 && (
          <div className="flex items-center gap-2 mb-2">
            <label htmlFor={manualSelectId} className={`${FIELD_LABEL} shrink-0`}>{t.merge_into}</label>
            <Select id={manualSelectId} value={manualTarget} onChange={(e) => setManualCanonical(e.target.value)}>
              {selectedList.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
            <Button onClick={() => doMerge(manualTarget, selectedList)} disabled={mergeSuppliers.isPending}>
              {t.merge}
            </Button>
          </div>
        )}
        <div className="flex flex-col items-start gap-1 max-h-96 overflow-y-auto">
          {(counts ?? []).map((s) => (
            <Checkbox
              key={s.supplier}
              label={
                <>
                  {s.supplier} <span className="text-xs text-muted">×{s.count}</span>
                </>
              }
              checked={selected.has(s.supplier)}
              onChange={() => toggle(s.supplier)}
              className="py-0.5"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
