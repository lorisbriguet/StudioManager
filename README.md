<p align="center">
  <img src="assets/icon.png" alt="StudioManager" width="128" height="128">
</p>

<h1 align="center">StudioManager</h1>

<p align="center">
  A lightweight desktop app for freelance designers and creatives to manage clients, projects, invoices, and finances — all in one place.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.9.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/platform-macOS-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

---

## What is StudioManager?

StudioManager is a native desktop application built for freelancers who need a single tool to replace scattered spreadsheets, Notion databases, and invoicing apps. It's fast, works offline, and keeps all your data local.

Built with **Tauri v2** (Rust backend) and **React** (TypeScript frontend), it delivers a native experience with a modern UI — no Electron bloat, no cloud dependency.

### Who is it for?

- Freelance graphic designers, illustrators, photographers
- Solo creatives managing their own clients and billing
- Anyone who wants invoicing, project tracking, and finance overview in one app

---

## Features

### Client Management
- Full client database with contacts, addresses, language preferences
- Multiple billing addresses per client (e.g., different offices)
- Per-client discount settings (e.g., cultural organizations at 10%)
- Quick navigation from client to their projects, invoices, and quotes

### Project & Task Tracking
- Modular project pages with drag-and-drop block layout (Tasks, Workload, Notes, Tables, Invoices, Quotes)
- Hierarchical tasks and subtasks with inline editing
- Due dates, priorities, drag-and-drop reordering
- Side peek panel for quick project overview without leaving the page
- Weighted progress calculation (tasks + subtasks)
- Task filters: todo, done, all — applied globally
- Workload tracker with custom columns (text, number, checkbox, select, formula)
- Named tables per project with configurable columns (text, number, checkbox, select, tags, date)
- Time tracking — start/stop timer per task, quick timer picker (Cmd+Shift+T)
- Time entries management in Settings (filter, edit, delete tracked time)

### Calendar
- Monthly and weekly calendar views (FullCalendar)
- Multi-day event spanning across dates
- Tasks and subtasks displayed on their due dates
- One-directional sync with iCloud Calendar (macOS)
- Double-click to create events, click to peek into project details

### Invoicing
- Professional invoice generation with automatic reference numbering
- Swiss QR-bill (QR-Rechnung) on every invoice PDF
- Multi-currency support (CHF, EUR, USD, GBP) with auto exchange rates
- Auto-language switching (French/English) based on client preference
- Automatic discount application for eligible clients
- Status tracking: draft, sent, paid, overdue, cancelled
- Automatic overdue detection on app startup with notifications
- Late payment reminders with numbered reminder PDFs
- Recurring invoice templates (monthly, quarterly, biannual, annual)
- Editable PO number field, VOID overlay for cancelled invoices
- Draft reference deferral — reference generated only on send
- Configurable footer text, bank details, and payment terms in PDF
- Customizable templates — accent color, font, logo position, margins, field visibility, column order
- Live template editor with real-time PDF preview
- Invoice aging dashboard widget (0-30/31-60/61-90/90+ day overdue brackets)

### Quotes
- Quote creation mirroring the invoice workflow
- PDF preview and export with client/supplier name in filename
- Convert accepted quotes to invoices with one click
- Quote-to-project wizard — generate projects with tasks from accepted quotes
- Status tracking: draft, sent, accepted, rejected, expired

### Expense Tracking
- Categorized expenses following Swiss tax declaration structure
- Customizable expense categories (add/edit/delete in Settings)
- Drag-and-drop receipt upload (PDF, PNG, JPG, HEIC)
- Receipt OCR — auto-fills supplier, amount, and date from dropped images
- Supplier autocomplete with smart autofill (category + amount)
- Inline editable paid date
- Receipt preview inline

### Income Tracking
- Non-invoice revenue tracking (side income, grants, refunds, interest)
- Year-grouped collapsible table with receipt attachment
- Feeds into P&L and finance overview

### Resources
- Bookmarked links with free-form tags
- Filter by tag, search by name
- Link resources to projects
- Click to open URLs externally

### Finance & P&L
- Real-time profit & loss overview
- Revenue, operating expenses, social charges breakdown
- Charts and yearly comparison
- Follows Swiss independent worker tax format
- Year-end export: P&L PDF, invoice list, expense list with receipts — ready for your trustee

### Dashboard
- Customizable drag-and-drop grid layout (react-grid-layout)
- 30+ widget types across financial, client, project, calendar, and productivity categories
- KPIs: revenue, outstanding total, profit margin, quote conversion rate, and more
- Charts: revenue by client, revenue by activity, expense breakdown, cash flow forecast
- Lists: recent invoices, overdue tasks, upcoming deadlines, today's schedule
- Utility: quick create buttons, pinned notes, recent activity feed
- Layout persistence with reset to defaults

### Additional Features
- **Tabs** — Cmd+T/W, middle-click to open in new tab, Ctrl+Tab cycling
- **Command Palette** (Cmd+K) — quick search and actions
- **Undo/Redo** (Cmd+Z / Cmd+Shift+Z) — full undo/redo with state restoration
- **Context Menus** — right-click on any list row for contextual actions
- **Test Mode** — sandbox environment to experiment without affecting production data
- **10 Color Themes** — curated full-app palettes (Default, Nord, Rose Pine, Catppuccin, Tokyo Night, Evergreen, Midnight, Sand, Lavender)
- **19 Accent Colors** — customize the app appearance
- **Smooth Animations** — page transitions, card fade-ins, counter animations (with reduce-motion support)
- **Presentation Mode** — demo environment with seeded data for client presentations
- **Batch Operations** — multi-select with bulk actions on all list pages
- **Saved Filters** — save and quick-apply filter configurations per page
- **Client Activity Timeline** — chronological feed of invoices, quotes, and projects
- **Global Custom Lists** — define reusable option lists in Settings, import/link in Named Table and Workload column editors
- **Duplicate Expense Warning** — detects similar entries on save
- **Resource Duplication Warning** — warns when adding a URL that already exists
- **macOS Native Notifications** — OS-level banners for overdue invoices and backups
- **Notifications** — persistent in-app notifications with unread badges
- **Backup System** — automatic and manual backups with configurable paths
- **Multiple Activities** — define a list of activities in your profile, select per invoice/quote
- **Sidebar Keyboard Navigation** — arrow keys to navigate between pages
- **Bilingual UI** — English and French interface
- **Auto-Updater** — check for updates and install from within the app
- **Offline-first** — all data stored locally in SQLite, no internet required

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri v2](https://v2.tauri.app/) (Rust) |
| Frontend | React 19, TypeScript, Vite |
| Styling | Tailwind CSS v4 |
| Database | SQLite (via tauri-plugin-sql) |
| State | Zustand (UI) + TanStack Query (DB) |
| PDF | @react-pdf/renderer + swissqrbill + pdf-lib |
| Calendar | FullCalendar + macOS EventKit |
| Dashboard | react-grid-layout |
| Charts | Recharts |
| OCR | tesseract.js |
| Notifications | tauri-plugin-notification |
| Forms | React Hook Form + Zod |
| Icons | Lucide React |

---

## Download

### macOS (Apple Silicon)

Download the latest `.dmg` from the [Releases](../../releases) page.

### Requirements
- macOS 12.0 (Monterey) or later
- Apple Silicon (M1/M2/M3/M4) or Intel Mac

---

## Installation

1. Download the `.dmg` file from the [Releases](../../releases) page
2. Open the `.dmg` and drag **StudioManager** to your Applications folder
3. On first launch, right-click the app and select "Open" (required for unsigned apps)
4. The app creates its database automatically — you're ready to go

### Data Location

All your data is stored locally at:
```
~/Library/Application Support/ch.studiomanager.app/
```

This includes your database (`studiomanager.db`), invoice PDFs, and expense receipts. This folder persists across app updates.

---

## Screenshots

> Screenshots coming soon.

<!--
<p align="center">
  <img src="assets/screenshot-dashboard.png" alt="Dashboard" width="800">
  <br><em>Dashboard overview</em>
</p>

<p align="center">
  <img src="assets/screenshot-invoices.png" alt="Invoices" width="800">
  <br><em>Invoice management with QR-bill PDF generation</em>
</p>

<p align="center">
  <img src="assets/screenshot-calendar.png" alt="Calendar" width="800">
  <br><em>Calendar with task scheduling</em>
</p>
-->

---

## Building from Source

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) 20+
- [Tauri v2 CLI](https://v2.tauri.app/start/prerequisites/)

### Steps

```bash
# Clone the repository
git clone https://github.com/lorisbriguet/StudioManager.git
cd StudioManager

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

The production build outputs a `.dmg` file in `src-tauri/target/release/bundle/dmg/`.

---

## Project Structure

```
src/                    # React frontend
  components/           # Reusable UI components
    ui/                 # Design system (Button, Badge, Card, Modal, etc.)
    dashboard/          # Dashboard widget components
    invoice/            # Invoice PDF renderer
    quote/              # Quote PDF renderer
    layout/             # MainLayout, Sidebar, TabBar
    workload/           # Workload tracker components
  db/                   # Database layer (queries + React Query hooks)
  hooks/                # Custom React hooks
  i18n/                 # Internationalization (EN/FR)
  lib/                  # Utilities (backup, PDF, calendar, OCR, exchange rates)
  pages/                # Page components (one per route)
  stores/               # Zustand state stores
  types/                # TypeScript type definitions
src-tauri/              # Tauri/Rust backend
  src/                  # Rust source (commands, EventKit bindings, DB switching)
  migrations/           # SQLite schema migrations
  icons/                # App icons (all sizes)
```

---

## Swiss-Specific Features

StudioManager is designed for Swiss freelancers:

- **QR-Rechnung**: Every invoice includes a Swiss QR payment slip with IBAN and structured reference
- **Tax-ready P&L**: Expense categories and profit & loss structure match the Swiss independent worker tax declaration (Form 2)
- **CHF currency**: Default currency with multi-currency support (CHF equivalent tracked for P&L)
- **VAT exempt**: Designed for businesses below the CHF 100,000 threshold (no VAT calculations)
- **Bilingual**: Full French and English support for both the interface and generated documents

---

## Roadmap

- [ ] Windows support
- [ ] Unsaved changes warning on invoice/quote pages
- [ ] Tab navigation arrows (back/forward)

---

## License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  Made in Switzerland by <a href="https://lorisbriguet.ch">Loris Briguet</a>
</p>
