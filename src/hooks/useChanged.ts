import { useState } from "react";

/**
 * True during the render in which any of `deps` differs from the last render's (compared
 * like effect deps, with Object.is). Not on mount. Use it to adjust state when a prop
 * changes, during render, instead of copying it in an effect (which renders twice):
 *
 *   const [draft, setDraft] = useState(value);
 *   if (useChanged(value)) setDraft(value);
 *
 * React re-renders the component straight away, before anything is shown.
 * See https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
 */
export function useChanged(...deps: unknown[]): boolean {
  const [prev, setPrev] = useState(deps);
  if (prev.length === deps.length && prev.every((d, i) => Object.is(d, deps[i]))) return false;
  setPrev(deps);
  return true;
}
