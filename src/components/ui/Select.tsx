import {
  Children,
  Fragment,
  isValidElement,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { DropdownSelect, type DropdownOption } from "./Dropdown";

/**
 * Select — the app's select field, drawn with DropdownSelect (no native
 * <select> popup). It keeps the native API so call sites read like a
 * <select>: <option>/<optgroup> children, a string `value`, and
 * `onChange(e)` with `e.target.value`.
 *
 *   <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
 *     <option value="CHF">CHF</option>
 *     <option value="EUR">EUR</option>
 *   </Select>
 *
 * Need icons, descriptions, multi-select or create-from-search? Use
 * DropdownSelect directly with an `options` array.
 */
export interface SelectProps {
  value?: string | number | null;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  children?: ReactNode;
  fullWidth?: boolean;
  className?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  title?: string;
  placeholder?: string;
  /** bare: no fill, for table cells */
  variant?: "default" | "bare";
  /** Muted label inside the trigger, before the value ("Status:"). */
  prefix?: string;
  searchable?: boolean;
  align?: "start" | "end";
  defaultOpen?: boolean;
  autoFocus?: boolean;
  onBlur?: () => void;
  onFocus?: () => void;
  "aria-label"?: string;
  "aria-required"?: boolean | "true" | "false";
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
  "data-testid"?: string;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

/** Reads <option> / <optgroup> children (fragments and arrays included) into options. */
export function optionsFromChildren(children: ReactNode, group?: string, out: DropdownOption[] = []) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const p = child.props as { children?: ReactNode; value?: string | number; label?: string; disabled?: boolean };
    if (child.type === Fragment) optionsFromChildren(p.children, group, out);
    else if (child.type === "optgroup") optionsFromChildren(p.children, p.label, out);
    else if (child.type === "option") {
      const label = textOf(p.children);
      out.push({ value: String(p.value ?? label), label, disabled: p.disabled, group });
    }
  });
  return out;
}

export function Select({ value, onChange, children, name, placeholder, ...rest }: SelectProps) {
  const options = optionsFromChildren(children);
  const current = value == null ? "" : String(value);
  // Like a native select: an unmatched value shows the first option.
  const matched = options.some((o) => o.value === current);
  return (
    <DropdownSelect
      {...rest}
      options={options}
      value={matched ? current : (options[0]?.value ?? "")}
      placeholder={placeholder}
      onChange={(v) => {
        const target = { value: v, name: name ?? "" };
        onChange?.({ target, currentTarget: target } as unknown as ChangeEvent<HTMLSelectElement>);
      }}
    />
  );
}
