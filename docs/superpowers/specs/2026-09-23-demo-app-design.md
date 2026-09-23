# Demo App and Persona Seeds — Design

**Date:** 2026-09-23
**Status:** approved in conversation, pending written review
**Builds on:** `2026-09-22-organisations-design.md` (v2.0.0)

## 1. Goal

Give the owner a separately installed **StudioManager Demo** app for live presentations. It has its own data folder, so the real app's data can never be touched, and it shows the 2.0 organisations story natively: two demo organisations, one for a solo graphic designer and one for the same person's music project living on grants, switched live with Cmd+Shift+O and without a "Presentation Mode" banner.

Presentation mode in the real app stays as it is today (single persona, per organisation, ephemeral copy).

## 2. Non-goals

- No global "fake install" presentation mode inside the real app.
- No persona picker in the real app's presentation mode.
- The demo build is never published, signed for the updater, or listed on the landing page.
- No new schema. The music persona uses the existing `income` table and its `grant` category.

## 3. Demo build

### 3.1 Config overlay

`src-tauri/tauri.demo.conf.json` is merged over `tauri.conf.json` by the Tauri CLI (`--config`). It changes only:

| Key | Value |
|---|---|
| `productName` | `StudioManager Demo` |
| `identifier` | `ch.studiomanager.demo` |
| `app.windows[0].title` | `StudioManager Demo` |
| `plugins.updater.endpoints` | `["https://github.com/lorisbriguet/StudioManager/releases/latest/download/demo-latest.json"]` (a manifest that does not exist, so the demo app can never replace itself with the real release) |
| `bundle.createUpdaterArtifacts` | `false` (no `.tar.gz`/`.sig`, no signing key needed) |
| `bundle.targets` | `["app", "dmg"]` |

The identifier drives the data folder: `~/Library/Application Support/ch.studiomanager.demo/`. Both apps can be installed side by side in `/Applications`.

### 3.2 Build script and flag

`package.json` gains `"build:demo": "VITE_DEMO_BUILD=1 tauri build --config src-tauri/tauri.demo.conf.json"`. `beforeBuildCommand` (`npm run build`) inherits the variable, so Vite inlines `import.meta.env.VITE_DEMO_BUILD`.

`src/lib/demoBuild.ts` exposes `isDemoBuild(): boolean` (`import.meta.env.VITE_DEMO_BUILD === "1"`). Nothing else reads the env var directly.

### 3.3 Behaviour differences in the demo build

1. `UpdateChecker` does not run the startup check and its Settings card shows one line, `updates_demo_build` ("Demo build: updates are disabled"), instead of the check button.
2. `useWindowTitle` uses `StudioManager Demo` as the base name (`StudioManager Demo — <organisation>`).
3. Settings › Data gets the **Demo data** card (section 5).

Everything else is identical to the real app, including the organisation upgrade path, presentation and test modes, backups and calendar sync.

## 4. Persona seeds

### 4.1 Layout

```
src/db/seeds/personas/
  index.ts                 registry + loader
  designer/config.sql      business profile + activities of the designer
  designer/data.sql        today's presentation.sql, header updated
  music/config.sql         business profile + activities of the music project
  music/data.sql           the music project's year
```

`src/db/seeds/presentation.sql` moves to `personas/designer/data.sql`. `splitSql.ts` and `user-guide.ts` are unchanged.

### 4.2 Two layers per persona

- **`data.sql`** clears every personal-data table and inserts a year of demo data. It never touches configuration tables (`business_profile`, `expense_categories`, `activities`, `dashboard_presets`, `invoice_templates`, `workload_templates`), exactly like today's seed, so the real app's presentation mode keeps the owner's own settings.
- **`config.sql`** touches only `business_profile` (one `UPDATE … WHERE id = 1`) and `activities` (`DELETE` then `INSERT`). Expense categories, invoice templates, workload templates and dashboard presets already exist in every organisation database from `ensureSchema`, so the config layer leaves them alone.

Both layers use only `PRAGMA`, `DELETE`, `INSERT` and `UPDATE` statements and relative dates (`date('now', …)`), as today.

### 4.3 Registry and loader (`personas/index.ts`)

```ts
export type PersonaId = "designer" | "music";
export interface Persona {
  id: PersonaId;
  labelKey: "persona_designer" | "persona_music";
  prefs: { showIncome: boolean; showTasksPage: boolean };
  config: () => Promise<string>;   // () => import("./designer/config.sql?raw")
  data: () => Promise<string>;
}
export const PERSONAS: Record<PersonaId, Persona>;
export async function seedPersona(db: Database, id: PersonaId, opts: { withConfig: boolean }): Promise<void>;
```

`seedPersona` runs `config.sql` when `withConfig` is true, then `data.sql`, then `seedUserGuide(db)`. Statements are split with `splitSeedStatements` and executed one by one, as `seedPresentationDb` does today. The SQL files are dynamic `?raw` imports so they stay out of the main bundle.

`seedPresentationDb()` in `src/db/index.ts` becomes `seedPersona(await getDb(), "designer", { withConfig: false })`. Its callers do not change.

Persona preferences: designer `{ showIncome: false, showTasksPage: true }`, music `{ showIncome: true, showTasksPage: true }`.

### 4.4 The designer persona

`designer/data.sql` is today's seed, unchanged in content. `designer/config.sql` gives the fictional owner a profile so the demo app's Profile page and invoice PDFs are not blank:

- owner "Lea Morel", studio address in Lausanne, fictional email and phone, fictional IDE and affiliate numbers, a bank name and a syntactically valid but fictional test IBAN, VAT exempt, 30-day payment terms, default activity "Graphisme".
- activities: Graphisme / Graphic design, Direction artistique / Art direction, Web / Web.

### 4.5 The music persona

The same person runs a solo music project, "Aurore", as a second business. The year must read as a real small-project year, and the Income page must carry the story: grants pay for the record, concerts pay a little, expenses are the studio and the road.

- **Profile** (`config.sql`): owner "Lea Morel", trading name "Aurore", same fictional address, a different fictional IBAN, VAT exempt, 30-day terms, default activity "Concert". Activities: Concert / Concert, Composition / Composition, Production / Production, Atelier / Workshop.
- **Clients**: three venues (a club in Lausanne, a festival in Valais, a cultural centre in Fribourg), one label, one music school (workshops), one radio. Contacts and billing addresses filled, languages FR and EN mixed.
- **Projects**: "Album Aurore" (recording, mixing, mastering, release; active), "Tournee printemps" (spring tour; active), "Ateliers ecriture" (songwriting workshops at the school; active), "EP Nuit" (completed last year), "Clip Horizon" (on hold).
- **Tasks and subtasks**: about 40 across the projects with priorities, due dates spread over the last and next three months, some done, a few overdue, a couple planned this week; workload rows and one project table (tour dates: city, venue, fee, status).
- **Invoices**: about 14 over 15 months to venues, the festival, the label (advance) and the school, statuses paid, sent and one overdue; two invoices with a discount for the cultural centre. **Quotes**: four (two accepted, one sent, one declined).
- **Expenses**: about 45: rehearsal room rent monthly, studio days, mastering, instrument repair, strings and cables, travel and hotels on tour, SUISA and insurance, promotion (posters, ads), a laptop. Existing default categories only.
- **Income** (the point of the persona): grants from "Loterie Romande", "Fonds cantonal de la culture", "Ville de Lausanne" and "Fondation Suisa" (category `grant`), royalties from "SUISA" (category `other`), merchandise at concerts (`side_income`), and a refund. Sources named, notes say what each grant was awarded for, dates spread so the Income page and the P&L "other income" line show a curve.
- **Time entries**: rehearsal, composition and admin time on the album and tour projects, about 60 entries over three months.
- **Wiki**: three articles (tech rider, press kit, grant application checklist) in two folders. **Resources**: a few links (booking platform, mastering studio, grant portals) with tags.
- **Recurring invoice template**: one, the school's monthly workshop.

All references follow the generators' formats and are renumbered per year from each row's own date, as the seed test enforces. No real person, private company, IBAN or address appears in either persona; public funding bodies may be named as grant sources.

## 5. Demo data card (demo build only)

`src/components/settings/DemoDataCard.tsx`, rendered in Settings › Data as the category `demo_data` ("Demo data") only when `isDemoBuild()` is true. The category is absent from the real app's Settings list entirely.

Contents:

- Description: "Replaces everything in the current organisation with a fictional year. Create one organisation per persona, for example Atelier and Aurore, then load a persona into each."
- A persona `Select` (designer studio / music project) and a primary button "Load into this organisation".
- Disabled while test or presentation mode is on (with the mode's name in the title attribute), and while a load is running.

On click: native `ask()` confirm ("This replaces all data in <organisation name>. Continue?", warning kind). On yes:

1. `await seedPersona(await getDb(), persona, { withConfig: true })`.
2. `useAppStore.getState().setShowIncome(prefs.showIncome)` and `setShowTasksPage(prefs.showTasksPage)` (these write through to the organisation's registry prefs).
3. `queryClient.clear()` and navigate to `/`.
4. Toast `demo_data_loaded` ("Demo data loaded into <organisation name>"). Errors go through `notifyError(t.operation_failed, e)`.

i18n keys (EN/FR, FR accent-free): `demo_data`, `demo_data_desc`, `demo_data_load`, `demo_data_confirm`, `demo_data_loaded`, `persona_designer`, `persona_music`, `updates_demo_build`.

## 6. The owner's routine before a presentation

1. Open StudioManager Demo. The first launch creates one organisation ("Studio"); rename it "Atelier" in Settings › Data › Organisations and create "Aurore" (empty, not seeded from current).
2. In Atelier: Settings › Data › Demo data › designer studio › Load. In Aurore: music project › Load.
3. Present. Reload both before the next presentation so relative dates stay fresh; deleting the demo app's data folder resets everything.

## 7. Documentation

- `RELEASING.md`: a short "Demo build" section (how to build, that it is never published, where its data lives).
- `README.md` development section: one line for `npm run build:demo`.
- `IDEAS.md`: a V2.1.0 entry.
- `docs/GUIDE.md`: unchanged (the demo app is the owner's tool).

## 8. Testing

- `src/__tests__/presentationSeed.test.ts` becomes a table-driven suite over `PERSONAS`: for each `data.sql` the existing structure, enum, reference and clear-order checks; for each `config.sql`: only `PRAGMA`/`UPDATE`/`DELETE`/`INSERT`, only `business_profile` and `activities`, one `UPDATE business_profile … WHERE id = 1`, at least one activity.
- `personas/index.ts`: `seedPersona` runs config before data only when `withConfig` is true, then the user guide (tauri-sql mock, statement order asserted).
- `demoBuild.ts`: `isDemoBuild()` reflects the env (vitest `vi.stubEnv`).
- `UpdateChecker`: no `check()` call on mount in the demo build; the demo line renders.
- `DemoDataCard`: renders only in the demo build; disabled in test and presentation modes; confirm declined does nothing; confirmed path calls `seedPersona` with `withConfig: true`, applies the persona prefs, clears queries, navigates and toasts.
- `SettingsPage`: the `demo_data` category appears only in the demo build.
- Manual: `npm run build:demo`, install next to the real app, run the routine of section 6, switch between the two organisations, check Income and Finances in Aurore, check the real app's data folder is untouched.

## 9. Risks

- Someone builds the demo config by mistake for a release: the identifier and product name differ, the updater artefacts are absent, and RELEASING.md names the real command. Low.
- A persona seed drifts from the schema: caught by the table-driven seed test, which already guards the designer seed.
- The demo app's first-launch organisation is named "Studio" from the empty profile; the routine renames it. Cosmetic.
