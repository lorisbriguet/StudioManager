import { useQuery, useMutation, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useUndoStore } from "../../stores/undo-store";
import { getLabels } from "../../lib/notify";
import type { UIKey } from "../../i18n/ui";
import { AppError } from "../../lib/errors";
import type { LineItemFields } from "../../types/document";

/** The fields every invoice or quote row has that these hooks rely on. */
interface DocumentRow {
  id: number;
  reference: string;
  status: string;
  created_at: string;
  updated_at: string;
}

type NewDoc<Doc> = Omit<Doc, "id" | "created_at" | "updated_at">;
type DocFields<Doc> = Partial<NewDoc<Doc>>;
type LabelKey = UIKey;

export interface DocumentHooksConfig<Doc extends DocumentRow, Item extends LineItemFields> {
  /** Query key prefix: "invoices" or "quotes". */
  key: string;
  lineItemsKey: (id: number) => QueryKey;
  /** Column whose year numbers the reference when the document is sent. */
  dateField: keyof Doc & string;
  /** Foreign key column on line items, stripped before restoring them. */
  lineItemForeignKey: keyof Item & string;
  labels: {
    saveError: LabelKey;
    deleteError: LabelKey;
    undoCreate: LabelKey;
    undoUpdate: LabelKey;
    undoDelete: LabelKey;
  };
  queries: {
    list: () => Promise<Doc[]>;
    get: (id: number) => Promise<Doc | null>;
    listByProject: (projectId: number) => Promise<Doc[]>;
    lineItems: (id: number) => Promise<Item[]>;
    create: (data: NewDoc<Doc>, lineItems: LineItemFields[]) => Promise<number>;
    updateWithLineItems: (id: number, data: DocFields<Doc>, lineItems?: LineItemFields[]) => Promise<void>;
    delete: (id: number) => Promise<void>;
    nextReference: (year: number) => Promise<string>;
  };
  /** Runs before a delete; throw to refuse it. */
  beforeDelete?: (prev: Doc) => void;
  /** Runs after a save, with the status the document now has. */
  afterUpdate?: (id: number, status: string | undefined, qc: QueryClient) => Promise<void>;
}

/** Read and write hooks shared by invoices and quotes, all with undo/redo. */
export function documentHooks<Doc extends DocumentRow, Item extends LineItemFields>(
  config: DocumentHooksConfig<Doc, Item>
) {
  const { key, lineItemsKey, dateField, lineItemForeignKey, labels, queries: q } = config;

  const stripLineItem = (item: Item): LineItemFields => {
    const { id: _id, [lineItemForeignKey]: _fk, ...rest } = item as unknown as Record<string, unknown>;
    return rest as unknown as LineItemFields;
  };

  const invalidate = (qc: QueryClient, ...extra: QueryKey[]) => {
    qc.invalidateQueries({ queryKey: [key] });
    for (const k of extra) qc.invalidateQueries({ queryKey: k });
    qc.invalidateQueries({ queryKey: ["finance"] });
  };

  function useList() {
    return useQuery({ queryKey: [key], queryFn: q.list });
  }

  function useOne(id: number) {
    return useQuery({ queryKey: [key, id], queryFn: () => q.get(id), enabled: !!id });
  }

  function useByProject(projectId: number) {
    return useQuery({
      queryKey: [key, "project", projectId],
      queryFn: () => q.listByProject(projectId),
      enabled: !!projectId,
    });
  }

  function useLineItems(id: number) {
    return useQuery({ queryKey: lineItemsKey(id), queryFn: () => q.lineItems(id), enabled: !!id });
  }

  function useCreate() {
    const qc = useQueryClient();
    return useMutation({
      meta: { errorLabel: labels.saveError },
      mutationFn: async ({ data, lineItems }: { data: NewDoc<Doc>; lineItems: LineItemFields[] }) => {
        const id = await q.create(data, lineItems);
        useUndoStore.getState().push({
          label: `${getLabels()[labels.undoCreate]} "${(data as { reference: string }).reference}"`,
          execute: async () => {
            await q.delete(id);
            invalidate(qc);
          },
          redo: async () => {
            await q.create(data, lineItems);
            invalidate(qc);
          },
        });
        return id;
      },
      onSuccess: () => invalidate(qc),
    });
  }

  function useUpdate() {
    const qc = useQueryClient();
    return useMutation({
      meta: { errorLabel: labels.saveError },
      mutationFn: async ({ id, data, lineItems }: {
        id: number;
        data: DocFields<Doc>;
        lineItems?: LineItemFields[];
      }) => {
        const prev = await q.get(id);
        const prevLineItems = lineItems ? await q.lineItems(id) : undefined;
        const fields = data as DocFields<Doc> & { status?: string; reference?: string };

        // Assign the real reference when a draft is sent
        if (fields.status === "sent" && prev?.reference.startsWith("DRAFT")) {
          const date = prev[dateField] as unknown as string | null;
          const year = date ? parseInt(date.substring(0, 4)) : new Date().getFullYear();
          fields.reference = await q.nextReference(year);
        }

        // Once it has left draft, it can't go back
        if (fields.status === "draft" && prev && prev.status !== "draft") {
          throw new AppError("error_revert_to_draft", "Cannot revert to draft status");
        }

        await q.updateWithLineItems(id, data, lineItems);
        await config.afterUpdate?.(id, fields.status ?? prev?.status, qc);

        if (prev) {
          const prevData: Record<string, unknown> = {};
          for (const field of Object.keys(data)) {
            prevData[field] = (prev as unknown as Record<string, unknown>)[field];
          }
          const prevItems = prevLineItems?.map(stripLineItem);
          useUndoStore.getState().push({
            label: `${getLabels()[labels.undoUpdate]} "${prev.reference}"`,
            execute: async () => {
              await q.updateWithLineItems(id, prevData as DocFields<Doc>, prevItems);
              invalidate(qc, lineItemsKey(id));
            },
            redo: async () => {
              await q.updateWithLineItems(id, data, lineItems);
              invalidate(qc, lineItemsKey(id));
            },
          });
        }
      },
      onSuccess: (_data, { id }) => invalidate(qc, lineItemsKey(id)),
    });
  }

  function useDelete() {
    const qc = useQueryClient();
    return useMutation({
      meta: { errorLabel: labels.deleteError },
      mutationFn: async (id: number) => {
        const prev = await q.get(id);
        if (prev) config.beforeDelete?.(prev);
        const prevItems = await q.lineItems(id);
        await q.delete(id);
        if (prev) {
          const { id: _id, created_at: _c, updated_at: _u, ...data } = prev;
          const items = prevItems.map(stripLineItem);
          // The restore assigns a fresh rowid; redo targets exactly that id —
          // a reference lookup could hit a different row with the same reference.
          let restoredId: number | null = null;
          useUndoStore.getState().push({
            label: `${getLabels()[labels.undoDelete]} "${prev.reference}"`,
            execute: async () => {
              restoredId = await q.create(data as unknown as NewDoc<Doc>, items);
              invalidate(qc);
            },
            redo: async () => {
              if (restoredId !== null) {
                await q.delete(restoredId);
                invalidate(qc);
              }
            },
          });
        }
      },
      onSuccess: () => invalidate(qc),
    });
  }

  return { useList, useOne, useByProject, useLineItems, useCreate, useUpdate, useDelete };
}
