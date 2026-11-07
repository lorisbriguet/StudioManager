import { useQuery, useMutation, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useUndoStore, clearUndoHistory } from "../../stores/undo-store";
import { getLabels } from "../../lib/notify";
import type { UIKey } from "../../i18n/ui";
import { AppError } from "../../lib/errors";
import type { LineItemFields } from "../../types/document";
import { invalidateMoney } from "../queryKeys";
import { isDraftDocument } from "../../lib/draftDocument";

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
  /** Its keys from src/db/queryKeys.ts: qk.invoices or qk.quotes. */
  keys: {
    all: QueryKey;
    detail: (id: number) => QueryKey;
    byProject: (projectId: number) => QueryKey;
    lineItems: (id: number) => QueryKey;
  };
  /** Kind name used in error messages: "invoice" or "quote". */
  kind: string;
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
  /** Runs after a save: see DocumentChange. */
  afterUpdate?: (id: number, change: DocumentChange, qc: QueryClient) => Promise<void>;
}

/** What a save changed, for afterUpdate. */
export interface DocumentChange {
  /** The status the document now has. */
  status: string | undefined;
  /** The status it had before the save. */
  prevStatus: string | undefined;
  /** The save gave the document its number. */
  numbered: boolean;
  /** The save changed the line items or the total: an edit of the content. */
  contentChanged: boolean;
}

const lineItemsKey = (items: LineItemFields[]) =>
  JSON.stringify(items.map((i) => [i.designation, i.rate, i.unit, i.quantity, i.amount]));

/** Read and write hooks shared by invoices and quotes, all with undo/redo. */
export function documentHooks<Doc extends DocumentRow, Item extends LineItemFields>(
  config: DocumentHooksConfig<Doc, Item>
) {
  const { keys, kind, dateField, lineItemForeignKey, labels, queries: q } = config;

  const stripLineItem = (item: Item): LineItemFields => {
    const { id: _id, [lineItemForeignKey]: _fk, ...rest } = item as unknown as Record<string, unknown>;
    return rest as unknown as LineItemFields;
  };

  // One queue per kind: invoices and quotes number separately.
  let sendQueue: Promise<unknown> = Promise.resolve();
  const oneSendAtATime = <T>(work: () => Promise<T>): Promise<T> => {
    const result = sendQueue.then(work);
    sendQueue = result.catch(() => {});
    return result;
  };

  // Undo and redo write straight to the table, past the save checks. An older
  // edit's undo can still hold status "draft" and a DRAFT reference: once the
  // document has left draft, restore its other fields but keep its status and
  // number, so the number is never freed.
  const keepNumber = async (id: number, target: Record<string, unknown>) => {
    const toDraft =
      target.status === "draft" ||
      (typeof target.reference === "string" && target.reference.startsWith("DRAFT"));
    if (!toDraft) return target;
    const current = await q.get(id);
    if (!current || current.status === "draft") return target;
    const { status: _s, reference: _r, ...rest } = target;
    return rest;
  };

  const restore = async (id: number, target: Record<string, unknown>, items?: LineItemFields[]) => {
    const fields = await keepNumber(id, target);
    if (Object.keys(fields).length === 0 && !items) return;
    await q.updateWithLineItems(id, fields as DocFields<Doc>, items);
  };

  const invalidate = (qc: QueryClient, ...extra: QueryKey[]) => {
    qc.invalidateQueries({ queryKey: keys.all });
    for (const k of extra) qc.invalidateQueries({ queryKey: k });
    invalidateMoney(qc);
  };

  function useList() {
    return useQuery({ queryKey: keys.all, queryFn: q.list });
  }

  function useOne(id: number) {
    return useQuery({ queryKey: keys.detail(id), queryFn: () => q.get(id), enabled: !!id });
  }

  function useByProject(projectId: number) {
    return useQuery({
      queryKey: keys.byProject(projectId),
      queryFn: () => q.listByProject(projectId),
      enabled: !!projectId,
    });
  }

  function useLineItems(id: number) {
    return useQuery({ queryKey: keys.lineItems(id), queryFn: () => q.lineItems(id), enabled: !!id });
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
            // Sending clears the history, but never delete a numbered one:
            // its number would be freed for the next document.
            const current = await q.get(id);
            if (current && !current.reference.startsWith("DRAFT")) {
              throw new AppError("error_undo_numbered_document", `Won't delete numbered ${kind} ${current.reference}`);
            }
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
        const fields = data as DocFields<Doc> & { status?: string; reference?: string; total?: number };
        const leavesDraft = !!fields.status && fields.status !== "draft";

        const save = async () => {
          const prev = await q.get(id);
          const prevLineItems = lineItems ? await q.lineItems(id) : undefined;
          let numbered = false;

          // A draft has no number to keep: it is deleted, not cancelled.
          if (fields.status === "cancelled" && prev && isDraftDocument(prev)) {
            throw new AppError("error_cancel_draft", "Cannot cancel a draft");
          }

          // Assign the real reference on any move out of draft (sent, or
          // straight to paid or overdue): no issued document keeps DRAFT-<uuid>.
          if (leavesDraft && prev?.reference.startsWith("DRAFT")) {
            const date = prev[dateField] as unknown as string | null;
            const year = date ? parseInt(date.substring(0, 4)) : new Date().getFullYear();
            fields.reference = await q.nextReference(year);
            numbered = true;
          }

          // Once it has left draft, it can't go back
          if (fields.status === "draft" && prev && prev.status !== "draft") {
            throw new AppError("error_revert_to_draft", "Cannot revert to draft status");
          }

          await q.updateWithLineItems(id, data, lineItems);
          return { prev, prevLineItems, numbered };
        };
        // Leaving draft picks the next free number: two at once would read the
        // same one, so they take turns from reading the number to writing it.
        const { prev, prevLineItems, numbered } =
          leavesDraft ? await oneSendAtATime(save) : await save();

        // Once numbered, no undo step may delete or revert it, and Cmd+Z must
        // not reach past the send to another document: start a fresh history.
        // To take a sent document back, the user cancels it.
        if (numbered) clearUndoHistory();

        const prevTotal = (prev as unknown as { total?: number } | null)?.total;
        const contentChanged =
          (!!lineItems && !!prevLineItems &&
            lineItemsKey(prevLineItems.map(stripLineItem)) !== lineItemsKey(lineItems)) ||
          (fields.total !== undefined && fields.total !== prevTotal);
        await config.afterUpdate?.(
          id,
          { status: fields.status ?? prev?.status, prevStatus: prev?.status, numbered, contentChanged },
          qc,
        );

        // A send that gave the document its number can't be undone: undoing it
        // would free the number for the next document. Cancel it instead.
        if (prev && !numbered) {
          const prevData: Record<string, unknown> = {};
          for (const field of Object.keys(data)) {
            prevData[field] = (prev as unknown as Record<string, unknown>)[field];
          }
          const prevItems = prevLineItems?.map(stripLineItem);
          useUndoStore.getState().push({
            label: `${getLabels()[labels.undoUpdate]} "${prev.reference}"`,
            execute: async () => {
              await restore(id, prevData, prevItems);
              invalidate(qc, keys.lineItems(id));
            },
            redo: async () => {
              await restore(id, data as Record<string, unknown>, lineItems);
              invalidate(qc, keys.lineItems(id));
            },
          });
        }
      },
      onSuccess: (_data, { id }) => invalidate(qc, keys.lineItems(id)),
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
