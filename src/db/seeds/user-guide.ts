import type Database from "@tauri-apps/plugin-sql";

interface ArticleSeed {
  title: string;
  tags: string[];
  content: string;
}

const articles: ArticleSeed[] = [
  {
    title: "Getting Started",
    tags: ["guide", "basics"],
    content: `<h2>Welcome to StudioManager</h2>
<p>StudioManager is an all-in-one desktop application built for freelance designers and creative professionals. It replaces scattered tools like spreadsheets, project boards, and invoicing apps with a single, fast, offline-first workspace.</p>

<h2>First Steps</h2>
<ul>
  <li><strong>Set up your profile</strong> — Go to Settings and fill in your Business Profile with your company name, address, and bank details. This information appears on invoices and quotes.</li>
  <li><strong>Add your first client</strong> — Navigate to the Clients page and create a client with their billing information.</li>
  <li><strong>Create a project</strong> — From the Projects page, create a project linked to your client and start adding tasks.</li>
</ul>

<h2>Navigation</h2>
<p>The sidebar on the left gives you access to every section: Dashboard, Projects, Tasks, Calendar, Invoices, Quotes, Expenses, Income, Resources, Wiki, and Settings. Use the command palette (<strong>Cmd+K</strong>) to jump anywhere instantly. Open multiple pages at once using tabs (<strong>Cmd+T</strong> to open, <strong>Cmd+W</strong> to close).</p>

<h2>Key Concepts</h2>
<ul>
  <li>Everything is saved locally in a SQLite database on your machine.</li>
  <li>Dark mode and accent colors are customizable in Settings.</li>
  <li>Undo any action with <strong>Cmd+Z</strong> and redo with <strong>Cmd+Shift+Z</strong>.</li>
</ul>`,
  },
  {
    title: "Clients & Contacts",
    tags: ["guide", "clients"],
    content: `<h2>Managing Clients</h2>
<p>The Clients page lists all your clients with their status, project count, and total invoiced amount. Click any client to view their detail page with linked projects, invoices, and a timeline of interactions.</p>

<h2>Creating a Client</h2>
<ul>
  <li>Click <strong>New Client</strong> and fill in the company or individual name.</li>
  <li>Add one or more <strong>contacts</strong> with name, email, and phone number. Contacts appear in invoice and quote forms.</li>
  <li>Set the client's <strong>language</strong> (EN or FR) so generated documents use the correct language.</li>
</ul>

<h2>Billing Addresses</h2>
<p>Each client can have multiple billing addresses. When creating an invoice or quote, you select which address to use. Add addresses from the client detail page — each address includes a label (e.g., "Main Office"), billing name, and full postal address.</p>

<h2>Client Detail Page</h2>
<p>The client detail view shows a timeline of all activity: projects created, invoices sent, quotes accepted. You can also see financial summaries — total invoiced, total paid, and outstanding balance — at a glance.</p>

<h2>Tips</h2>
<ul>
  <li>Right-click any client row for quick actions like editing or deleting.</li>
  <li>Use the search bar to filter clients by name.</li>
  <li>Client IDs are assigned once and never change, even if you rename the client.</li>
</ul>`,
  },
  {
    title: "Projects & Tasks",
    tags: ["guide", "projects", "tasks"],
    content: `<h2>Project Overview</h2>
<p>Projects are the core of StudioManager. Each project belongs to a client and contains tasks, notes, workload tracking, resources, and linked invoices/quotes. Projects have four statuses: Active, Completed, On Hold, and Cancelled.</p>

<h2>Modular Blocks</h2>
<p>Project pages use a modular block layout. Each block (Tasks, Notes, Workload, Resources, Custom Tables, Invoices, Quotes, Wiki) can be reordered by dragging, collapsed, removed, or toggled between full and half width. Add blocks with the "+" button at the bottom of the page.</p>

<h2>Task Management</h2>
<ul>
  <li>Add tasks from the project page or the global Tasks page.</li>
  <li>Each task has a title, status (todo/done), priority (low/medium/high), and optional due date with time.</li>
  <li>Expand a task to manage <strong>subtasks</strong> — subtasks can be reordered via drag and drop.</li>
  <li>Double-click any task or subtask title to edit it inline.</li>
  <li>Filter tasks by status: Todo, Done, or All.</li>
</ul>

<h2>Workload Tracking</h2>
<p>The Workload block provides a spreadsheet-like grid for tracking assets, hours, and categories per task. Columns are fully customizable — add text, number, checkbox, select, multi-select, or formula columns. Apply workload templates to standardize tracking across projects.</p>

<h2>Progress</h2>
<p>Project progress is calculated automatically using weighted task and subtask completion. The progress bar updates in real time as you check off items.</p>`,
  },
  {
    title: "Invoices",
    tags: ["guide", "invoices", "billing"],
    content: `<h2>Invoice Workflow</h2>
<p>StudioManager supports the full invoice lifecycle: Draft, Sent, Paid, Overdue, and Cancelled. New invoices start as drafts — their reference number is assigned only when you mark them as sent, keeping your numbering sequential.</p>

<h2>Creating an Invoice</h2>
<ul>
  <li>Click <strong>New Invoice</strong> and select a client.</li>
  <li>Choose the billing address and contact from the client's saved information.</li>
  <li>Add line items with description, quantity, unit, and rate. The total calculates automatically.</li>
  <li>Optionally select a currency — exchange rates are fetched automatically for non-CHF invoices.</li>
  <li>Add notes or a custom PO number as needed.</li>
</ul>

<h2>PDF Generation & QR-Bill</h2>
<p>Generate professional PDF invoices with a single click. Swiss invoices include a QR-bill payment slip at the bottom, generated from your QR-IBAN (configured in Settings > Bank Details). PDFs include your business details, configurable footer text, and page numbers.</p>

<h2>Recurring Invoices</h2>
<p>Set up recurring invoice templates with a frequency (monthly, quarterly, yearly). StudioManager automatically generates draft invoices on each cycle when you open the app.</p>

<h2>Late Payment Reminders</h2>
<p>For overdue invoices, right-click and select "Generate reminder." The reminder PDF includes a banner indicating the reminder number. The reminder count is tracked automatically.</p>

<h2>Tips</h2>
<ul>
  <li>Invoices grouped by year — collapse year sections to focus on current work.</li>
  <li>Overdue invoices are detected automatically on startup with a notification.</li>
</ul>`,
  },
  {
    title: "Quotes",
    tags: ["guide", "quotes"],
    content: `<h2>Quote Management</h2>
<p>Quotes follow a similar workflow to invoices: Draft, Sent, Accepted, Rejected, and Expired. Like invoices, reference numbers are assigned only when the quote is sent.</p>

<h2>Creating a Quote</h2>
<ul>
  <li>Click <strong>New Quote</strong> and select a client.</li>
  <li>Add line items describing the scope of work with quantities and rates.</li>
  <li>Set an expiry date to track when the quote becomes invalid.</li>
  <li>Include notes for terms, conditions, or additional context.</li>
</ul>

<h2>Converting to a Project</h2>
<p>When a client accepts a quote, you can convert it directly into a project. The conversion wizard creates a new project linked to the same client, with tasks pre-populated from the quote line items. This ensures your project scope matches what was quoted.</p>

<h2>PDF Export</h2>
<p>Quote PDFs share the same professional layout as invoices — your branding, client details, line items table, and footer. They include a "Quote" label instead of "Invoice" and show the expiry date prominently.</p>

<h2>Tips</h2>
<ul>
  <li>Track accepted vs. rejected quotes to understand your conversion rate.</li>
  <li>Duplicate an existing quote to quickly create similar proposals.</li>
  <li>Link quotes to projects from the project's modular block layout.</li>
</ul>`,
  },
  {
    title: "Expenses & Income",
    tags: ["guide", "expenses", "income"],
    content: `<h2>Expense Tracking</h2>
<p>Log all business expenses from the Expenses page. Each expense has a reference, date, supplier, category, amount, and optional receipt attachment. Expenses feed directly into the Profit & Loss view on the Finances page.</p>

<h2>Categories</h2>
<p>Expenses are organized by category (e.g., Software, Hardware, Travel, Office). Default categories are provided, and you can create custom categories in Settings. Each category can have a color for visual identification. Protected default categories cannot be deleted.</p>

<h2>Receipt OCR</h2>
<p>Attach receipt images (JPG, PNG, HEIC) to expenses. StudioManager uses OCR to extract text from receipts and automatically suggests the supplier, amount, and date — saving you manual data entry.</p>

<h2>Income Entries</h2>
<p>The Income page tracks non-invoice revenue — side income, royalties, or other earnings. Each entry includes a reference, date, description, amount, category, and source. Income entries also support receipt attachments.</p>

<h2>Finances Overview</h2>
<p>The Finances page provides a Profit & Loss statement combining invoice revenue, income entries, and expenses. View yearly or monthly breakdowns to understand your financial health at a glance.</p>

<h2>Tips</h2>
<ul>
  <li>Supplier names autocomplete from previous entries, and autofill the category and typical amount.</li>
  <li>Mark expenses as paid with an inline date picker.</li>
  <li>Expenses are grouped by year with collapsible sections.</li>
</ul>`,
  },
  {
    title: "Calendar",
    tags: ["guide", "calendar"],
    content: `<h2>Calendar Views</h2>
<p>The Calendar page offers two views: <strong>Month</strong> and <strong>Week</strong>. Toggle between them using the buttons in the header. Use the Today button to jump back to the current date, and navigate with the left/right arrows.</p>

<h2>Events & Tasks</h2>
<ul>
  <li><strong>Task due dates</strong> appear automatically on the calendar. Tasks with start and end times show as timed blocks.</li>
  <li><strong>Invoice due dates</strong> show as yellow markers, turning red when overdue.</li>
  <li><strong>Quote expiry dates</strong> also appear on the calendar.</li>
  <li><strong>Project deadlines</strong> display as red markers.</li>
</ul>

<h2>Creating Events</h2>
<p>Double-click any day to create a new task event directly from the calendar. In week view, double-click a time slot to create a timed event. Events are synced to your tasks.</p>

<h2>Event Colors</h2>
<p>Task events can be color-coded based on workload data. Designate a select/tag column in the workload editor as the "calendar color" source. The tag value determines the event color through the consistent tag color system.</p>

<h2>Side Peek</h2>
<p>Click any event to open a side peek panel showing the full event details. Edit the task title, dates, and times directly from the peek panel without leaving the calendar view.</p>

<h2>iCloud Calendar Sync</h2>
<p>StudioManager can push task events to your macOS Calendar app. This is a one-directional sync — changes in StudioManager update Calendar, but not the reverse.</p>`,
  },
  {
    title: "Dashboard & Widgets",
    tags: ["guide", "dashboard"],
    content: `<h2>Customizable Dashboard</h2>
<p>The Dashboard is your home screen — a fully customizable grid of widgets showing the metrics that matter most to you. Drag widgets to reposition them, resize by pulling corners, and add or remove widgets to build your ideal overview.</p>

<h2>Widget Types</h2>
<p>StudioManager includes 30+ widget types across several categories:</p>
<ul>
  <li><strong>Financial KPIs</strong> — Revenue, outstanding balance, profit margin, expense breakdown, monthly comparisons, cash flow trends.</li>
  <li><strong>Project Health</strong> — Active project progress, overdue tasks, upcoming deadlines, project status distribution.</li>
  <li><strong>Productivity</strong> — Time tracked this week, weekly trends, top time consumers, billable vs. non-billable summary.</li>
  <li><strong>Client Insights</strong> — Top clients by revenue, client activity, new vs. returning ratios.</li>
  <li><strong>Utility</strong> — Recent invoices, recent expenses, quick-add shortcuts.</li>
</ul>

<h2>Presets</h2>
<p>Choose from built-in dashboard presets to quickly switch layouts:</p>
<ul>
  <li><strong>Financial</strong> — Revenue-focused with charts and KPIs.</li>
  <li><strong>Project Manager</strong> — Task and project health focused.</li>
  <li><strong>Time Tracker</strong> — Productivity and time distribution.</li>
  <li><strong>Minimal</strong> — Just the essential KPIs and recent invoices.</li>
</ul>
<p>You can also save your current layout as a custom preset with "Save as..." and switch between saved presets from the dropdown.</p>`,
  },
  {
    title: "Resources & Wiki",
    tags: ["guide", "resources", "wiki"],
    content: `<h2>Resources (Bookmarks)</h2>
<p>The Resources page is your curated collection of bookmarks — tools, references, fonts, plugins, and any URLs you use in your work. Each resource has a name, URL, optional price, and tags for organization.</p>
<ul>
  <li>Filter resources by clicking tag pills at the top of the page.</li>
  <li>Link resources to specific projects from the project's Resources block.</li>
  <li>Tags are color-coded automatically — the same tag always gets the same color.</li>
</ul>

<h2>Wiki</h2>
<p>The Wiki is your internal knowledge base. Write and organize articles in folders with a rich text editor.</p>
<ul>
  <li><strong>Folders</strong> — Create folders in the left sidebar to organize articles by topic. Rename folders by double-clicking.</li>
  <li><strong>Articles</strong> — Each article has a title, tags, optional project link, and rich content.</li>
  <li><strong>Editor</strong> — The article editor supports headings, bold/italic text, bullet lists, links, and dividers. Use slash commands (/h1, /h2, /list, /link, /divider) for quick formatting.</li>
  <li><strong>Auto-save</strong> — Content saves automatically on blur or after 2 seconds of inactivity.</li>
  <li><strong>Project Integration</strong> — Link articles to projects and see them in the project's Wiki block.</li>
</ul>

<h2>Tips</h2>
<ul>
  <li>Use the search bar to find articles by title or content.</li>
  <li>Tag articles for cross-cutting topics that span multiple folders.</li>
  <li>The User Guide folder (this one) is seeded on first run as a reference.</li>
</ul>`,
  },
  {
    title: "Settings & Shortcuts",
    tags: ["guide", "settings"],
    content: `<h2>Appearance</h2>
<ul>
  <li><strong>Theme</strong> — Toggle between light and dark mode.</li>
  <li><strong>Accent Color</strong> — Choose from a palette of accent colors that apply across the entire interface.</li>
  <li><strong>Language</strong> — Switch between English and French.</li>
  <li><strong>Date Format</strong> — Choose your preferred date display format.</li>
</ul>

<h2>Business Profile</h2>
<p>Configure your company name, address, contact information, and activities list. These details appear on invoices and quotes. Add multiple activities to choose from when creating documents.</p>

<h2>Bank Details</h2>
<p>Enter your IBAN and QR-IBAN for Swiss QR-bill generation. Set your bank name and account holder. These are used in invoice PDF footers and QR payment slips.</p>

<h2>Backup</h2>
<p>StudioManager auto-backs up your database periodically. You can also trigger manual backups from Settings. A notification confirms each backup with the file path.</p>

<h2>Keyboard Shortcuts</h2>
<ul>
  <li><strong>Cmd+K</strong> — Open command palette (search and navigate anywhere)</li>
  <li><strong>Cmd+Z</strong> — Undo last action</li>
  <li><strong>Cmd+Shift+Z</strong> — Redo</li>
  <li><strong>Cmd+T</strong> — Open new tab</li>
  <li><strong>Cmd+W</strong> — Close current tab</li>
  <li><strong>Cmd+Shift+T</strong> — Reopen last closed tab</li>
  <li><strong>Arrow keys</strong> — Navigate sidebar items</li>
  <li><strong>Enter/Space</strong> — Open selected sidebar item</li>
  <li><strong>Cmd+B</strong> — Bold (in wiki editor)</li>
  <li><strong>Cmd+I</strong> — Italic (in wiki editor)</li>
</ul>

<h2>Other Settings</h2>
<ul>
  <li><strong>Project open mode</strong> — Choose between side peek panel or full page for project details.</li>
  <li><strong>Tasks sidebar</strong> — Toggle the sidebar on the global Tasks page.</li>
  <li><strong>Native notifications</strong> — Enable/disable macOS notification alerts.</li>
  <li><strong>Invoice defaults</strong> — Set default payment terms, footer text, and numbering format.</li>
</ul>`,
  },
];

/**
 * Seeds the wiki with a "User Guide" folder and introductory articles.
 * Should be called only when wiki_folders is empty (first run).
 */
export async function seedUserGuide(db: Database): Promise<void> {
  // Create the User Guide folder
  const folderResult = await db.execute(
    "INSERT INTO wiki_folders (name, sort_order) VALUES ($1, $2)",
    ["User Guide", 0]
  );
  const folderId = folderResult.lastInsertId;
  if (!folderId) return;

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const articleResult = await db.execute(
      "INSERT INTO wiki_articles (folder_id, title, content, sort_order) VALUES ($1, $2, $3, $4)",
      [folderId, article.title, article.content, i]
    );
    const articleId = articleResult.lastInsertId;
    if (articleId) {
      for (const tag of article.tags) {
        await db.execute(
          "INSERT INTO wiki_article_tags (article_id, tag) VALUES ($1, $2)",
          [articleId, tag]
        );
      }
    }
  }
}
