<p align="center">
  <img src="assets/icon.png" alt="StudioManager" width="128" height="128">
</p>

<h1 align="center">StudioManager</h1>

<p align="center">
  A lightweight desktop app for freelance designers and creatives to manage clients, projects, invoices, and finances — all in one place.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.2.2-blue" alt="Version">
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
- Per-client discount settings (e.g., cultural organizations at 10%)
- Quick navigation from client to their projects, invoices, and quotes

### Project & Task Tracking
- Project boards linked to clients with status tracking
- Hierarchical tasks and subtasks with inline editing
- Due dates, priorities, drag-and-drop reordering
- Side peek panel for quick project overview without leaving the page
- Weighted progress calculation (tasks + subtasks)
- Task filters: todo, done, all — applied globally

### Calendar
- Monthly and weekly calendar views
- Multi-day event spanning across dates
- Tasks and subtasks displayed on their due dates
- One-directional sync with iCloud Calendar (macOS)
- Double-click to create events, click to peek into project details

### Invoicing
- Professional invoice generation with automatic reference numbering
- Swiss QR-bill (QR-Rechnung) on every invoice PDF
- Auto-language switching (French/English) based on client preference
- Automatic discount application for eligible clients
- Status tracking: draft, sent, paid, overdue, cancelled
- Automatic overdue detection on app startup with notifications

### Quotes
- Quote creation mirroring the invoice workflow
- PDF preview and export with client/supplier name in filename
- Convert accepted quotes to invoices with one click
- Status tracking: draft, sent, accepted, rejected, expired

### Expense Tracking
- Categorized expenses following Swiss tax declaration structure
- Drag-and-drop receipt upload (PDF, PNG, JPG)
- Supplier autocomplete with smart autofill (category + amount)
- Inline editable paid date
- Receipt preview inline

### Finance & P&L
- Real-time profit & loss overview
- Revenue, operating expenses, social charges breakdown
- Charts and yearly comparison
- Follows Swiss independent worker tax format
- Year-end export: P&L PDF, invoice list, expense list with receipts — ready for your trustee

### Additional Features
- **Command Palette** (Cmd+K) — quick search and actions
- **Undo System** (Cmd+Z) — undo any action with full state restoration
- **Dark Mode** — full dark theme with automatic color adaptation
- **19 Accent Colors** — customize the app appearance
- **Notifications** — persistent in-app notifications with unread badges and copy-to-clipboard
- **Backup System** — automatic and manual backups with configurable paths and backup notifications
- **Multiple Activities** — define a list of activities in your profile, select per invoice/quote
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
| PDF | @react-pdf/renderer + swissqrbill |
| Calendar | FullCalendar + macOS EventKit |
| Charts | Recharts |
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
  db/                   # Database layer (queries + React Query hooks)
  hooks/                # Custom React hooks
  i18n/                 # Internationalization (EN/FR)
  lib/                  # Utilities (backup, PDF, calendar)
  pages/                # Page components (one per route)
  stores/               # Zustand state stores
  types/                # TypeScript type definitions
src-tauri/              # Tauri/Rust backend
  src/                  # Rust source (commands, EventKit bindings)
  migrations/           # SQLite schema migrations
  icons/                # App icons (all sizes)
```

---

## Swiss-Specific Features

StudioManager is designed for Swiss freelancers:

- **QR-Rechnung**: Every invoice includes a Swiss QR payment slip with IBAN and structured reference
- **Tax-ready P&L**: Expense categories and profit & loss structure match the Swiss independent worker tax declaration (Form 2)
- **CHF currency**: All amounts in Swiss Francs
- **VAT exempt**: Designed for businesses below the CHF 100,000 threshold (no VAT calculations)
- **Bilingual**: Full French and English support for both the interface and generated documents

---

## Roadmap

- [ ] Windows support
- [x] Auto-updater (Tauri updater plugin)
- [ ] Multi-currency support
- [ ] Receipt OCR auto-detection

---

## License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  Made in Switzerland by <a href="https://lorisbriguet.ch">Loris Briguet</a>
</p>
