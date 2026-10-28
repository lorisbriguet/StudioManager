import { createContext, useContext, type HTMLAttributes, type MouseEvent, type ReactNode, type Ref, type TdHTMLAttributes, type ThHTMLAttributes } from "react";
import { ChevronRight } from "lucide-react";
import { Checkbox } from "./Checkbox";
import { SectionLabel } from "./SectionLabel";
import { REVEAL_CLASSES } from "./IconButton";
import { NUMERIC, TABLE_ROW_H, TABLE_TH, TABLE_X, type TableDensity } from "./tokens";

/**
 * Table — every data table in the app. See DESIGN-SYSTEM.md, "Tables".
 *
 *   <Table density="compact">
 *     <Table.Head>
 *       <Table.SelectAll … /> <SortHeader … /> <Table.Th numeric>Amount</Table.Th> <Table.ActionsTh />
 *     </Table.Head>
 *     <Table.Body>
 *       <Table.Group colSpan={5} label="2026" count="3 invoices" total="CHF 18 130.50" open onToggle={…} />
 *       <Table.Row onOpen={() => open(x)} data-list-row>
 *         <Table.Select … /> <Table.Td>…</Table.Td> <Table.Td numeric>…</Table.Td>
 *         <Table.Actions><IconButton size="xs" … /></Table.Actions>
 *       </Table.Row>
 *       {rows.length === 0 && <Table.Empty colSpan={5}><EmptyState … /></Table.Empty>}
 *     </Table.Body>
 *     <Table.Foot>…</Table.Foot>
 *   </Table>
 */

const DensityContext = createContext<TableDensity>("default");
/** The density of the table around a cell (default outside a Table). */
export const useTableDensity = () => useContext(DensityContext);

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  density?: TableDensity;
}

function TableRoot({ density = "default", className = "", children, ...rest }: TableProps) {
  return (
    <DensityContext.Provider value={density}>
      <div className="overflow-x-auto">
        <table className={`w-full text-sm border-collapse ${className}`} {...rest}>
          {children}
        </table>
      </div>
    </DensityContext.Provider>
  );
}

/** The header row, with the header line under it. */
function Head({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <thead>
      <tr className={`border-b border-[var(--color-border-header)] ${className}`}>{children}</tr>
    </thead>
  );
}

/** A column as narrow as its content (drag handles, icons): 8px sides, no wrapping. */
const NARROW = "w-px px-2 whitespace-nowrap";

interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
  narrow?: boolean;
}

function Th({ numeric, narrow, className = "", children, ...rest }: ThProps) {
  const d = useTableDensity();
  return (
    <th className={`${TABLE_TH} ${narrow ? NARROW : TABLE_X[d]} ${numeric ? "text-right" : "text-left"} ${className}`} {...rest}>
      {children}
    </th>
  );
}

function Body({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tbody className={className}>{children}</tbody>;
}

/** Clicks on these inside a row act on themselves, not on the row. */
const OWN_CLICK = 'a, button, input, select, textarea, label, [role="button"], [role="checkbox"], [role="switch"], [contenteditable="true"], [data-no-row-click]';

interface RowProps extends HTMLAttributes<HTMLTableRowElement> {
  /** A single click anywhere on the row (outside its controls) opens it. Gets the click, e.g. to open a menu at the cursor. */
  onOpen?: (e: MouseEvent<HTMLTableRowElement>) => void;
  selected?: boolean;
  /** Keyboard focus from useListNavigation. */
  focused?: boolean;
  /** For drag-and-drop (dnd-kit setNodeRef). */
  ref?: Ref<HTMLTableRowElement>;
}

function Row({ onOpen, selected, focused, className = "", onClick, children, ref, ...rest }: RowProps) {
  const handleClick = (e: MouseEvent<HTMLTableRowElement>) => {
    onClick?.(e);
    if (!onOpen || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    const own = target.closest(OWN_CLICK);
    if (own && e.currentTarget.contains(own)) return;
    if (window.getSelection()?.toString()) return;
    onOpen(e);
  };
  return (
    <tr
      ref={ref}
      className={`group/row border-b border-[var(--color-border-divider)] transition-colors ${
        selected ? "bg-accent-tint" : "hover:bg-[var(--color-hover-row)]"
      } ${onOpen ? "cursor-pointer" : ""} ${focused ? "ring-2 ring-accent/40 ring-inset" : ""} ${className}`}
      onClick={onOpen || onClick ? handleClick : undefined}
      {...rest}
    >
      {children}
    </tr>
  );
}

interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
  muted?: boolean;
  narrow?: boolean;
}

function Td({ numeric, muted, narrow, className = "", children, ...rest }: TdProps) {
  const d = useTableDensity();
  return (
    <td
      className={`${TABLE_ROW_H[d]} ${narrow ? NARROW : TABLE_X[d]} py-1 align-middle ${numeric ? NUMERIC : ""} ${muted ? "text-muted" : ""} ${className}`}
      {...rest}
    >
      {children}
    </td>
  );
}

/** Header checkbox: selects all, shows "some selected" as indeterminate. */
function SelectAll({ all, some, onToggle, label }: { all: boolean; some: boolean; onToggle: () => void; label?: string }) {
  return (
    <th className={`${TABLE_TH} w-8 px-2`}>
      <Checkbox checked={all} indeterminate={some && !all} onChange={onToggle} aria-label={label} />
    </th>
  );
}

/** Row checkbox. Shift-click is passed on for range selection. */
function Select({ checked, onToggle, label }: { checked: boolean; onToggle: (shift: boolean) => void; label?: string }) {
  const d = useTableDensity();
  return (
    <td className={`${TABLE_ROW_H[d]} w-8 px-2 align-middle`}>
      <Checkbox
        checked={checked}
        aria-label={label}
        onChange={(e) => onToggle(e.nativeEvent instanceof globalThis.MouseEvent ? e.nativeEvent.shiftKey : false)}
      />
    </td>
  );
}

/** Header over the actions column: empty, or a column-level action (add column). */
function ActionsTh({ children }: { children?: ReactNode }) {
  return <th className={`${TABLE_TH} w-px px-2 text-right`}>{children}</th>;
}

/**
 * Row actions: always the last column, xs IconButtons, shown on row hover,
 * keyboard focus, or while one of its menus is open. `always` keeps them
 * visible (Save / Cancel on a row being edited).
 */
function Actions({ children, always }: { children?: ReactNode; always?: boolean }) {
  const d = useTableDensity();
  return (
    <td className={`${TABLE_ROW_H[d]} w-px px-2 align-middle whitespace-nowrap`}>
      <div
        className={`flex items-center justify-end gap-0.5 ${
          always ? "" : `${REVEAL_CLASSES.row} group-focus-within/row:opacity-100 has-[[aria-expanded=true]]:opacity-100`
        }`}
      >
        {children}
      </div>
    </td>
  );
}

interface GroupProps {
  colSpan: number;
  label: ReactNode;
  count?: ReactNode;
  /** Right-aligned, e.g. the group's total. */
  total?: ReactNode;
  open: boolean;
  onToggle: () => void;
}

/** A collapsible group row (years): chevron, SectionLabel, count, total. */
function Group({ colSpan, label, count, total, open, onToggle }: GroupProps) {
  const d = useTableDensity();
  return (
    <tr className="border-b border-[var(--color-border-divider)] hover:bg-[var(--color-hover-row)]">
      <td colSpan={colSpan} className={`h-8 ${TABLE_X[d]} py-0`}>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="focus-accent flex w-full items-center gap-2 rounded text-left cursor-pointer"
        >
          <ChevronRight size={12} aria-hidden="true" className={`text-muted transition-transform ${open ? "rotate-90" : ""}`} />
          <SectionLabel as="span">{label}</SectionLabel>
          {count != null && <span className="text-xs text-muted">{count}</span>}
          {total != null && <span className={`ml-auto text-xs font-medium ${NUMERIC}`}>{total}</span>}
        </button>
      </td>
    </tr>
  );
}

/** The empty state, inside the body so the header stays. */
function Empty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan}>{children}</td>
    </tr>
  );
}

/** Totals: one row at the bottom, inside the table, with the header line above it. */
function Foot({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <tfoot>
      <tr className={`border-t border-[var(--color-border-header)] font-medium ${className}`}>{children}</tr>
    </tfoot>
  );
}

export const Table = Object.assign(TableRoot, {
  Head,
  Th,
  Body,
  Row,
  Td,
  SelectAll,
  Select,
  ActionsTh,
  Actions,
  Group,
  Empty,
  Foot,
});
