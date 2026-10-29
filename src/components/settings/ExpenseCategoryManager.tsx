import { useState, useEffect } from "react";
import { notify } from "../../lib/notify";
import { undoableFromStore } from "../../lib/undo";
import { useT } from "../../i18n/useT";
import { useExpenseCategories, useCreateExpenseCategory, useUpdateExpenseCategory, useDeleteExpenseCategory, isDefaultCategory } from "../../db/hooks/useExpenses";
import { isCategoryInUse } from "../../db/queries/expenses";
import type { ExpenseCategory } from "../../types/expense";
import { getNamedTagColor } from "../../lib/tagColors";
import { ICONS, IconButton, Input, Select, Table } from "../ui";
import { ColorSwatchPicker } from "./ColorSwatchPicker";

export function ExpenseCategoryManager() {
  const t = useT();
  const { data: categories } = useExpenseCategories();
  const cats = categories ?? [];
  const createCategory = useCreateExpenseCategory();
  const updateCategory = useUpdateExpenseCategory();
  const deleteCategory = useDeleteExpenseCategory();
  const [adding, setAdding] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [form, setForm] = useState<ExpenseCategory>({
    code: "",
    name_fr: "",
    name_en: "",
    pl_section: "operating",
    color: null,
  });
  const [categoryUsage, setCategoryUsage] = useState<Record<string, boolean>>({});

  const catCodes = cats.map((c) => c.code).join(",");
  useEffect(() => {
    if (!catCodes) return;
    Promise.all(
      cats.map(async (c) => [c.code, await isCategoryInUse(c.code)] as const)
    ).then((results) => {
      setCategoryUsage(Object.fromEntries(results));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate: depend on the catCodes fingerprint instead of `cats`, whose array identity changes every render (categories ?? []) and would re-run the async usage check constantly
  }, [catCodes]);

  const handleSaveNew = async () => {
    if (!form.code || !form.name_fr || !form.name_en) return;
    try {
      await createCategory.mutateAsync(form);
      notify.success(t.toast_category_created);
      setAdding(false);
      setForm({ code: "", name_fr: "", name_en: "", pl_section: "operating", color: null });
    } catch {
      // reported by the mutation
    }
  };

  const handleSaveEdit = async () => {
    if (!editingCode) return;
    try {
      const { code: _, ...data } = form;
      await updateCategory.mutateAsync({ code: editingCode, data });
      notify.success(t.toast_category_updated);
      setEditingCode(null);
    } catch {
      // reported by the mutation
    }
  };

  const handleDelete = async (code: string) => {
    if (isDefaultCategory(code)) {
      notify.error(t.toast_category_default);
      return;
    }
    // Checked first so the user gets the reason, not a generic failure
    if (await isCategoryInUse(code)) {
      notify.error(t.toast_category_in_use);
      return;
    }
    try {
      await deleteCategory.mutateAsync(code);
      undoableFromStore(t.toast_category_deleted);
    } catch {
      // reported by the mutation
    }
  };

  const startEdit = (cat: ExpenseCategory) => {
    setEditingCode(cat.code);
    setForm({ ...cat });
    setAdding(false);
  };

  return (
    <div className="max-w-3xl">
      <Table density="compact">
        <Table.Head>
          <Table.Th className="w-20">{t.category_code}</Table.Th>
          <Table.Th>{t.category_name_fr}</Table.Th>
          <Table.Th>{t.category_name_en}</Table.Th>
          <Table.Th className="w-32">{t.category_pl_section}</Table.Th>
          <Table.Th className="w-40">{t.color}</Table.Th>
          <Table.ActionsTh />
        </Table.Head>
        <Table.Body>
          {cats.map((cat) => (
            <Table.Row key={cat.code}>
              {editingCode === cat.code ? (
                <>
                  <Table.Td muted>{cat.code}</Table.Td>
                  <Table.Td>
                    <Input
                      aria-label={t.category_name_fr}
                      value={form.name_fr}
                      onChange={(e) => setForm({ ...form, name_fr: e.target.value })}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Input
                      aria-label={t.category_name_en}
                      value={form.name_en}
                      onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Select
                      aria-label={t.category_pl_section}
                      value={form.pl_section}
                      onChange={(e) => setForm({ ...form, pl_section: e.target.value as ExpenseCategory["pl_section"] })}
                    >
                      <option value="operating">{t.pl_operating}</option>
                      <option value="social_charges">{t.pl_social_charges}</option>
                    </Select>
                  </Table.Td>
                  <Table.Td>
                    <ColorSwatchPicker value={form.color} onChange={(c) => setForm({ ...form, color: c })} />
                  </Table.Td>
                  <Table.Actions always>
                    <IconButton icon={ICONS.save} label={t.save} size="xs" color="accent" onClick={handleSaveEdit} />
                    <IconButton icon={ICONS.close} label={t.cancel} size="xs" onClick={() => setEditingCode(null)} />
                  </Table.Actions>
                </>
              ) : (
                <>
                  <Table.Td className="font-mono">{cat.code}</Table.Td>
                  <Table.Td>{cat.name_fr}</Table.Td>
                  <Table.Td>{cat.name_en}</Table.Td>
                  <Table.Td muted>
                    {cat.pl_section === "operating" ? t.pl_operating : t.pl_social_charges}
                  </Table.Td>
                  <Table.Td>
                    {cat.color ? (() => {
                      const c = getNamedTagColor(cat.color);
                      return (
                        <span
                          className="inline-block w-5 h-5 rounded-full"
                          style={{ background: c.bg, border: `2px solid color-mix(in srgb, ${c.text} 25%, transparent)` }}
                          title={cat.color}
                        />
                      );
                    })() : (
                      <span className="text-xs text-muted">auto</span>
                    )}
                  </Table.Td>
                  <Table.Actions>
                    {/* Default and in-use categories can't be deleted: say why where the delete would be. */}
                    {isDefaultCategory(cat.code) ? (
                      <span className="px-1 text-xs text-muted">{t.default_category}</span>
                    ) : categoryUsage[cat.code] ? (
                      <span className="px-1 text-xs text-muted">{t.category_in_use}</span>
                    ) : null}
                    <IconButton icon={ICONS.edit} label={t.edit} size="xs" onClick={() => startEdit(cat)} />
                    {!isDefaultCategory(cat.code) && !categoryUsage[cat.code] && (
                      <IconButton icon={ICONS.delete} label={t.delete} size="xs" tone="danger" onClick={() => handleDelete(cat.code)} />
                    )}
                  </Table.Actions>
                </>
              )}
            </Table.Row>
          ))}
          {adding && (
            <Table.Row>
              <Table.Td>
                <Input
                  width="xs"
                  aria-label={t.category_code}
                  placeholder="XX"
                  maxLength={4}
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                />
              </Table.Td>
              <Table.Td>
                <Input aria-label={t.category_name_fr} value={form.name_fr} onChange={(e) => setForm({ ...form, name_fr: e.target.value })} />
              </Table.Td>
              <Table.Td>
                <Input aria-label={t.category_name_en} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
              </Table.Td>
              <Table.Td>
                <Select
                  aria-label={t.category_pl_section}
                  value={form.pl_section}
                  onChange={(e) => setForm({ ...form, pl_section: e.target.value as ExpenseCategory["pl_section"] })}
                >
                  <option value="operating">{t.pl_operating}</option>
                  <option value="social_charges">{t.pl_social_charges}</option>
                </Select>
              </Table.Td>
              <Table.Td>
                <ColorSwatchPicker value={form.color} onChange={(c) => setForm({ ...form, color: c })} />
              </Table.Td>
              <Table.Actions always>
                <IconButton icon={ICONS.save} label={t.save} size="xs" color="accent" onClick={handleSaveNew} />
                <IconButton icon={ICONS.close} label={t.cancel} size="xs" onClick={() => setAdding(false)} />
              </Table.Actions>
            </Table.Row>
          )}
        </Table.Body>
      </Table>
      {!adding && !editingCode && (
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setForm({ code: "", name_fr: "", name_en: "", pl_section: "operating", color: null });
          }}
          className="mt-3 px-3 py-1.5 text-sm text-accent border border-accent rounded-md hover:bg-accent-light"
        >
          + {t.add_category}
        </button>
      )}
    </div>
  );
}
