# StudioManager — Tester Guide

Thanks for trying StudioManager. This page gets you from download to a first invoice in about fifteen minutes, and tells you how to send feedback that helps.

StudioManager is a macOS app for freelance designers: clients, projects and tasks, time tracking, quotes, invoices with Swiss QR-bill, expenses, and a tax-ready profit and loss view. Everything is stored on your Mac. Nothing is sent anywhere.

## 1. Install

1. Download the latest `.dmg` from the [Releases page](https://github.com/lorisbriguet/StudioManager/releases/latest). You need an Apple Silicon Mac (M1 or newer) running macOS 12 or later.
2. Open the `.dmg` and drag **StudioManager** into **Applications**.
3. Get past Gatekeeper. The app is not notarized by Apple, so the first launch is blocked. This happens once.
   - **macOS 15 Sequoia or later**: double-click the app and dismiss the "Apple could not verify" dialog. Open **System Settings → Privacy & Security**, scroll to the bottom, and click **Open Anyway** next to StudioManager. Confirm with your password or Touch ID.
   - **macOS 12 to 14**: right-click the app in Applications, choose **Open**, then **Open** again.
   - **Prefer the Terminal?** Run `xattr -dr com.apple.quarantine /Applications/StudioManager.app` and launch normally.

Updates arrive through the app itself (Settings → Updates), so you will not have to repeat this step.

## 2. First launch: two minutes of setup

The app opens on an empty dashboard. Fill in the essentials so PDFs come out right:

- **Profile → Business Profile**: your name, address and contact details. These print on every invoice and quote.
- **Profile → Bank Details**: IBAN and bank name. The Swiss QR-bill on invoices is generated from this, so a real or realistic IBAN is needed to see it.
- **Profile → Invoice Defaults**: payment terms and your activities (for example "Graphic Design"), with French and English names so documents print in the client's language.
- **Settings → General**: app language (English or French). Invoices and quotes follow each client's language, not the app's.

If macOS asks for **Calendar** or **Notifications** permission, that is the optional iCloud Calendar sync and the overdue-invoice reminders. You can decline both and everything else still works.

## 3. Start with your own data

The app starts empty on purpose: add one client and one project, and the dashboard, calendar and finances fill in as you go. Dates and numbers are yours from the first minute, so what you see is what you will use.

## 4. A fifteen-minute tour

Do this with your own data, in this order. Each step builds on the previous one.

1. **Add a client.** Clients → New. Set the language to French or English and, if it is a cultural organisation, tick the discount. Add a contact.
2. **Create a project.** Projects → New, pick the client, add a deadline. On the project page, add three or four tasks and drag them to reorder. Open one task and add subtasks.
3. **Track some time.** Start the timer on a task, or press Cmd+Shift+T for the quick timer. Stop it after a minute. The task's tracked time updates.
4. **Send a quote.** Quotes → New. Add line items (hours, days, units or a flat amount), or set a global rate and apply it to every line. Preview the PDF, mark it as sent, then as accepted. Right-click the accepted quote and choose **Generate project** to turn it into a project with its line items as tasks.
5. **Invoice it.** Invoices → New, pick the client and project. The activity, language and discount are prefilled from the client. Click **Save & Preview** to see the PDF with the QR-bill. Mark it as sent and note the reference number it receives.
6. **Add an expense from a receipt.** Drop a PDF or image of any receipt onto the Expenses page. The supplier, amount and date are read from the document and prefilled. Pick a category and save.
7. **Check the finances.** Finances shows revenue, expenses by category and the net result in the Swiss tax declaration layout. Switch the year with the selector at the top.
8. **Try the palette.** Press Cmd+K to search anything, and Cmd+N on any list page to create a new item of that kind.
9. **Look at the Wiki.** It ships with a user guide covering every feature in more depth than this page.

## 5. Keyboard shortcuts worth knowing

| Shortcut | Action |
|---|---|
| Cmd+K | Command palette: search clients, projects, invoices, actions |
| Cmd+N | New item on the current page |
| Cmd+Shift+T | Quick timer |
| Cmd+Z / Cmd+Shift+Z | Undo / redo, including deletions |
| Cmd+T / Cmd+W | Open / close a tab |
| Ctrl+Tab | Next tab |
| Cmd+B | Collapse the sidebar |
| Arrow keys | Move between rows in lists, and between sidebar items |

Right-click almost anything, list rows included, for context actions.

## 6. Your data

Everything lives in one folder:

```
~/Library/Application Support/ch.studiomanager.app/
```

It holds `organisations.json` (the list of your organisations) and one `orgs/<id>/` folder per organisation. Each organisation folder has its own database (`studiomanager.db`), generated invoice PDFs (`invoices/`), and expense receipts (`receipts/`). It survives app updates.

- **Backups**: Settings → Backup exports everything (CSV plus files) to a folder of your choice, on a schedule if you want. Each organisation backs up separately — backup folders are named `backup-<organisation id>-<timestamp>`.
- **Start over**: quit the app and delete that folder. The next launch creates a fresh database.
- **Uninstall**: drag the app to the Trash and delete the folder above.

## 7. Sending feedback

Open an issue at [github.com/lorisbriguet/StudioManager/issues](https://github.com/lorisbriguet/StudioManager/issues/new). Small things are welcome too: a confusing label, a step that felt slow, a shortcut you expected.

Please include:

- The app version, shown at the bottom of the Settings sidebar, and your macOS version.
- What you did, what you expected, and what happened instead.
- A screenshot if it is visual. Blur or crop anything you would not want a stranger to read.

Questions of the form "why does it work this way" are just as useful as bugs. Thank you.
