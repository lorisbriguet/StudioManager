/** The element that has focus now, if it is an HTML element (where a dialog or menu returns focus). */
export function focusedElement(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement ? active : null;
}
