import { getDb } from "../index";
import { seedPersona, type PersonaId } from "../seeds/personas";
import { resetUserGuide } from "../seeds/user-guide";

/** Load a demo persona into the open database (see seedPersona). */
export async function loadPersona(id: PersonaId, opts: { withConfig: boolean }): Promise<void> {
  await seedPersona(await getDb(), id, opts);
}

/** Replace the built-in "User Guide" wiki folder with a fresh copy. */
export async function resetUserGuideArticles(): Promise<void> {
  await resetUserGuide(await getDb());
}
