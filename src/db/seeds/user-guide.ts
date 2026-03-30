import type Database from "@tauri-apps/plugin-sql";

interface ArticleSeed {
  title: string;
  tags: string[];
  content: string;
}

const articles: ArticleSeed[] = [
  // ── 1. Getting Started ──────────────────────────────────────────
  {
    title: "Getting Started",
    tags: ["guide", "basics"],
    content: `<h2>Welcome to StudioManager</h2>
<p>StudioManager is an all-in-one desktop application designed for freelance designers, illustrators, photographers, and creative professionals. It replaces scattered spreadsheets, Notion databases, and invoicing tools with a single, fast, offline-first workspace. All your data stays on your machine — no cloud dependency, no subscriptions.</p>

<h2>First Steps</h2>
<p>Follow these steps to get started:</p>
<ol>
  <li><strong>Set up your Business Profile</strong> — Go to <strong>Settings &gt; General</strong> and fill in your company name, address, email, phone, and bank details (IBAN). This information appears on every invoice and quote PDF you generate.</li>
  <li><strong>Choose your language</strong> — StudioManager supports English and French. Set your interface language and your default export language (for PDFs) in Settings.</li>
  <li><strong>Pick a theme</strong> — Go to <strong>Settings &gt; Appearance</strong> to choose from 10 color themes and 19 accent colors.</li>
  <li><strong>Create your first client</strong> — Navigate to the <strong>Clients</strong> page and add a client with their name, address, and language preference.</li>
  <li><strong>Create a project</strong> — From the <strong>Projects</strong> page, create a project linked to your client and start adding tasks.</li>
  <li><strong>Send your first invoice</strong> — Go to <strong>Invoices</strong>, create one, add line items, and export the PDF with a Swiss QR-bill.</li>
</ol>

<h2>Navigation</h2>
<p>The <strong>sidebar</strong> on the left gives you access to every section of the app. Sections are grouped logically:</p>
<ul>
  <li><strong>Main:</strong> Dashboard, Clients, Projects, Tasks, Calendar</li>
  <li><strong>Finances:</strong> Invoices, Quotes, Expenses, Income</li>
  <li><strong>Knowledge:</strong> Wiki, Resources</li>
  <li><strong>Time:</strong> Time Overview</li>
</ul>
<p>Use the <strong>Command Palette</strong> (<strong>Cmd+K</strong>) to search for any page, client, project, or invoice instantly. Results are grouped by type.</p>

<h2>Tabs</h2>
<p>StudioManager supports tabbed navigation, just like a web browser:</p>
<ul>
  <li><strong>Cmd+T</strong> — Open a new tab</li>
  <li><strong>Cmd+W</strong> — Close the current tab</li>
  <li><strong>Ctrl+Tab</strong> — Cycle through open tabs</li>
  <li><strong>Middle-click</strong> a sidebar link to open it in a new tab</li>
</ul>
<p>The tab bar also has <strong>back/forward arrows</strong> for navigating your history.</p>

<h2>Undo &amp; Redo</h2>
<p>Most actions can be undone with <strong>Cmd+Z</strong> and redone with <strong>Cmd+Shift+Z</strong>. A toast notification appears confirming the undo. This works for creating, editing, and deleting clients, projects, tasks, invoices, quotes, expenses, and more.</p>

<h2>Data Storage</h2>
<p>All data is stored locally in a SQLite database at:</p>
<p><code>~/Library/Application Support/ch.studiomanager.app/studiomanager.db</code></p>
<p>Receipts and invoice PDFs are stored alongside the database. Use the <strong>Backup</strong> feature in Settings to create regular backups of everything.</p>`,
  },

  // ── 2. Clients & Contacts ────────────────────────────────────────
  {
    title: "Clients & Contacts",
    tags: ["guide", "clients"],
    content: `<h2>Managing Clients</h2>
<p>The <strong>Clients</strong> page is your client database. Each client has a name, address, language preference (French or English), and optional discount settings.</p>

<h2>Creating a Client</h2>
<p>Click <strong>"+ New Client"</strong> to open the form. Fill in:</p>
<ul>
  <li><strong>Client ID</strong> — A short unique identifier (e.g., "SNO" for Studio Noir). This appears in references and cannot be changed later.</li>
  <li><strong>Name</strong> — Full company or person name.</li>
  <li><strong>Address</strong> — Street address, postal code and city.</li>
  <li><strong>Language</strong> — FR or EN. This determines the language used on invoices and quotes generated for this client.</li>
  <li><strong>Discount</strong> — Optional percentage discount (e.g., 10% for cultural organizations). When enabled, all invoices and quotes for this client automatically apply the discount.</li>
</ul>

<h2>Client Detail Page</h2>
<p>Click a client's name to open their detail page. Here you can:</p>
<ul>
  <li>Edit all client information</li>
  <li>Add <strong>contacts</strong> (people within the organization) with name, email, and phone</li>
  <li>Add <strong>billing addresses</strong> (e.g., different offices). When creating an invoice, you can pick which address to use.</li>
  <li>Write internal <strong>notes</strong> about the client</li>
  <li>See the <strong>Activity Timeline</strong> — a chronological feed of all invoices, quotes, and projects linked to this client</li>
</ul>

<h2>Contacts</h2>
<p>Each client can have multiple contacts. When creating an invoice or quote, you can select a specific contact — their name appears as the "Att:" line on the PDF.</p>

<h2>Multiple Billing Addresses</h2>
<p>A client can have several billing addresses. This is useful for large organizations with different offices. When creating an invoice or quote, a dropdown lets you pick which address to use. The selected address appears on the PDF.</p>

<h2>Client Discount</h2>
<p>Enable "Has discount" on a client and set a percentage. Every invoice and quote created for this client will automatically apply the discount to the subtotal. This is commonly used for cultural organizations or long-term partners with negotiated rates.</p>

<h2>Finding Clients</h2>
<p>Use the <strong>search bar</strong> at the top to filter clients by name. You can also use <strong>saved filters</strong> to create reusable filter conditions (e.g., "French-speaking clients" or "Clients with discount").</p>`,
  },

  // ── 3. Projects & Tasks ──────────────────────────────────────────
  {
    title: "Projects & Tasks",
    tags: ["guide", "projects", "tasks"],
    content: `<h2>Projects Overview</h2>
<p>The <strong>Projects</strong> page shows all your projects as cards in a grid. Each card displays the project name, client, progress bar, and priority indicator (a colored dot: red=high, yellow=medium, green=low). Filter by status using the pills at the top: All, Active, Completed, On Hold, Cancelled.</p>

<h2>Creating a Project</h2>
<p>Click <strong>"+ New Project"</strong>, select a client, give it a name, and set the status. You can also set start date, deadline, and notes.</p>

<h2>Project Detail Page</h2>
<p>Click a project to open it. The project page uses a <strong>modular block layout</strong> — you can add, remove, reorder, and resize blocks:</p>
<ul>
  <li><strong>Tasks</strong> — Your task list with subtasks, priorities, due dates, and status</li>
  <li><strong>Workload</strong> — A spreadsheet-like table with custom columns for tracking effort, assets, types</li>
  <li><strong>Notes</strong> — Free-text project notes</li>
  <li><strong>Resources</strong> — Linked bookmarks and references</li>
  <li><strong>Custom Tables</strong> — Named tables with configurable columns (text, number, checkbox, select, tags, date)</li>
  <li><strong>Invoices</strong> — Invoices linked to this project. You can link unassigned invoices from the dropdown.</li>
  <li><strong>Quotes</strong> — Quotes linked to this project. Same linking feature.</li>
  <li><strong>Wiki</strong> — Wiki articles linked to this project</li>
</ul>

<h2>Block Layout</h2>
<p>Blocks can be:</p>
<ul>
  <li><strong>Drag-and-dropped</strong> to reorder (grab the handle on the left)</li>
  <li><strong>Collapsed</strong> to hide content (click the chevron)</li>
  <li><strong>Resized</strong> — toggle between full-width and half-width (click the width icon). Invoices and Quotes default to half-width so they sit side by side.</li>
  <li><strong>Removed</strong> — click the X to remove a block. Add it back from "+ Add block".</li>
</ul>

<h2>Tasks</h2>
<p>Each task has a title, status (todo/in progress/done), priority (low/medium/high), and optional due date. Tasks can have <strong>subtasks</strong> — expand a task to see and add subtasks. Progress is calculated using weighted completion of tasks and subtasks.</p>

<h2>Workload Table</h2>
<p>The workload is a customizable spreadsheet. You can add columns of different types: text, number, checkbox, select (dropdown with options), multi-select, and formula. Columns can be saved as <strong>templates</strong> and reused across projects. The workload also tracks <strong>planned minutes</strong> (from quote conversion) and <strong>tracked minutes</strong> (from the time tracker).</p>

<h2>Side Peek</h2>
<p>In the Projects list, clicking a project card opens a <strong>side peek panel</strong> showing a compact view of the project without leaving the list. The peek takes half the screen width. Click the expand icon to open the full project page.</p>

<h2>Project Folder</h2>
<p>You can link a project to a folder on your computer. Click "Set folder" in the project header to pick a directory. Once set, click "Folder" to open it directly in Finder.</p>

<h2>Time Tracking</h2>
<p>Hover over any task row to see a play button. Click it to start a timer. The sidebar shows a "Recording" indicator. Click stop to log the time. Tracked minutes accumulate on the task and show in the workload table. Starting a timer on a different task automatically stops the current one.</p>`,
  },

  // ── 4. Invoices ──────────────────────────────────────────────────
  {
    title: "Invoices",
    tags: ["guide", "invoices", "finance"],
    content: `<h2>Invoice Overview</h2>
<p>The <strong>Invoices</strong> page lists all your invoices grouped by year. Each row shows the reference, client, date, status, and amount. Click the gear icon on any row to access actions like edit, preview, duplicate, mark as sent, or delete.</p>

<h2>Draft Logic</h2>
<p>When you create a new invoice, it starts as a <strong>draft</strong>. Drafts don't have a real reference number — they show "DRAFT" instead. The actual sequential reference (e.g., F-2026-001) is generated only when you mark the invoice as <strong>"Sent"</strong>. This prevents gaps in your reference numbering from deleted or abandoned drafts.</p>

<h2>Creating an Invoice</h2>
<p>Click <strong>"+ New Invoice"</strong> to open the form:</p>
<ul>
  <li>Select a <strong>client</strong> — the contact, billing address, and discount are auto-populated</li>
  <li>Choose a <strong>project</strong> (optional) — links the invoice to a specific project</li>
  <li>Set the <strong>date</strong>, <strong>activity</strong> (from your profile activities), and <strong>assignment description</strong></li>
  <li>Add <strong>line items</strong> — each has a designation, rate, unit (hours/days/units/flat rate), quantity, and amount</li>
  <li>Optionally use <strong>Global Rate</strong> — check the box to apply the same rate and unit to all items. The rate/unit columns hide and a label shows "All items at X CHF/h"</li>
  <li>Set the <strong>currency</strong> — CHF, EUR, USD, or GBP. Exchange rates are fetched automatically for P&amp;L calculation.</li>
</ul>

<h2>Invoice Statuses</h2>
<ul>
  <li><strong>Draft</strong> — Not yet sent. No reference number assigned.</li>
  <li><strong>Sent</strong> — Marked as sent. Reference number generated. Clock starts on payment terms.</li>
  <li><strong>Paid</strong> — Payment received. Paid date recorded.</li>
  <li><strong>Overdue</strong> — Automatically detected on app startup when a sent invoice exceeds the payment terms. A notification is created.</li>
  <li><strong>Cancelled</strong> — Voided. The PDF shows a "VOID" overlay.</li>
</ul>

<h2>Invoice PDF</h2>
<p>Each invoice generates a professional PDF with:</p>
<ul>
  <li>Your business details (from Settings &gt; Profile)</li>
  <li>Client billing address and contact ("Att:" line)</li>
  <li>Line items table with optional rate, unit, and quantity columns</li>
  <li>Discount (if applicable), subtotal, and total</li>
  <li>Notes field, project name, PO number (all optional)</li>
  <li>Payment terms ("Net X days")</li>
  <li>Bank details (IBAN, bank name, BIC)</li>
  <li>Swiss <strong>QR-bill</strong> (QR-Rechnung) at the bottom — scannable by any Swiss bank for instant payment</li>
  <li>Page numbers (when multi-page)</li>
  <li>Configurable footer text</li>
</ul>

<h2>Late Payment Reminders</h2>
<p>For overdue invoices, right-click and select "Generate reminder". This increments the reminder count and adds a "REMINDER No. X" banner to the PDF.</p>

<h2>Recurring Invoices</h2>
<p>You can create recurring invoice templates. Click the "Recurring" button in the header to manage templates. Set a frequency (monthly, quarterly, biannual, annual) and a base invoice. The app auto-generates draft invoices on startup when they're due.</p>

<h2>Converting Quotes</h2>
<p>When a quote is accepted, you can convert it to an invoice. From the quote preview, click "Convert to invoice" — all line items, client info, and activity are pre-filled into a new invoice.</p>

<h2>Unsaved Changes</h2>
<p>If you navigate away from the invoice form with unsaved changes, a confirmation dialog will ask if you want to leave. This prevents accidental data loss.</p>`,
  },

  // ── 5. Quotes ────────────────────────────────────────────────────
  {
    title: "Quotes",
    tags: ["guide", "quotes", "finance"],
    content: `<h2>Quote Overview</h2>
<p>Quotes work similarly to invoices but for proposals and estimates. The <strong>Quotes</strong> page lists all quotes with reference, client, date, status, and total amount.</p>

<h2>Draft Logic</h2>
<p>Like invoices, quotes start as <strong>drafts</strong> with a placeholder reference. The real reference (e.g., D-2026-001) is generated when you mark the quote as "Sent".</p>

<h2>Quote Statuses</h2>
<ul>
  <li><strong>Draft</strong> — Being prepared. No reference number yet.</li>
  <li><strong>Sent</strong> — Sent to the client. Reference assigned.</li>
  <li><strong>Accepted</strong> — Client accepted the quote.</li>
  <li><strong>Rejected</strong> — Client declined.</li>
  <li><strong>Expired</strong> — Past the validity period.</li>
</ul>

<h2>Quote PDF</h2>
<p>Quote PDFs include all the same elements as invoices (business info, client address, line items, notes) except bank details and QR-bill, since no payment is expected yet. They include a "Valid until" date and validity terms.</p>

<h2>Generate Project from Quote</h2>
<p>When a quote is accepted, you can generate a project directly from it using the <strong>Quote-to-Project Wizard</strong>:</p>
<ol>
  <li>Click "Generate project" on the quote preview page</li>
  <li><strong>Step 1:</strong> Review quote line items — check which ones should become tasks</li>
  <li><strong>Step 2:</strong> Set project details — name, deadline</li>
  <li><strong>Step 3:</strong> Confirm and create</li>
</ol>
<p>The wizard creates a project linked to the same client, with tasks matching the checked line items. Planned minutes are calculated from the quote amounts. The quote records the <code>converted_to_project_id</code> and shows a green project icon in the quotes list.</p>

<h2>Global Rate</h2>
<p>Like invoices, quotes support a global rate with unit selector. When active, all line items share the same rate and unit, and the PDF shows a summary line instead of per-item rate columns.</p>`,
  },

  // ── 6. Expenses & Income ─────────────────────────────────────────
  {
    title: "Expenses & Income",
    tags: ["guide", "expenses", "income", "finance"],
    content: `<h2>Expenses</h2>
<p>The <strong>Expenses</strong> page tracks all your business expenses. Expenses are grouped by year with collapsible sections showing the yearly total.</p>

<h2>Adding an Expense</h2>
<p>Click <strong>"+ New Expense"</strong> to open the form:</p>
<ul>
  <li><strong>Supplier</strong> — Start typing and autocomplete suggests previous suppliers. Selecting one auto-fills the category and typical amount.</li>
  <li><strong>Category</strong> — Choose from predefined categories following Swiss tax structure (Software, Office, Travel, Equipment, etc.). Categories can be customized in <strong>Settings &gt; Categories</strong> with custom colors.</li>
  <li><strong>Date</strong> — Invoice/receipt date.</li>
  <li><strong>Amount</strong> — Total amount in CHF.</li>
  <li><strong>Receipt</strong> — Attach a receipt (PDF, PNG, JPG, HEIC). You can also <strong>drag and drop</strong> a receipt file onto the expenses page to create a new expense.</li>
</ul>

<h2>Receipt OCR</h2>
<p>When you drop an image file (JPG, PNG, HEIC) onto the expenses page, StudioManager uses <strong>OCR</strong> (optical character recognition via tesseract.js) to automatically extract the supplier name, amount, and date from the receipt. The extracted data pre-fills the expense form.</p>

<h2>Duplicate Detection</h2>
<p>When adding an expense, if a similar entry exists (same supplier + similar amount + close date), a <strong>yellow warning banner</strong> appears. You can still save it if it's intentional.</p>

<h2>Paid Date</h2>
<p>Track when expenses were actually paid. Use the gear icon context menu on each row to "Mark as paid today", "Mark as unpaid", or "Edit paid date".</p>

<h2>Expense Categories</h2>
<p>Default categories follow the Swiss independent worker tax declaration structure: Software (AM), Equipment (FA), Office Supplies (FD), Travel (FR), Rent (LO), and Social Charges (CS). You can add, edit, and delete custom categories in <strong>Settings &gt; Categories</strong>. Each category can have a custom color for visual identification. Default categories cannot be deleted.</p>

<h2>Income</h2>
<p>The <strong>Income</strong> page tracks non-invoice revenue: side income, grants, refunds, interest. It works the same way as expenses with year grouping, receipt attachment, and drag-and-drop. Income entries feed into the P&amp;L overview.</p>

<h2>Batch Operations</h2>
<p>Both expenses and income support <strong>batch operations</strong>. Check multiple rows using the checkboxes, then use the action bar at the bottom to delete them in bulk.</p>`,
  },

  // ── 7. Calendar ──────────────────────────────────────────────────
  {
    title: "Calendar",
    tags: ["guide", "calendar"],
    content: `<h2>Calendar Overview</h2>
<p>The <strong>Calendar</strong> page shows all your tasks, deadlines, and financial events in a visual timeline. Switch between <strong>Month</strong> and <strong>Week</strong> views using the buttons in the top-right corner. Use the arrow buttons to navigate between periods.</p>

<h2>What Appears on the Calendar</h2>
<ul>
  <li><strong>Tasks with due dates</strong> — Shown as colored chips. Colors are determined by the workload tag system (see below).</li>
  <li><strong>Subtasks with due dates</strong> — Also shown, with a subtle "↳" prefix.</li>
  <li><strong>Deadlines</strong> — Project deadlines appear in red.</li>
  <li><strong>Invoice due dates</strong> — Sent or overdue invoices show their payment deadline (invoice date + payment terms). Red for overdue, yellow for sent.</li>
  <li><strong>Quote expiry dates</strong> — Sent quotes with a "valid until" date appear in yellow.</li>
</ul>

<h2>Event Colors</h2>
<p>Task event colors are based on the project's <strong>workload tag column</strong>. In your project's workload table, you can designate a select/tag column as the "Calendar color" source (toggle it in the column editor). The value in that column determines the event's color using the 9-color tag palette. If no tag is set, events use the accent color.</p>
<p>You can configure this per project. Go to <strong>Settings &gt; Calendar</strong> for more information.</p>

<h2>Today Indicator</h2>
<p>Today's date is highlighted with an accent-colored column tint and accent text on the day header. This makes it easy to spot the current day in both month and week views.</p>

<h2>Creating Events</h2>
<p>Double-click on a day (month view) or a time slot (week view) to open the quick-create popup. You can:</p>
<ul>
  <li>Select a project</li>
  <li>Create a new task or subtask with a due date on that day</li>
  <li>Set a time range (in week view)</li>
</ul>

<h2>Moving Events</h2>
<p>Drag and drop events to reschedule them. The task's due date updates automatically. You can also resize events in week view to change their duration.</p>

<h2>iCloud Calendar Sync</h2>
<p>StudioManager can sync tasks to your iCloud Calendar (one-directional push). Enable this in <strong>Settings &gt; Calendar</strong> and select which calendar to use. Changes in StudioManager push to iCloud, but changes in iCloud don't sync back.</p>`,
  },

  // ── 8. Dashboard & Widgets ───────────────────────────────────────
  {
    title: "Dashboard & Widgets",
    tags: ["guide", "dashboard"],
    content: `<h2>Dashboard Overview</h2>
<p>The <strong>Dashboard</strong> is your home screen — a customizable grid of widgets showing key metrics, charts, and quick actions. Widgets can be dragged, resized, added, and removed.</p>

<h2>Widget Types</h2>
<p>StudioManager includes 30+ widget types across several categories:</p>

<h3>Financial</h3>
<ul>
  <li><strong>Revenue (YTD)</strong> — Total revenue year-to-date with year-over-year comparison</li>
  <li><strong>Outstanding Total</strong> — Total unpaid invoices</li>
  <li><strong>Profit Margin</strong> — Revenue minus expenses as a percentage</li>
  <li><strong>Cash Flow</strong> — Revenue vs expenses chart</li>
  <li><strong>Revenue by Client</strong> — Pie chart of revenue distribution</li>
  <li><strong>Expense Breakdown</strong> — Pie chart of expenses by category</li>
</ul>

<h3>Client & Project</h3>
<ul>
  <li><strong>Active Projects</strong> — List with progress bars</li>
  <li><strong>Overdue Tasks</strong> — Tasks past their due date</li>
  <li><strong>Upcoming Deadlines</strong> — Tasks and projects due soon</li>
  <li><strong>Recent Invoices</strong> — Latest invoices with color-coded status dots</li>
  <li><strong>Quote Conversion Rate</strong> — Percentage of accepted quotes</li>
</ul>

<h3>Productivity</h3>
<ul>
  <li><strong>Time This Week</strong> — Bar chart of daily tracked hours</li>
  <li><strong>Planned vs Actual</strong> — Comparison per project</li>
  <li><strong>Top Time Consumers</strong> — Tasks with the most tracked time</li>
  <li><strong>Weekly Trend</strong> — Hours per week over the last 8 weeks</li>
  <li><strong>Project Time Distribution</strong> — Pie chart of time across projects</li>
</ul>

<h3>Utility</h3>
<ul>
  <li><strong>Quick Create</strong> — Buttons to create invoices, quotes, expenses, etc.</li>
  <li><strong>Pinned Notes</strong> — A quick notepad</li>
  <li><strong>Today's Schedule</strong> — Calendar events for today</li>
</ul>

<h2>Customizing the Dashboard</h2>
<p>Click the <strong>"+"</strong> button to browse and add widgets. Drag widgets to reorder them. Grab a widget's edge to resize it. Remove a widget by clicking its X button.</p>

<h2>Dashboard Presets</h2>
<p>StudioManager includes <strong>4 built-in presets</strong>:</p>
<ul>
  <li><strong>Financial</strong> — Revenue, expenses, outstanding, cash flow</li>
  <li><strong>Project Manager</strong> — Active projects, overdue tasks, time tracking</li>
  <li><strong>Time Tracker</strong> — Time-focused widgets</li>
  <li><strong>Minimal</strong> — Just the key KPIs</li>
</ul>
<p>You can also <strong>save your own presets</strong>. Customize the dashboard, then click the preset dropdown and select "Save current layout..." to name and save it. Switch between presets anytime.</p>`,
  },

  // ── 9. Resources & Wiki ──────────────────────────────────────────
  {
    title: "Resources & Wiki",
    tags: ["guide", "resources", "wiki"],
    content: `<h2>Resources</h2>
<p>The <strong>Resources</strong> page is a bookmark manager for links, tools, and references you use in your work. Each resource has a name, URL, price (free/paid), and tags.</p>

<h2>Adding Resources</h2>
<p>Click <strong>"+ New Resource"</strong> to add a bookmark. Fill in the name, URL, price, and tags. Tags are free-text — type and press Enter. Existing tags are suggested as you type.</p>

<h2>Tags</h2>
<p>Tags use a <strong>9-color palette</strong> (blue, purple, green, red, yellow, cyan, orange, teal, gray). Colors are assigned automatically based on the tag name — the same tag always gets the same color. Click a tag pill in the header to filter resources by that tag.</p>

<h2>Editing &amp; Deleting</h2>
<p>Click a resource row to enter edit mode. Changes auto-save when you click away. Right-click for the context menu to delete.</p>

<h2>Wiki</h2>
<p>The <strong>Wiki</strong> page is a built-in knowledge base for writing articles, documentation, processes, and notes. Articles are organized into folders and can be tagged and linked to projects.</p>

<h2>Wiki Structure</h2>
<ul>
  <li><strong>Folders</strong> — Create folders in the left sidebar to organize articles. Click "+" to create, double-click to rename, right-click to delete.</li>
  <li><strong>All Articles</strong> — Click "All" at the top of the sidebar to see every article regardless of folder.</li>
  <li><strong>Tags</strong> — Articles can have colored tags (same system as resources). Filter by tag using the pills in the header.</li>
  <li><strong>Project Link</strong> — Optionally link an article to a project. Linked articles appear in the project's Wiki block.</li>
</ul>

<h2>Writing Articles</h2>
<p>The wiki editor supports rich text formatting with <strong>slash commands</strong>. Type <strong>/</strong> to see available commands:</p>
<ul>
  <li><strong>/h1, /h2, /h3</strong> — Insert headings</li>
  <li><strong>/list</strong> — Insert a bullet list</li>
  <li><strong>/divider</strong> — Insert a horizontal rule</li>
  <li><strong>/link</strong> — Insert a link. Type a URL for an external link, or search for a wiki article to create an internal link.</li>
</ul>
<p>You can also use keyboard shortcuts: <strong>Cmd+B</strong> for bold and <strong>Cmd+I</strong> for italic.</p>

<h2>Auto-Save</h2>
<p>Articles auto-save 2 seconds after your last edit. If you navigate away, any pending changes are saved immediately.</p>

<h2>Deleting Articles</h2>
<p>Click the trash icon in the article editor, or right-click an article in the list. Deleted articles can be restored with <strong>Cmd+Z</strong> (undo).</p>`,
  },

  // ── 10. Finance & P&L ────────────────────────────────────────────
  {
    title: "Finance & P&L",
    tags: ["guide", "finance"],
    content: `<h2>Finance Overview</h2>
<p>The <strong>Finances</strong> page gives you a real-time profit &amp; loss overview following the Swiss independent worker tax declaration structure.</p>

<h2>Revenue</h2>
<p>Revenue is calculated from all <strong>paid invoices</strong> plus <strong>income entries</strong>. Multi-currency invoices are converted to CHF using the exchange rate at the time of creation.</p>

<h2>Expenses</h2>
<p>Expenses are grouped by category (matching Swiss tax form categories). The pie chart shows the distribution. Each category can have a custom color set in Settings.</p>

<h2>Profit &amp; Loss</h2>
<p>The P&amp;L section shows:</p>
<ul>
  <li><strong>Gross Revenue</strong> — Total from invoices + income</li>
  <li><strong>Operating Expenses</strong> — Total expenses by category</li>
  <li><strong>Social Charges</strong> — AVS/AI/APG contributions</li>
  <li><strong>Net Result</strong> — Revenue minus all expenses</li>
</ul>

<h2>Year Comparison</h2>
<p>Select different years to compare performance. Charts update to show the selected year's data.</p>

<h2>Year-End Export</h2>
<p>For your annual tax declaration, you can export:</p>
<ul>
  <li>P&amp;L summary PDF</li>
  <li>Full invoice list</li>
  <li>Full expense list with receipt attachments</li>
</ul>
<p>These documents are formatted for submission to your trustee or tax advisor.</p>`,
  },

  // ── 11. Settings & Customization ─────────────────────────────────
  {
    title: "Settings & Customization",
    tags: ["guide", "settings"],
    content: `<h2>Settings Overview</h2>
<p>Access settings from the <strong>gear icon</strong> at the bottom of the sidebar. Settings are organized into sections.</p>

<h2>General</h2>
<ul>
  <li><strong>Language</strong> — English or French for the interface</li>
  <li><strong>Export Language</strong> — Language used for PDF generation</li>
  <li><strong>Date Format</strong> — dd.MM.yyyy, dd/MM/yyyy, or yyyy-MM-dd</li>
  <li><strong>Reduce Motion</strong> — Disable all animations</li>
</ul>

<h2>Appearance</h2>
<ul>
  <li><strong>Theme</strong> — 10 curated color themes: Default Light, Default Dark (slate), Nord, Rose Pine, Catppuccin Mocha, Sand, Tokyo Night, Evergreen, Midnight Blue, Lavender Mist</li>
  <li><strong>Accent Color</strong> — 19 accent colors from vibrant (Blue, Indigo, Violet) to earthy (Terracotta, Sage, Stone). The accent color affects buttons, links, active states, and highlights throughout the app.</li>
</ul>

<h2>Behavior</h2>
<ul>
  <li><strong>Tasks page visibility</strong> — Show or hide the Tasks page in the sidebar</li>
  <li><strong>Income section</strong> — Show or hide the Income page</li>
  <li><strong>Time overview</strong> — Show or hide the Time Overview page</li>
  <li><strong>Native notifications</strong> — Enable macOS notification banners for overdue invoices and backups</li>
</ul>

<h2>Calendar</h2>
<ul>
  <li><strong>iCloud sync</strong> — Toggle one-directional push to iCloud Calendar</li>
  <li><strong>Calendar name</strong> — Which calendar to sync to</li>
  <li><strong>Event colors</strong> — Colors are configured per project via the Workload column editor</li>
</ul>

<h2>Categories</h2>
<p>Manage expense categories. Add new categories with a code, French name, English name, and P&amp;L section. Each category can have a custom color. Default categories (AM, FA, FD, FR, LO, CS) cannot be deleted.</p>

<h2>Backup</h2>
<ul>
  <li><strong>Backup paths</strong> — Set one or two backup directories</li>
  <li><strong>Max backups</strong> — How many backups to keep before rotating</li>
  <li><strong>Auto-backup interval</strong> — Automatic backups every X minutes (0 = disabled)</li>
  <li><strong>Manual backup</strong> — Create a backup on demand</li>
  <li><strong>Restore</strong> — Restore from a previous backup</li>
</ul>

<h2>Sandbox</h2>
<ul>
  <li><strong>Test Mode</strong> — Create a snapshot of your database and switch to a test copy. Experiment freely, then discard changes and return to your real data.</li>
  <li><strong>Presentation Mode</strong> — Switch to a pre-populated demo database with sample clients, projects, invoices, and more. Perfect for demos or screenshots.</li>
  <li><strong>Snapshot</strong> — Manually snapshot and restore your database at any point.</li>
</ul>

<h2>Updates</h2>
<p>Check for app updates. When a new version is available, download and install it directly from within the app. The app restarts automatically after installation.</p>`,
  },

  // ── 12. Keyboard Shortcuts ───────────────────────────────────────
  {
    title: "Keyboard Shortcuts",
    tags: ["guide", "shortcuts"],
    content: `<h2>Global Shortcuts</h2>
<table>
  <tr><td><strong>Cmd+K</strong></td><td>Open command palette (search anything)</td></tr>
  <tr><td><strong>Cmd+Z</strong></td><td>Undo last action</td></tr>
  <tr><td><strong>Cmd+Shift+Z</strong></td><td>Redo</td></tr>
  <tr><td><strong>Cmd+T</strong></td><td>Open new tab</td></tr>
  <tr><td><strong>Cmd+W</strong></td><td>Close current tab</td></tr>
  <tr><td><strong>Cmd+Shift+T</strong></td><td>Reopen last closed tab</td></tr>
  <tr><td><strong>Ctrl+Tab</strong></td><td>Next tab</td></tr>
  <tr><td><strong>Ctrl+Shift+Tab</strong></td><td>Previous tab</td></tr>
</table>

<h2>Navigation</h2>
<table>
  <tr><td><strong>Arrow keys</strong></td><td>Navigate sidebar items</td></tr>
  <tr><td><strong>Enter / Space</strong></td><td>Open selected sidebar item</td></tr>
  <tr><td><strong>ArrowLeft</strong></td><td>Collapse sub-sidebar</td></tr>
  <tr><td><strong>ArrowRight</strong></td><td>Expand sub-sidebar</td></tr>
</table>

<h2>Wiki Editor</h2>
<table>
  <tr><td><strong>/</strong></td><td>Open slash command menu</td></tr>
  <tr><td><strong>/h1, /h2, /h3</strong></td><td>Insert heading (filterable)</td></tr>
  <tr><td><strong>/list</strong></td><td>Insert bullet list</td></tr>
  <tr><td><strong>/link</strong></td><td>Insert link (URL or wiki article)</td></tr>
  <tr><td><strong>/divider</strong></td><td>Insert horizontal rule</td></tr>
  <tr><td><strong>Cmd+B</strong></td><td>Bold text</td></tr>
  <tr><td><strong>Cmd+I</strong></td><td>Italic text</td></tr>
</table>

<h2>List Pages</h2>
<table>
  <tr><td><strong>Click checkbox</strong></td><td>Select row for batch operations</td></tr>
  <tr><td><strong>Shift+click checkbox</strong></td><td>Select range of rows</td></tr>
  <tr><td><strong>Right-click row</strong></td><td>Open context menu</td></tr>
  <tr><td><strong>Gear icon</strong></td><td>Open context menu (same as right-click)</td></tr>
</table>

<h2>Calendar</h2>
<table>
  <tr><td><strong>Double-click day</strong></td><td>Create new event</td></tr>
  <tr><td><strong>Drag event</strong></td><td>Reschedule</td></tr>
  <tr><td><strong>Click event</strong></td><td>Open project side peek</td></tr>
</table>

<h2>Dashboard</h2>
<table>
  <tr><td><strong>Drag widget</strong></td><td>Reorder</td></tr>
  <tr><td><strong>Drag widget edge</strong></td><td>Resize</td></tr>
</table>`,
  },

  // ── 13. Saved Filters ────────────────────────────────────────────
  {
    title: "Saved Filters",
    tags: ["guide", "filters"],
    content: `<h2>What Are Saved Filters?</h2>
<p>Every list page (Invoices, Quotes, Expenses, Income, Clients, Tasks, Resources) supports <strong>saved filters</strong>. These let you create reusable filter configurations that you can apply with one click.</p>

<h2>Creating a Filter</h2>
<ol>
  <li>Click the <strong>filter icon</strong> next to the search bar</li>
  <li>Add conditions: select a field (e.g., "Status"), an operator (e.g., "equals"), and a value (e.g., "paid")</li>
  <li>Add multiple conditions if needed</li>
  <li>Choose <strong>AND</strong> (all conditions must match) or <strong>OR</strong> (any condition can match) between conditions</li>
  <li>Name your filter and click Save</li>
</ol>

<h2>Applying a Filter</h2>
<p>Saved filters appear as clickable tabs above the table. Click one to apply it. Click "All" to clear all filters. The active filter is highlighted.</p>

<h2>Editing a Filter</h2>
<p>Click an already-active filter tab to open the condition editor. Modify conditions, then save. You can also right-click a filter tab and select "Edit conditions" from the context menu.</p>

<h2>Available Fields</h2>
<p>Each page has different filterable fields:</p>
<ul>
  <li><strong>Invoices:</strong> reference, client name, status (select), total (number)</li>
  <li><strong>Quotes:</strong> reference, client name, status (select), total (number)</li>
  <li><strong>Expenses:</strong> reference, supplier, category (select), amount (number)</li>
  <li><strong>Income:</strong> reference, source, category (select), amount (number)</li>
  <li><strong>Clients:</strong> name, language (select), status (select)</li>
  <li><strong>Tasks:</strong> title, priority (select), status (select)</li>
  <li><strong>Resources:</strong> name, price (select: free/paid), tags (select from existing tags)</li>
</ul>

<h2>Operators</h2>
<ul>
  <li><strong>equals / not equals</strong> — Exact match</li>
  <li><strong>contains</strong> — Partial text match</li>
  <li><strong>greater than / less than</strong> — Numeric comparison</li>
  <li><strong>greater or equal / less or equal</strong> — Numeric comparison</li>
</ul>`,
  },

  // ── 14. Batch Operations ─────────────────────────────────────────
  {
    title: "Batch Operations",
    tags: ["guide", "batch"],
    content: `<h2>What Are Batch Operations?</h2>
<p>All list pages support selecting multiple rows and performing actions on them at once.</p>

<h2>How to Use</h2>
<ol>
  <li>Click the <strong>checkbox</strong> on any row to select it</li>
  <li>Hold <strong>Shift</strong> and click another checkbox to select a range</li>
  <li>Use the <strong>header checkbox</strong> to select/deselect all visible rows</li>
  <li>A <strong>floating action bar</strong> appears at the bottom showing "X selected"</li>
  <li>Click an action in the bar (e.g., Delete, Mark as paid, Mark as sent)</li>
</ol>

<h2>Available Actions</h2>
<ul>
  <li><strong>Invoices:</strong> Mark as paid, Mark as sent, Delete</li>
  <li><strong>Quotes:</strong> Mark as sent, Delete</li>
  <li><strong>Expenses:</strong> Delete</li>
  <li><strong>Income:</strong> Delete</li>
  <li><strong>Clients:</strong> Delete</li>
  <li><strong>Tasks:</strong> Delete</li>
  <li><strong>Resources:</strong> Delete</li>
</ul>

<h2>Safety</h2>
<p>Destructive batch operations (like delete) show a confirmation dialog. Most operations can be undone with <strong>Cmd+Z</strong>.</p>`,
  },

  // ── 15. Context Menus ────────────────────────────────────────────
  {
    title: "Context Menus",
    tags: ["guide", "ui"],
    content: `<h2>How Context Menus Work</h2>
<p>Every list row in StudioManager has a context menu with relevant actions. There are two ways to access it:</p>
<ul>
  <li><strong>Right-click</strong> any row</li>
  <li>Click the <strong>gear icon</strong> (⚙) that appears on hover between the checkbox and the reference column</li>
</ul>

<h2>Typical Actions</h2>
<p>Context menus vary by page but typically include:</p>
<ul>
  <li><strong>Edit</strong> — Open the edit form</li>
  <li><strong>Preview</strong> — Open the PDF preview (invoices, quotes)</li>
  <li><strong>Duplicate</strong> — Create a copy</li>
  <li><strong>Status changes</strong> — Mark as sent, paid, accepted, etc.</li>
  <li><strong>Open in new tab</strong> — Opens the item in a new tab</li>
  <li><strong>Delete</strong> — Remove with confirmation</li>
</ul>

<h2>Expense-Specific Actions</h2>
<ul>
  <li><strong>Mark as paid today</strong> — Sets the paid date to today</li>
  <li><strong>Mark as unpaid</strong> — Clears the paid date</li>
  <li><strong>Edit paid date</strong> — Opens a date picker modal</li>
  <li><strong>Attach receipt</strong> — Attach a receipt file</li>
  <li><strong>View receipt</strong> — Preview an attached receipt</li>
</ul>`,
  },
];

export async function seedUserGuide(db: Database): Promise<void> {
  // Create the "User Guide" folder
  const folderResult = await db.execute(
    "INSERT INTO wiki_folders (name, sort_order) VALUES ($1, 0)",
    ["User Guide"]
  );
  const folderId = folderResult.lastInsertId;

  // Insert each article
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    const articleResult = await db.execute(
      `INSERT INTO wiki_articles (folder_id, title, content, sort_order)
       VALUES ($1, $2, $3, $4)`,
      [folderId, a.title, a.content, i]
    );
    const articleId = articleResult.lastInsertId;

    // Insert tags
    for (const tag of a.tags) {
      await db.execute(
        "INSERT OR IGNORE INTO wiki_article_tags (article_id, tag) VALUES ($1, $2)",
        [articleId, tag]
      );
    }
  }
}
