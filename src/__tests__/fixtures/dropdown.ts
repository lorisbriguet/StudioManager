import { fireEvent, screen, within } from "@testing-library/react";

/** Opens a Select / DropdownSelect by its trigger and clicks the option with that name. */
export function pickOption(trigger: HTMLElement, name: string | RegExp) {
  fireEvent.click(trigger);
  const listbox = screen.getByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name }));
}
