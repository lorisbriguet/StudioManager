import { fireEvent } from "@testing-library/react";

/**
 * Enter in a field of a form, as a browser does it: the keydown, then (unless
 * a handler called preventDefault) the form's implicit submission when it has
 * a submit button, including one outside it linked by `form="…"` (FormModal's
 * footer). happy-dom only fires the keydown.
 */
export function pressEnter(el: HTMLElement) {
  const notCancelled = fireEvent.keyDown(el, { key: "Enter" });
  const form = (el as HTMLInputElement).form ?? el.closest("form");
  if (!notCancelled || !form) return;
  const hasSubmit =
    form.querySelector('[type="submit"]') !== null ||
    (form.id !== "" && document.querySelector(`[type="submit"][form="${CSS.escape(form.id)}"]`) !== null);
  if (hasSubmit) fireEvent.submit(form);
}
