import { LEGAL_SUFFIXES, normalizeText } from "./expenseParse";

export interface SupplierCount {
  supplier: string;
  count: number;
}

/** Significant name tokens: normalized, legal suffixes (SA, GmbH, Inc…) dropped. */
function significantTokens(name: string): string[] {
  return normalizeText(name)
    .split(" ")
    .filter((t) => t && !LEGAL_SUFFIXES.has(t));
}

function isSubset(a: string[], b: string[]): boolean {
  const set = new Set(b);
  return a.every((t) => set.has(t));
}

/**
 * Suggest groups of supplier-name variants that likely denote the same
 * supplier: two names relate when either's significant tokens are a subset
 * of the other's ("Adobe" ⊆ "Adobe Cloud"); relations union transitively.
 * Only groups with 2+ members are returned. Groups are sorted by total
 * usage, members by usage — so `group[0]` is the natural canonical default.
 * These are suggestions for the user to confirm, not automatic merges.
 */
export function suggestSupplierGroups(suppliers: SupplierCount[]): SupplierCount[][] {
  const entries = suppliers
    .map((s) => ({ ...s, tokens: significantTokens(s.supplier) }))
    .filter((s) => s.tokens.length > 0);

  // Union-find over indices
  const parent = entries.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i].tokens;
      const b = entries[j].tokens;
      if (isSubset(a, b) || isSubset(b, a)) union(i, j);
    }
  }

  const byRoot = new Map<number, SupplierCount[]>();
  entries.forEach((e, i) => {
    const root = find(i);
    const g = byRoot.get(root) ?? [];
    g.push({ supplier: e.supplier, count: e.count });
    byRoot.set(root, g);
  });

  return [...byRoot.values()]
    .filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => b.count - a.count || a.supplier.localeCompare(b.supplier)))
    .sort(
      (a, b) =>
        b.reduce((s, x) => s + x.count, 0) - a.reduce((s, x) => s + x.count, 0)
    );
}
