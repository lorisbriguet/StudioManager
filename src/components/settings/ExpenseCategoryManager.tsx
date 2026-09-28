import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useT } from "../../i18n/useT";
import { useAppStore } from "../../stores/app-store";
import { useExpenseCategories, useCreateExpenseCategory, useUpdateExpenseCategory, useDeleteExpenseCategory, isDefaultCategory } from "../../db/hooks/useExpenses";
import { isCategoryInUse } from "../../db/queries/expenses";
import type { ExpenseCategory } from "../../types/expense";
import { getNamedTagColor } from "../../lib/tagColors";
import { Input, Select } from "../ui";
import { ColorSwatchPicker } from "./ColorSwatchPicker";

export function ExpenseCategoryManager() {
  const t = useT();
  const darkMode = useAppStore((s) => s.darkMode);
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
      toast.success(t.toast_category_created);
      setAdding(false);
      setForm({ code: "", name_fr: "", name_en: "", pl_section: "operating", color: null });
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleSaveEdit = async () => {
    if (!editingCode) return;
    try {
      const { code: _, ...data } = form;
      await updateCategory.mutateAsync({ code: editingCode, data });
      toast.success(t.toast_category_updated);
      setEditingCode(null);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleDelete = async (code: string) => {
    if (isDefaultCategory(code)) {
      toast.error(t.toast_category_default);
      return;
    }
    try {
      await deleteCategory.mutateAsync(code);
      toast.success(t.toast_category_deleted);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("in use")) toast.error(t.toast_category_in_use);
      else toast.error(msg);
    }
  };

  const startEdit = (cat: ExpenseCategory) => {
    setEditingCode(cat.code);
    setForm({ ...cat });
    setAdding(false);
  };

  return (
    <div className="max-w-3xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border-divider)] text-left text-xs text-muted uppercase">
            <th className="py-2 pr-2 w-20">{t.category_code}</th>
            <th className="py-2 pr-2">{t.category_name_fr}</th>
            <th className="py-2 pr-2">{t.category_name_en}</th>
            <th className="py-2 pr-2 w-32">{t.category_pl_section}</th>
            <th className="py-2 pr-2 w-40">{t.color}</th>
            <th className="py-2 w-28" />
          </tr>
        </thead>
        <tbody>
          {cats.map((cat) => (
            <tr key={cat.code} className="border-b border-[var(--color-border-divider)]">
              {editingCode === cat.code ? (
                <>
                  <td className="py-2 pr-2 text-muted">{cat.code}</td>
                  <td className="py-2 pr-2">
                    <Input
                      value={form.name_fr}
                      onChange={(e) => setForm({ ...form, name_fr: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      value={form.name_en}
                      onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Select
                      value={form.pl_section}
                      onChange={(e) => setForm({ ...form, pl_section: e.target.value as ExpenseCategory["pl_section"] })}
                    >
                      <option value="operating">{t.pl_operating}</option>
                      <option value="social_charges">{t.pl_social_charges}</option>
                    </Select>
                  </td>
                  <td className="py-2 pr-2">
                    <ColorSwatchPicker value={form.color} onChange={(c) => setForm({ ...form, color: c })} />
                  </td>
                  <td className="py-2 flex gap-1">
                    <button type="button" onClick={handleSaveEdit} className="px-2 py-1 bg-accent text-white text-xs rounded-md hover:bg-accent-hover">
                      {t.save}
                    </button>
                    <button type="button" onClick={() => setEditingCode(null)} className="px-2 py-1 border border-[var(--color-input-border)] text-xs rounded-md hover:bg-[var(--color-hover-row)]">
                      {t.cancel}
                    </button>
                  </td>
                </>
              ) : (
                <>
                  <td className="py-2 pr-2 font-mono">{cat.code}</td>
                  <td className="py-2 pr-2">{cat.name_fr}</td>
                  <td className="py-2 pr-2">{cat.name_en}</td>
                  <td className="py-2 pr-2 text-muted">
                    {cat.pl_section === "operating" ? t.pl_operating : t.pl_social_charges}
                  </td>
                  <td className="py-2 pr-2">
                    {cat.color ? (() => {
                      const c = getNamedTagColor(cat.color, darkMode);
                      return (
                        <span
                          className="inline-block w-5 h-5 rounded-full"
                          style={{ background: c.bg, border: `2px solid ${c.text}40` }}
                          title={cat.color}
                        />
                      );
                    })() : (
                      <span className="text-xs text-muted">auto</span>
                    )}
                  </td>
                  <td className="py-2 flex gap-1">
                    <button type="button" onClick={() => startEdit(cat)} className="px-2 py-1 border border-[var(--color-input-border)] text-xs rounded-md hover:bg-[var(--color-hover-row)]">
                      {t.edit}
                    </button>
                    {isDefaultCategory(cat.code) ? (
                      <span className="px-2 py-1 text-xs text-muted">{t.default_category}</span>
                    ) : categoryUsage[cat.code] ? (
                      <span className="px-2 py-1 text-xs text-muted">{t.category_in_use}</span>
                    ) : (
                      <button type="button" onClick={() => handleDelete(cat.code)} className="px-2 py-1 border border-[var(--color-danger-text)]/30 text-[var(--color-danger-text)] text-xs rounded-md hover:bg-[var(--color-danger-bg)]">
                        {t.delete}
                      </button>
                    )}
                  </td>
                </>
              )}
            </tr>
          ))}
          {adding && (
            <tr className="border-b border-[var(--color-border-divider)]">
              <td className="py-2 pr-2">
                <Input
                  fullWidth={false}
                  className="w-16"
                  placeholder="XX"
                  maxLength={4}
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                />
              </td>
              <td className="py-2 pr-2">
                <Input value={form.name_fr} onChange={(e) => setForm({ ...form, name_fr: e.target.value })} />
              </td>
              <td className="py-2 pr-2">
                <Input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
              </td>
              <td className="py-2 pr-2">
                <Select
                  value={form.pl_section}
                  onChange={(e) => setForm({ ...form, pl_section: e.target.value as ExpenseCategory["pl_section"] })}
                >
                  <option value="operating">{t.pl_operating}</option>
                  <option value="social_charges">{t.pl_social_charges}</option>
                </Select>
              </td>
              <td className="py-2 pr-2">
                <ColorSwatchPicker value={form.color} onChange={(c) => setForm({ ...form, color: c })} />
              </td>
              <td className="py-2 flex gap-1">
                <button type="button" onClick={handleSaveNew} className="px-2 py-1 bg-accent text-white text-xs rounded-md hover:bg-accent-hover">
                  {t.save}
                </button>
                <button type="button" onClick={() => setAdding(false)} className="px-2 py-1 border border-[var(--color-input-border)] text-xs rounded-md hover:bg-[var(--color-hover-row)]">
                  {t.cancel}
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
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
