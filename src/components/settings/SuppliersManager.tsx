import { useState, useMemo } from "react";
import { useT } from "../../i18n/useT";
import { Select, Button } from "../ui";
import { useSupplierCounts, useMergeSuppliers } from "../../db/hooks/useExpenses";
import { suggestSupplierGroups, type SupplierCount } from "../../lib/supplierMerge";
import { undoableFromStore } from "../../lib/undo";

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
        <span className="text-xs text-muted shrink-0">{t.merge_into}</span>
        <Select value={canonical} onChange={(e) => setCanonical(e.target.value)} className="text-xs py-1">
          {group.map((g) => (
            <option key={g.supplier} value={g.supplier}>{g.supplier}</option>
          ))}
        </Select>
        <Button size="sm" onClick={() => onMerge(canonical, group.map((g) => g.supplier))} disabled={merging}>
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

  const doMerge = (canonical: string, names: string[]) => {
    const variants = names.filter((n) => n !== canonical);
    if (!canonical || variants.length === 0) return;
    mergeSuppliers.mutate(
      { canonical, variants },
      {
        onSuccess: () => {
          undoableFromStore(t.suppliers_merged);
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
        <h3 className="text-sm font-medium mb-2">{t.suggested_merges}</h3>
        {groups.length === 0 ? (
          <p className="text-sm text-muted">{t.no_merge_suggestions}</p>
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
        <h3 className="text-sm font-medium mb-2">{t.all_suppliers}</h3>
        {selected.size >= 2 && (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-muted shrink-0">{t.merge_into}</span>
            <Select value={manualTarget} onChange={(e) => setManualCanonical(e.target.value)} className="text-xs py-1">
              {selectedList.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
            <Button size="sm" onClick={() => doMerge(manualTarget, selectedList)} disabled={mergeSuppliers.isPending}>
              {t.merge}
            </Button>
          </div>
        )}
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {(counts ?? []).map((s) => (
            <label key={s.supplier} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(s.supplier)}
                onChange={() => toggle(s.supplier)}
                className="accent-[var(--accent)]"
              />
              <span className="flex-1 truncate">{s.supplier}</span>
              <span className="text-xs text-muted">{s.count}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
