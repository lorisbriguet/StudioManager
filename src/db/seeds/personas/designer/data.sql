-- StudioManager demo seed: the "designer" persona (Lea Morel, solo graphic designer).
-- Data layer only: user configuration (business profile, expense categories,
-- activities, dashboard presets, invoice templates, workload templates) is kept;
-- everything client-related is wiped and replaced. The real app's presentation
-- mode runs this file on a copy of the production DB; the demo app runs
-- config.sql first. Every date is relative to today via date('now', ...).
--
-- Validated by src/__tests__/presentationSeed.test.ts — keep them in sync.

-- Disable FK checks during seed to avoid ordering issues
PRAGMA foreign_keys = OFF;

-- ═══════════════════════════════════════════════════
-- CLEAR PERSONAL DATA (children before parents)
-- ═══════════════════════════════════════════════════

DELETE FROM time_entries;
DELETE FROM project_table_rows;
DELETE FROM project_tables;
DELETE FROM workload_rows;
DELETE FROM wiki_article_tags;
DELETE FROM wiki_articles;
DELETE FROM wiki_folders;
DELETE FROM custom_list_items;
DELETE FROM custom_lists;
DELETE FROM resource_projects;
DELETE FROM resource_tags;
DELETE FROM resources;
DELETE FROM recurring_invoice_templates;
DELETE FROM income;
DELETE FROM expenses;
DELETE FROM quote_line_items;
DELETE FROM quotes;
DELETE FROM invoice_line_items;
DELETE FROM invoices;
DELETE FROM subtasks;
DELETE FROM tasks;
DELETE FROM client_contacts;
DELETE FROM client_addresses;
DELETE FROM projects;
DELETE FROM clients;
DELETE FROM notifications;
DELETE FROM saved_filters;

-- Reset autoincrement counters so the explicit ids below stay stable
DELETE FROM sqlite_sequence WHERE name IN (
  'projects', 'tasks', 'subtasks', 'invoices', 'invoice_line_items', 'quotes',
  'quote_line_items', 'expenses', 'income', 'resources', 'resource_tags',
  'recurring_invoice_templates', 'time_entries', 'project_tables',
  'project_table_rows', 'wiki_folders', 'wiki_articles', 'client_contacts',
  'client_addresses', 'notifications', 'saved_filters', 'custom_lists',
  'custom_list_items', 'workload_rows'
);

-- ═══════════════════════════════════════════════════
-- CLIENTS
-- ═══════════════════════════════════════════════════
INSERT INTO clients (id, name, billing_name, address_line1, address_line2, postal_city, email, phone, language, has_discount, discount_rate, notes) VALUES
  ('C-001', 'Atelier Noir', 'Atelier Noir Sàrl', 'Rue du Marché 12', '', '1003 Lausanne', 'hello@ateliernoir.ch', '+41 21 555 01 01', 'FR', 0, 0.00, 'Agence de design. Contact principal : Sophie Duval. Client retainer depuis 2024.'),
  ('C-002', 'Fondation Artvis', 'Fondation Artvis', 'Quai du Mont-Blanc 7', '', '1201 Genève', 'contact@artvis.ch', '+41 22 555 02 02', 'FR', 1, 0.10, 'Fondation culturelle. Rapport annuel + matériel d''exposition. Rabais culturel 10%.'),
  ('C-003', 'PixelFlow', 'PixelFlow GmbH', 'Limmatstrasse 55', '3rd Floor', '8005 Zürich', 'team@pixelflow.io', '+41 44 555 03 03', 'EN', 0, 0.00, 'Tech startup. Fast-paced, iterative. Prefers Slack.'),
  ('C-004', 'Marie Laurent Photography', 'Marie Laurent', 'Chemin des Alpes 3', '', '1820 Montreux', 'marie@laurentphoto.ch', '+41 79 555 04 04', 'FR', 0, 0.00, 'Photographe indépendante. Identité visuelle + site portfolio.'),
  ('C-005', 'Helvetica Studio AG', 'Helvetica Studio AG', 'Bundesplatz 1', '', '3011 Bern', 'projects@helveticastudio.ch', '+41 31 555 05 05', 'EN', 0, 0.00, 'Corporate. Formal process, PO numbers required on every invoice.');
INSERT INTO client_contacts (client_id, first_name, last_name, email, phone, role) VALUES
  ('C-001', 'Sophie', 'Duval', 'sophie@ateliernoir.ch', '+41 79 111 22 33', 'Creative Director'),
  ('C-001', 'Marc', 'Renaud', 'marc@ateliernoir.ch', '+41 79 111 22 34', 'Project Manager'),
  ('C-002', 'Claire', 'Bonvin', 'claire@artvis.ch', '+41 79 222 33 44', 'Directrice'),
  ('C-003', 'Alex', 'Kim', 'alex@pixelflow.io', '+41 79 333 44 55', 'CEO'),
  ('C-003', 'Lea', 'Weber', 'lea@pixelflow.io', '+41 79 333 44 56', 'Product Manager'),
  ('C-004', 'Marie', 'Laurent', 'marie@laurentphoto.ch', '+41 79 555 04 04', 'Owner'),
  ('C-005', 'Thomas', 'Müller', 'thomas@helveticastudio.ch', '+41 79 555 66 77', 'Head of Marketing');
INSERT INTO client_addresses (client_id, label, billing_name, address_line1, address_line2, postal_city) VALUES
  ('C-001', 'Main', 'Atelier Noir Sàrl', 'Rue du Marché 12', '', '1003 Lausanne'),
  ('C-002', 'Foundation', 'Fondation Artvis', 'Quai du Mont-Blanc 7', '', '1201 Genève'),
  ('C-003', 'Office', 'PixelFlow GmbH', 'Limmatstrasse 55', '3rd Floor', '8005 Zürich'),
  ('C-005', 'HQ', 'Helvetica Studio AG', 'Bundesplatz 1', '', '3011 Bern'),
  ('C-005', 'Branch', 'Helvetica Studio AG', 'Bahnhofstrasse 42', '', '8001 Zürich');

-- ═══════════════════════════════════════════════════
-- PROJECTS (block layouts show the modular project page)
-- ═══════════════════════════════════════════════════
INSERT INTO projects (id, client_id, name, status, start_date, deadline, description, notes, layout_config) VALUES
  (1, 'C-001', 'Brand Identity Refresh', 'active', date('now', '-70 days'), date('now', '+45 days'), 'Complete rebrand: logo, colour palette, typography and a 40-page brand book.', 'Weekly check-in with Sophie on Tuesdays.', '[{"type":"tasks"},{"type":"workload"},{"type":"named_tables","width":"half"},{"type":"wiki","width":"half"}]'),
  (2, 'C-002', 'Rapport annuel', 'active', date('now', '-40 days'), date('now', '+75 days'), 'Rapport annuel de la fondation. 48 pages, bilingue FR/DE.', 'Impression chez Imprimerie Centrale, délai 3 semaines.', '[{"type":"tasks"},{"type":"invoices","width":"half"},{"type":"wiki","width":"half"}]'),
  (3, 'C-003', 'E-commerce Redesign', 'completed', date('now', '-240 days'), date('now', '-150 days'), 'Full redesign of the PixelFlow web shop. Shipped on time.', '', NULL),
  (4, 'C-001', 'Packaging — Tea Collection', 'active', date('now', '-30 days'), date('now', '+60 days'), 'Packaging for 6 tea variants on recycled board.', 'Dieline from the printer is in the shared folder.', '[{"type":"tasks"},{"type":"resources"}]'),
  (5, 'C-004', 'Portfolio Website', 'on_hold', date('now', '-20 days'), date('now', '+120 days'), 'Photography portfolio site. On hold until the client delivers the image selection.', '', NULL),
  (6, 'C-005', 'Marketing Collateral Q4', 'active', date('now', '-25 days'), date('now', '+20 days'), 'Brochure, business cards and letterhead refresh.', 'PO number required on every invoice.', '[{"type":"tasks"},{"type":"quotes","width":"half"},{"type":"invoices","width":"half"}]'),
  (7, 'C-003', 'Mobile App UI Kit', 'active', date('now', '-10 days'), date('now', '+100 days'), 'Design system and UI kit for the PixelFlow mobile app.', '', NULL),
  (8, 'C-002', 'Signalétique d''exposition', 'completed', date('now', '-300 days'), date('now', '-210 days'), 'Signalétique et orientation pour l''exposition d''hiver.', '', NULL);

-- ═══════════════════════════════════════════════════
-- TASKS (tracked_minutes = sum of the task's time entries below)
-- ═══════════════════════════════════════════════════
INSERT INTO tasks (id, project_id, title, description, status, priority, due_date, sort_order, planned_minutes, tracked_minutes) VALUES
  (1, 1, 'Research & Moodboard', 'Competitive analysis and visual direction', 'done', 'high', date('now', '-55 days'), 0, 480, 510),
  (2, 1, 'Logo Concepts', 'Three logo directions for the client review', 'done', 'high', date('now', '-40 days'), 1, 720, 680),
  (3, 1, 'Colour Palette', 'Primary and secondary colours, accessibility check', 'done', 'medium', date('now', '-20 days'), 2, 240, 240),
  (4, 1, 'Typography Selection', 'Typefaces for headings and body, licensing', 'todo', 'medium', date('now', '-2 days'), 3, 180, 60),
  (5, 1, 'Brand Guidelines Document', '40-page brand book', 'todo', 'high', date('now', '+40 days'), 4, 960, 0),
  (6, 2, 'Structure du contenu', 'Plan de contenu avec la fondation', 'done', 'high', date('now', '-30 days'), 0, 360, 380),
  (7, 2, 'Couverture', 'Deux propositions de couverture', 'done', 'high', date('now', '-15 days'), 1, 480, 450),
  (8, 2, 'Mise en page intérieure', '48 pages, gabarit bilingue', 'todo', 'high', date('now', '+14 days'), 2, 1440, 720),
  (9, 2, 'Infographies', '8 visualisations de données', 'todo', 'medium', date('now', '+35 days'), 3, 720, 0),
  (10, 2, 'Bon à tirer', 'Contrôle des épreuves avec la cliente', 'todo', 'low', date('now', '+70 days'), 4, 180, 0),
  (11, 3, 'Wireframes', '', 'done', 'high', date('now', '-225 days'), 0, 480, 480),
  (12, 3, 'Visual Design', '', 'done', 'high', date('now', '-200 days'), 1, 960, 900),
  (13, 3, 'Responsive Adaptation', '', 'done', 'medium', date('now', '-175 days'), 2, 360, 340),
  (14, 3, 'Developer Handoff', '', 'done', 'medium', date('now', '-155 days'), 3, 240, 280),
  (15, 4, 'Material Research', 'Recycled board options and printer quotes', 'done', 'medium', date('now', '-15 days'), 0, 240, 200),
  (16, 4, 'Design Concepts', 'Three packaging concepts', 'todo', 'high', date('now', '+5 days'), 1, 600, 320),
  (17, 4, 'Print Files', 'Production-ready files for 6 variants', 'todo', 'high', date('now', '+50 days'), 2, 480, 0),
  (18, 6, 'Business Cards', 'New design with updated branding', 'done', 'medium', date('now', '-12 days'), 0, 180, 160),
  (19, 6, 'Brochure Design', '12-page company brochure', 'todo', 'high', date('now', '+3 days'), 1, 720, 400),
  (20, 6, 'Letterhead & Templates', 'Word and InDesign templates', 'todo', 'low', date('now', '+18 days'), 2, 360, 0),
  (21, 8, 'Conception signalétique', '', 'done', 'high', date('now', '-290 days'), 0, 480, 500),
  (22, 8, 'Système d''orientation', '', 'done', 'medium', date('now', '-270 days'), 1, 360, 340),
  (23, 8, 'Production', '', 'done', 'high', date('now', '-215 days'), 2, 240, 220),
  (24, 5, 'Content Inventory', 'List of galleries and image counts from the client', 'todo', 'medium', date('now', '+90 days'), 0, 120, 0),
  (25, 7, 'Design Tokens', 'Colour, type and spacing tokens', 'todo', 'high', date('now', '+21 days'), 0, 480, 210),
  (26, 7, 'Core Components', 'Buttons, inputs, cards, navigation', 'todo', 'medium', date('now', '+60 days'), 1, 1200, 0);
INSERT INTO subtasks (task_id, title, status, sort_order, due_date) VALUES
  (1, 'Competitor audit', 'done', 0, NULL),
  (1, 'Visual moodboard', 'done', 1, NULL),
  (1, 'Client presentation', 'done', 2, NULL),
  (2, 'Direction A: Geometric', 'done', 0, NULL),
  (2, 'Direction B: Organic', 'done', 1, NULL),
  (2, 'Direction C: Typographic', 'done', 2, NULL),
  (4, 'Shortlist 3 typefaces', 'done', 0, NULL),
  (4, 'Check licensing', 'todo', 1, date('now', '-1 days')),
  (5, 'Logo usage rules', 'todo', 0, date('now', '+20 days')),
  (5, 'Colour specifications', 'todo', 1, date('now', '+25 days')),
  (5, 'Typography guidelines', 'todo', 2, date('now', '+30 days')),
  (5, 'Stationery templates', 'todo', 3, date('now', '+38 days')),
  (8, 'Pages financières', 'done', 0, NULL),
  (8, 'Témoignages', 'todo', 1, date('now', '+8 days')),
  (8, 'Retouche photo', 'todo', 2, date('now', '+12 days')),
  (9, 'Graphique des revenus', 'todo', 0, date('now', '+28 days')),
  (9, 'Statistiques visiteurs', 'todo', 1, date('now', '+30 days')),
  (9, 'Répartition géographique', 'todo', 2, date('now', '+33 days')),
  (16, 'Chamomile variant', 'done', 0, NULL),
  (16, 'Earl Grey variant', 'todo', 1, date('now', '+3 days')),
  (16, 'Green Tea variant', 'todo', 2, date('now', '+5 days')),
  (19, 'Cover design', 'done', 0, NULL),
  (19, 'Interior layout', 'todo', 1, date('now', '+2 days')),
  (19, 'Photo selection', 'todo', 2, date('now', '+3 days')),
  (25, 'Colour tokens', 'todo', 0, date('now', '+10 days')),
  (25, 'Type scale', 'todo', 1, date('now', '+15 days')),
  (25, 'Spacing scale', 'todo', 2, date('now', '+20 days'));

-- ═══════════════════════════════════════════════════
-- TIME ENTRIES (recent work on active projects, older work invoiced)
-- ═══════════════════════════════════════════════════
INSERT INTO time_entries (project_id, task_id, duration_minutes, date, description, invoiced) VALUES
  (1, 1, 240, date('now', '-62 days'), 'Competitor audit', 1),
  (1, 1, 270, date('now', '-58 days'), 'Moodboard + client presentation', 1),
  (1, 2, 360, date('now', '-48 days'), 'Direction A + B', 1),
  (1, 2, 200, date('now', '-45 days'), 'Direction C', 1),
  (1, 2, 120, date('now', '-41 days'), 'Revisions after review', 1),
  (1, 3, 90, date('now', '-24 days'), 'Palette exploration', 0),
  (1, 3, 150, date('now', '-21 days'), 'Contrast checks, swatches', 0),
  (1, 4, 60, date('now', '-4 days'), 'Typeface shortlist', 0),
  (1, NULL, 45, date('now', '-10 days'), 'Client call — brand book scope', 0),
  (2, 6, 180, date('now', '-33 days'), 'Atelier contenu avec Claire', 0),
  (2, 6, 200, date('now', '-31 days'), 'Chemin de fer', 0),
  (2, 7, 240, date('now', '-19 days'), 'Couverture v1', 0),
  (2, 7, 210, date('now', '-16 days'), 'Couverture v2 + choix', 0),
  (2, 8, 180, date('now', '-9 days'), 'Gabarits', 0),
  (2, 8, 240, date('now', '-7 days'), 'Pages 1–12', 0),
  (2, 8, 180, date('now', '-3 days'), 'Pages 13–24', 0),
  (2, 8, 120, date('now', '-1 days'), 'Corrections FR/DE', 0),
  (2, NULL, 60, date('now', '-12 days'), 'Rendez-vous imprimerie', 0),
  (3, 11, 480, date('now', '-230 days'), 'Wireframes', 1),
  (3, 12, 480, date('now', '-210 days'), 'Homepage + PLP', 1),
  (3, 12, 420, date('now', '-205 days'), 'PDP + checkout', 1),
  (3, 13, 340, date('now', '-178 days'), 'Breakpoints', 1),
  (3, 14, 280, date('now', '-157 days'), 'Handoff + Figma cleanup', 1),
  (4, 15, 200, date('now', '-17 days'), 'Board samples, printer quotes', 0),
  (4, 16, 180, date('now', '-6 days'), 'Concept A', 0),
  (4, 16, 140, date('now', '-2 days'), 'Concept B', 0),
  (6, 18, 160, date('now', '-13 days'), 'Business cards', 0),
  (6, 19, 240, date('now', '-8 days'), 'Brochure grid + cover', 0),
  (6, 19, 160, date('now', '-5 days'), 'Spreads 1–4', 0),
  (6, NULL, 90, date('now', '-24 days'), 'Kickoff at Helvetica HQ', 0),
  (7, 25, 120, date('now', '-3 days'), 'Token audit', 0),
  (7, 25, 90, date('now', '-1 days'), 'Colour tokens', 0),
  (8, 21, 500, date('now', '-292 days'), 'Signalétique', 1),
  (8, 22, 340, date('now', '-272 days'), 'Orientation', 1),
  (8, 23, 220, date('now', '-217 days'), 'Suivi de production', 1);

-- ═══════════════════════════════════════════════════
-- INVOICES (12 months of history, VAT exempt, cultural discount for C-002)
-- ═══════════════════════════════════════════════════
INSERT INTO invoices (id, reference, client_id, project_id, status, language, activity, activity_id, assignment, invoice_date, due_date, payment_terms_days, subtotal, discount_applied, discount_rate, discount_label, total, paid_date, notes, po_number, currency, exchange_rate, chf_equivalent, reminder_count, last_reminder_date, from_quote_id) VALUES
  (1, '2026-001', 'C-002', 8, 'paid', 'FR', (SELECT name_fr FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Signalétique d''exposition', date('now', '-11 months'), date('now', '-11 months', '+30 days'), 30, 4200.00, 1, 0.10, 'Rabais culturel', 3780.00, date('now', '-10 months', '-5 days'), '', NULL, 'CHF', 1.00, 3780.00, 0, NULL, NULL),
  (2, '2026-002', 'C-003', 3, 'paid', 'EN', (SELECT name_en FROM activities ORDER BY sort_order DESC LIMIT 1), (SELECT id FROM activities ORDER BY sort_order DESC LIMIT 1), 'E-commerce redesign — Phase 1', date('now', '-10 months'), date('now', '-10 months', '+30 days'), 30, 6240.00, 0, 0.00, NULL, 6240.00, date('now', '-10 months', '+22 days'), '', NULL, 'CHF', 1.00, 6240.00, 0, NULL, NULL),
  (3, '2026-003', 'C-001', NULL, 'paid', 'FR', (SELECT name_fr FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Retainer design mensuel', date('now', '-9 months'), date('now', '-9 months', '+30 days'), 30, 1920.00, 0, 0.00, NULL, 1920.00, date('now', '-9 months', '+18 days'), 'Retainer mensuel — Atelier Noir', NULL, 'CHF', 1.00, 1920.00, 0, NULL, NULL),
  (4, '2026-004', 'C-001', NULL, 'paid', 'FR', (SELECT name_fr FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Retainer design mensuel', date('now', '-8 months'), date('now', '-8 months', '+30 days'), 30, 1920.00, 0, 0.00, NULL, 1920.00, date('now', '-8 months', '+18 days'), 'Retainer mensuel — Atelier Noir', NULL, 'CHF', 1.00, 1920.00, 0, NULL, NULL),
  (5, '2026-005', 'C-001', NULL, 'paid', 'FR', (SELECT name_fr FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Retainer design mensuel', date('now', '-7 months'), date('now', '-7 months', '+30 days'), 30, 1920.00, 0, 0.00, NULL, 1920.00, date('now', '-7 months', '+18 days'), 'Retainer mensuel — Atelier Noir', NULL, 'CHF', 1.00, 1920.00, 0, NULL, NULL),
  (6, '2026-006', 'C-001', NULL, 'paid', 'FR', (SELECT name_fr FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Retainer design mensuel', date('now', '-6 months'), date('now', '-6 months', '+30 days'), 30, 1920.00, 0, 0.00, NULL, 1920.00, date('now', '-6 months', '+18 days'), 'Retainer mensuel — Atelier Noir', NULL, 'CHF', 1.00, 1920.00, 0, NULL, NULL),
  (7, '2026-007', 'C-003', 3, 'paid', 'EN', (SELECT name_en FROM activities ORDER BY sort_order DESC LIMIT 1), (SELECT id FROM activities ORDER BY sort_order DESC LIMIT 1), 'E-commerce redesign — Final', date('now', '-6 months', '+12 days'), date('now', '-6 months', '+42 days'), 30, 4400.00, 0, 0.00, NULL, 4400.00, date('now', '-5 months', '+8 days'), '', NULL, 'CHF', 1.00, 4400.00, 0, NULL, NULL),
  (8, '2026-008', 'C-001', NULL, 'paid', 'FR', (SELECT name_fr FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Retainer design mensuel', date('now', '-5 months'), date('now', '-5 months', '+30 days'), 30, 1920.00, 0, 0.00, NULL, 1920.00, date('now', '-5 months', '+18 days'), 'Retainer mensuel — Atelier Noir', NULL, 'CHF', 1.00, 1920.00, 0, NULL, NULL),
  (9, '2026-009', 'C-005', NULL, 'paid', 'EN', (SELECT name_en FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Marketing collateral — Q1', date('now', '-5 months', '+10 days'), date('now', '-5 months', '+40 days'), 30, 1320.00, 0, 0.00, NULL, 1320.00, date('now', '-5 months', '+35 days'), '', 'PO-4471', 'CHF', 1.00, 1320.00, 0, NULL, NULL),
  (10, '2026-010', 'C-001', NULL, 'paid', 'FR', (SELECT name_fr FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Retainer design mensuel', date('now', '-4 months'), date('now', '-4 months', '+30 days'), 30, 1920.00, 0, 0.00, NULL, 1920.00, date('now', '-4 months', '+18 days'), 'Retainer mensuel — Atelier Noir', NULL, 'CHF', 1.00, 1920.00, 0, NULL, NULL),
  (11, '2026-011', 'C-001', NULL, 'paid', 'FR', (SELECT name_fr FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Retainer design mensuel', date('now', '-3 months'), date('now', '-3 months', '+30 days'), 30, 1920.00, 0, 0.00, NULL, 1920.00, date('now', '-3 months', '+18 days'), 'Retainer mensuel — Atelier Noir', NULL, 'CHF', 1.00, 1920.00, 0, NULL, NULL),
  (12, '2026-012', 'C-001', NULL, 'paid', 'FR', (SELECT name_fr FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Retainer design mensuel', date('now', '-2 months'), date('now', '-2 months', '+30 days'), 30, 1920.00, 0, 0.00, NULL, 1920.00, date('now', '-2 months', '+18 days'), 'Retainer mensuel — Atelier Noir', NULL, 'CHF', 1.00, 1920.00, 0, NULL, NULL),
  (13, '2026-013', 'C-005', 6, 'overdue', 'EN', (SELECT name_en FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Marketing collateral Q4 — Concept phase', date('now', '-45 days'), date('now', '-15 days'), 30, 1080.00, 0, 0.00, NULL, 1080.00, NULL, '', 'PO-4512', 'CHF', 1.00, 1080.00, 1, date('now', '-7 days'), NULL),
  (14, '2026-014', 'C-001', 1, 'paid', 'FR', (SELECT name_fr FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Refonte identité — Phase 1', date('now', '-35 days'), date('now', '-5 days'), 30, 2880.00, 0, 0.00, NULL, 2880.00, date('now', '-8 days'), '', NULL, 'CHF', 1.00, 2880.00, 0, NULL, NULL),
  (15, '2026-015', 'C-001', NULL, 'paid', 'FR', (SELECT name_fr FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Retainer design mensuel', date('now', '-1 months'), date('now', '-1 months', '+30 days'), 30, 1920.00, 0, 0.00, NULL, 1920.00, date('now', '-1 months', '+18 days'), 'Retainer mensuel — Atelier Noir', NULL, 'CHF', 1.00, 1920.00, 0, NULL, NULL),
  (16, '2026-016', 'C-001', 4, 'sent', 'FR', (SELECT name_fr FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Packaging thé — Phase concept', date('now', '-10 days'), date('now', '+20 days'), 30, 1680.00, 0, 0.00, NULL, 1680.00, NULL, '', NULL, 'CHF', 1.00, 1680.00, 0, NULL, NULL),
  (17, 'DRAFT-presentation-annual-report', 'C-002', 2, 'draft', 'FR', (SELECT name_fr FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Rapport annuel — Facturation intermédiaire', date('now', '-2 days'), date('now', '+28 days'), 30, 3360.00, 1, 0.10, 'Rabais culturel', 3024.00, NULL, '', NULL, 'CHF', 1.00, 3024.00, 0, NULL, NULL);
INSERT INTO invoice_line_items (invoice_id, designation, quantity, rate, amount, unit, sort_order) VALUES
  (1, 'Conception signalétique', 20, 120.00, 2400.00, 'hours', 0),
  (1, 'Système d''orientation', 12, 120.00, 1440.00, 'hours', 1),
  (1, 'Suivi de production', 3, 120.00, 360.00, 'hours', 2),
  (2, 'UX wireframes', 16, 130.00, 2080.00, 'hours', 0),
  (2, 'Visual design', 32, 130.00, 4160.00, 'hours', 1),
  (3, 'Forfait design mensuel (16 h)', 16, 120.00, 1920.00, 'hours', 0),
  (4, 'Forfait design mensuel (16 h)', 16, 120.00, 1920.00, 'hours', 0),
  (5, 'Forfait design mensuel (16 h)', 16, 120.00, 1920.00, 'hours', 0),
  (6, 'Forfait design mensuel (16 h)', 16, 120.00, 1920.00, 'hours', 0),
  (7, 'Responsive adaptation', 12, 130.00, 1560.00, 'hours', 0),
  (7, 'Developer handoff', 8, 130.00, 1040.00, 'hours', 1),
  (7, 'Project management', 1, 1800.00, 1800.00, 'flat', 2),
  (8, 'Forfait design mensuel (16 h)', 16, 120.00, 1920.00, 'hours', 0),
  (9, 'Business card design', 3, 120.00, 360.00, 'hours', 0),
  (9, 'Flyer design', 8, 120.00, 960.00, 'hours', 1),
  (10, 'Forfait design mensuel (16 h)', 16, 120.00, 1920.00, 'hours', 0),
  (11, 'Forfait design mensuel (16 h)', 16, 120.00, 1920.00, 'hours', 0),
  (12, 'Forfait design mensuel (16 h)', 16, 120.00, 1920.00, 'hours', 0),
  (13, 'Business card design', 3, 120.00, 360.00, 'hours', 0),
  (13, 'Brochure concept', 6, 120.00, 720.00, 'hours', 1),
  (14, 'Recherche & moodboard', 8, 120.00, 960.00, 'hours', 0),
  (14, 'Concepts de logo (3 directions)', 12, 120.00, 1440.00, 'hours', 1),
  (14, 'Présentations client', 4, 120.00, 480.00, 'hours', 2),
  (15, 'Forfait design mensuel (16 h)', 16, 120.00, 1920.00, 'hours', 0),
  (16, 'Recherche matériaux', 4, 120.00, 480.00, 'hours', 0),
  (16, 'Concepts (3 pistes)', 10, 120.00, 1200.00, 'hours', 1),
  (17, 'Couverture', 8, 120.00, 960.00, 'hours', 0),
  (17, 'Mise en page intérieure (24 pages)', 20, 120.00, 2400.00, 'hours', 1);

-- ═══════════════════════════════════════════════════
-- QUOTES
-- ═══════════════════════════════════════════════════
INSERT INTO quotes (id, reference, client_id, project_id, status, language, activity, activity_id, assignment, quote_date, valid_until, subtotal, discount_applied, discount_rate, total, converted_to_project_id, notes) VALUES
  (1, 'D-2026-001', 'C-005', NULL, 'rejected', 'EN', (SELECT name_en FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Annual calendar', date('now', '-120 days'), date('now', '-90 days'), 4000.00, 0, 0.00, 4000.00, NULL, 'Rejected — budget too tight this year.'),
  (2, 'D-2026-002', 'C-004', 5, 'accepted', 'FR', (SELECT name_fr FROM activities ORDER BY sort_order DESC LIMIT 1), (SELECT id FROM activities ORDER BY sort_order DESC LIMIT 1), 'Site portfolio', date('now', '-60 days'), date('now', '-30 days'), 7000.00, 0, 0.00, 7000.00, 5, ''),
  (3, 'D-2026-003', 'C-002', 2, 'accepted', 'FR', (SELECT name_fr FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Rapport annuel', date('now', '-50 days'), date('now', '-20 days'), 7200.00, 1, 0.10, 6480.00, 2, ''),
  (4, 'D-2026-004', 'C-003', 7, 'sent', 'EN', (SELECT name_en FROM activities ORDER BY sort_order DESC LIMIT 1), (SELECT id FROM activities ORDER BY sort_order DESC LIMIT 1), 'Mobile app UI kit', date('now', '-20 days'), date('now', '+10 days'), 17760.00, 0, 0.00, 17760.00, NULL, ''),
  (5, 'D-2026-005', 'C-001', 1, 'draft', 'FR', (SELECT name_fr FROM activities ORDER BY sort_order LIMIT 1), (SELECT id FROM activities ORDER BY sort_order LIMIT 1), 'Extension charte — templates réseaux sociaux', date('now', '-3 days'), date('now', '+27 days'), 3080.00, 0, 0.00, 3080.00, NULL, '');
INSERT INTO quote_line_items (quote_id, designation, quantity, rate, amount, unit, sort_order) VALUES
  (1, 'Calendar concept', 6, 120.00, 720.00, 'hours', 0),
  (1, 'Monthly illustrations', 12, 200.00, 2400.00, 'units', 1),
  (1, 'Print preparation', 1, 880.00, 880.00, 'flat', 2),
  (2, 'Recherche UX & wireframes', 8, 130.00, 1040.00, 'hours', 0),
  (2, 'Design visuel', 16, 130.00, 2080.00, 'hours', 1),
  (2, 'Développement responsive', 20, 130.00, 2600.00, 'hours', 2),
  (2, 'Migration du contenu', 4, 100.00, 400.00, 'hours', 3),
  (2, 'Tests & mise en ligne', 1, 880.00, 880.00, 'flat', 4),
  (3, 'Couverture', 8, 120.00, 960.00, 'hours', 0),
  (3, 'Mise en page intérieure (48 pages)', 40, 120.00, 4800.00, 'hours', 1),
  (3, 'Infographies', 12, 120.00, 1440.00, 'hours', 2),
  (4, 'Design system foundations', 20, 140.00, 2800.00, 'hours', 0),
  (4, 'Component library', 40, 140.00, 5600.00, 'hours', 1),
  (4, 'Screen designs (20 screens)', 60, 140.00, 8400.00, 'hours', 2),
  (4, 'Documentation', 8, 120.00, 960.00, 'hours', 3),
  (5, 'Templates Instagram', 8, 120.00, 960.00, 'hours', 0),
  (5, 'Templates LinkedIn', 6, 120.00, 720.00, 'hours', 1),
  (5, 'Guidelines animation', 10, 140.00, 1400.00, 'hours', 2);

-- ═══════════════════════════════════════════════════
-- RECURRING INVOICE TEMPLATE (monthly retainer)
-- ═══════════════════════════════════════════════════
INSERT INTO recurring_invoice_templates (base_invoice_id, client_id, frequency, next_due, active) VALUES
  (15, 'C-001', 'monthly', date('now', '+12 days'), 1);

-- ═══════════════════════════════════════════════════
-- EXPENSES (12 months; every Swiss tax category represented)
-- ═══════════════════════════════════════════════════
INSERT INTO expenses (reference, supplier, category_code, invoice_date, due_date, amount, paid_date, notes) VALUES
  ('F-26-001', 'Coworking Lausanne', 'LO', date('now', '-11 months', '+1 days'), date('now', '-11 months', '+1 days'), 450.00, date('now', '-11 months', '+1 days'), 'Poste de travail coworking'),
  ('F-26-002', 'Adobe', 'FA', date('now', '-11 months', '+5 days'), date('now', '-11 months', '+5 days'), 71.99, date('now', '-11 months', '+5 days'), 'Creative Cloud mensuel'),
  ('F-26-003', 'Caisse AVS Valais', 'CS', date('now', '-11 months', '+15 days'), date('now', '-10 months', '+15 days'), 1250.00, date('now', '-10 months', '+10 days'), 'Acompte cotisations AVS/AI/APG'),
  ('F-26-004', 'Swisscom', 'FA', date('now', '-11 months', '+20 days'), date('now', '-10 months', '+20 days'), 89.00, date('now', '-11 months', '+28 days'), 'Mobile + Internet'),
  ('F-26-005', 'Coworking Lausanne', 'LO', date('now', '-10 months', '+1 days'), date('now', '-10 months', '+1 days'), 450.00, date('now', '-10 months', '+1 days'), 'Poste de travail coworking'),
  ('F-26-006', 'Adobe', 'FA', date('now', '-10 months', '+5 days'), date('now', '-10 months', '+5 days'), 71.99, date('now', '-10 months', '+5 days'), 'Creative Cloud mensuel'),
  ('F-26-007', 'CFF', 'FD', date('now', '-10 months', '+8 days'), date('now', '-10 months', '+8 days'), 84.00, date('now', '-10 months', '+8 days'), 'Train Sion–Zürich, réunion PixelFlow'),
  ('F-26-008', 'Restaurant Zeughauskeller', 'FR', date('now', '-10 months', '+8 days'), date('now', '-10 months', '+8 days'), 42.50, date('now', '-10 months', '+8 days'), 'Repas de travail PixelFlow'),
  ('F-26-009', 'Swisscom', 'FA', date('now', '-10 months', '+20 days'), date('now', '-9 months', '+20 days'), 89.00, date('now', '-10 months', '+28 days'), 'Mobile + Internet'),
  ('F-26-010', 'Coworking Lausanne', 'LO', date('now', '-9 months', '+1 days'), date('now', '-9 months', '+1 days'), 450.00, date('now', '-9 months', '+1 days'), 'Poste de travail coworking'),
  ('F-26-011', 'Adobe', 'FA', date('now', '-9 months', '+5 days'), date('now', '-9 months', '+5 days'), 71.99, date('now', '-9 months', '+5 days'), 'Creative Cloud mensuel'),
  ('F-26-012', 'Digitec', 'AM', date('now', '-9 months', '+12 days'), date('now', '-9 months', '+42 days'), 899.00, date('now', '-9 months', '+30 days'), 'Écran 27" 4K'),
  ('F-26-013', 'Swisscom', 'FA', date('now', '-9 months', '+20 days'), date('now', '-8 months', '+20 days'), 89.00, date('now', '-9 months', '+28 days'), 'Mobile + Internet'),
  ('F-26-014', 'Coworking Lausanne', 'LO', date('now', '-8 months', '+1 days'), date('now', '-8 months', '+1 days'), 450.00, date('now', '-8 months', '+1 days'), 'Poste de travail coworking'),
  ('F-26-015', 'Adobe', 'FA', date('now', '-8 months', '+5 days'), date('now', '-8 months', '+5 days'), 71.99, date('now', '-8 months', '+5 days'), 'Creative Cloud mensuel'),
  ('F-26-016', 'Caisse AVS Valais', 'CS', date('now', '-8 months', '+15 days'), date('now', '-7 months', '+15 days'), 1250.00, date('now', '-7 months', '+10 days'), 'Acompte cotisations AVS/AI/APG'),
  ('F-26-017', 'Swisscom', 'FA', date('now', '-8 months', '+20 days'), date('now', '-7 months', '+20 days'), 89.00, date('now', '-8 months', '+28 days'), 'Mobile + Internet'),
  ('F-26-018', 'Coworking Lausanne', 'LO', date('now', '-7 months', '+1 days'), date('now', '-7 months', '+1 days'), 450.00, date('now', '-7 months', '+1 days'), 'Poste de travail coworking'),
  ('F-26-019', 'Papeterie Brachard', 'FA', date('now', '-7 months', '+3 days'), date('now', '-7 months', '+33 days'), 156.80, date('now', '-7 months', '+25 days'), 'Papiers et fournitures'),
  ('F-26-020', 'Adobe', 'FA', date('now', '-7 months', '+5 days'), date('now', '-7 months', '+5 days'), 71.99, date('now', '-7 months', '+5 days'), 'Creative Cloud mensuel'),
  ('F-26-021', 'Swisscom', 'FA', date('now', '-7 months', '+20 days'), date('now', '-6 months', '+20 days'), 89.00, date('now', '-7 months', '+28 days'), 'Mobile + Internet'),
  ('F-26-022', 'Coworking Lausanne', 'LO', date('now', '-6 months', '+1 days'), date('now', '-6 months', '+1 days'), 450.00, date('now', '-6 months', '+1 days'), 'Poste de travail coworking'),
  ('F-26-023', 'Adobe', 'FA', date('now', '-6 months', '+5 days'), date('now', '-6 months', '+5 days'), 71.99, date('now', '-6 months', '+5 days'), 'Creative Cloud mensuel'),
  ('F-26-024', 'CFF', 'FD', date('now', '-6 months', '+18 days'), date('now', '-6 months', '+18 days'), 62.00, date('now', '-6 months', '+18 days'), 'Train Sion–Genève, Fondation Artvis'),
  ('F-26-025', 'Café du Centre', 'FR', date('now', '-6 months', '+18 days'), date('now', '-6 months', '+18 days'), 28.00, date('now', '-6 months', '+18 days'), 'Repas hors domicile'),
  ('F-26-026', 'Swisscom', 'FA', date('now', '-6 months', '+20 days'), date('now', '-5 months', '+20 days'), 89.00, date('now', '-6 months', '+28 days'), 'Mobile + Internet'),
  ('F-26-027', 'Coworking Lausanne', 'LO', date('now', '-5 months', '+1 days'), date('now', '-5 months', '+1 days'), 450.00, date('now', '-5 months', '+1 days'), 'Poste de travail coworking'),
  ('F-26-028', 'Adobe', 'FA', date('now', '-5 months', '+5 days'), date('now', '-5 months', '+5 days'), 71.99, date('now', '-5 months', '+5 days'), 'Creative Cloud mensuel'),
  ('F-26-029', 'Caisse AVS Valais', 'CS', date('now', '-5 months', '+15 days'), date('now', '-4 months', '+15 days'), 1250.00, date('now', '-4 months', '+10 days'), 'Acompte cotisations AVS/AI/APG'),
  ('F-26-030', 'Swisscom', 'FA', date('now', '-5 months', '+20 days'), date('now', '-4 months', '+20 days'), 89.00, date('now', '-5 months', '+28 days'), 'Mobile + Internet'),
  ('F-26-031', 'Coworking Lausanne', 'LO', date('now', '-4 months', '+1 days'), date('now', '-4 months', '+1 days'), 450.00, date('now', '-4 months', '+1 days'), 'Poste de travail coworking'),
  ('F-26-032', 'Adobe', 'FA', date('now', '-4 months', '+5 days'), date('now', '-4 months', '+5 days'), 71.99, date('now', '-4 months', '+5 days'), 'Creative Cloud mensuel'),
  ('F-26-033', 'Wacom', 'AM', date('now', '-4 months', '+9 days'), date('now', '-4 months', '+39 days'), 349.00, date('now', '-4 months', '+20 days'), 'Tablette graphique'),
  ('F-26-034', 'Swisscom', 'FA', date('now', '-4 months', '+20 days'), date('now', '-3 months', '+20 days'), 89.00, date('now', '-4 months', '+28 days'), 'Mobile + Internet'),
  ('F-26-035', 'Coworking Lausanne', 'LO', date('now', '-3 months', '+1 days'), date('now', '-3 months', '+1 days'), 450.00, date('now', '-3 months', '+1 days'), 'Poste de travail coworking'),
  ('F-26-036', 'Adobe', 'FA', date('now', '-3 months', '+5 days'), date('now', '-3 months', '+5 days'), 71.99, date('now', '-3 months', '+5 days'), 'Creative Cloud mensuel'),
  ('F-26-037', 'Swisscom', 'FA', date('now', '-3 months', '+20 days'), date('now', '-2 months', '+20 days'), 89.00, date('now', '-3 months', '+28 days'), 'Mobile + Internet'),
  ('F-26-038', 'Figma', 'FA', date('now', '-3 months', '+22 days'), date('now', '-3 months', '+22 days'), 180.00, date('now', '-3 months', '+22 days'), 'Figma Professional, annuel'),
  ('F-26-039', 'Coworking Lausanne', 'LO', date('now', '-2 months', '+1 days'), date('now', '-2 months', '+1 days'), 450.00, date('now', '-2 months', '+1 days'), 'Poste de travail coworking'),
  ('F-26-040', 'Adobe', 'FA', date('now', '-2 months', '+5 days'), date('now', '-2 months', '+5 days'), 71.99, date('now', '-2 months', '+5 days'), 'Creative Cloud mensuel'),
  ('F-26-041', 'CFF', 'FD', date('now', '-2 months', '+14 days'), date('now', '-2 months', '+14 days'), 96.00, date('now', '-2 months', '+14 days'), 'Train Sion–Berne, Helvetica Studio'),
  ('F-26-042', 'Brasserie Lorenzini', 'FR', date('now', '-2 months', '+14 days'), date('now', '-2 months', '+14 days'), 54.00, date('now', '-2 months', '+14 days'), 'Repas de travail Helvetica'),
  ('F-26-043', 'Caisse AVS Valais', 'CS', date('now', '-2 months', '+15 days'), date('now', '-1 months', '+15 days'), 1250.00, date('now', '-1 months', '+10 days'), 'Acompte cotisations AVS/AI/APG'),
  ('F-26-044', 'Swisscom', 'FA', date('now', '-2 months', '+20 days'), date('now', '-1 months', '+20 days'), 89.00, date('now', '-2 months', '+28 days'), 'Mobile + Internet'),
  ('F-26-045', 'Coworking Lausanne', 'LO', date('now', '-1 months', '+1 days'), date('now', '-1 months', '+1 days'), 450.00, date('now', '-1 months', '+1 days'), 'Poste de travail coworking'),
  ('F-26-046', 'Adobe', 'FA', date('now', '-1 months', '+5 days'), date('now', '-1 months', '+5 days'), 71.99, date('now', '-1 months', '+5 days'), 'Creative Cloud mensuel'),
  ('F-26-047', 'Imprimerie Centrale', 'FA', date('now', '-1 months', '+6 days'), date('now', '+6 days'), 380.00, NULL, 'Épreuves couleur packaging thé'),
  ('F-26-048', 'Swisscom', 'FA', date('now', '-1 months', '+20 days'), date('now', '+20 days'), 89.00, date('now', '-1 months', '+28 days'), 'Mobile + Internet'),
  ('F-26-049', 'Coworking Lausanne', 'LO', date('now', '-20 days'), date('now', '-20 days'), 450.00, date('now', '-20 days'), 'Poste de travail coworking'),
  ('F-26-050', 'Adobe', 'FA', date('now', '-16 days'), date('now', '-16 days'), 71.99, date('now', '-16 days'), 'Creative Cloud mensuel'),
  ('F-26-051', 'Galaxus', 'AM', date('now', '-12 days'), date('now', '+18 days'), 129.00, NULL, 'Disque SSD externe 2 To'),
  ('F-26-052', 'Boulangerie Taillens', 'FR', date('now', '-3 days'), date('now', '-3 days'), 18.50, date('now', '-3 days'), 'Repas hors domicile');

-- ═══════════════════════════════════════════════════
-- INCOME (non-invoice revenue)
-- ═══════════════════════════════════════════════════
INSERT INTO income (reference, date, description, amount, category, source, notes) VALUES
  ('R-26-001', date('now', '-8 months'), 'Bourse de soutien au design', 5000.00, 'grant', 'Pro Helvetia', 'Soutien pour le projet d''exposition'),
  ('R-26-002', date('now', '-5 months', '+4 days'), 'Atelier typographie (demi-journée)', 1200.00, 'side_income', 'HEAD Genève', ''),
  ('R-26-003', date('now', '-2 months', '+9 days'), 'Remboursement abonnement', 89.00, 'refund', 'Swisscom', 'Double facturation'),
  ('R-26-004', date('now', '-1 months', '+2 days'), 'Intérêts compte épargne', 12.40, 'interest', 'Raiffeisen', '');

-- ═══════════════════════════════════════════════════
-- RESOURCES
-- ═══════════════════════════════════════════════════
INSERT INTO resources (id, name, url, price) VALUES
  (1, 'Swiss Design Awards Archive', 'https://swissdesignawards.ch', ''),
  (2, 'Fontshare', 'https://fontshare.com', 'free'),
  (3, 'Coolors Palette Generator', 'https://coolors.co', 'free'),
  (4, 'Unsplash', 'https://unsplash.com', 'free'),
  (5, 'Dribbble', 'https://dribbble.com', ''),
  (6, 'Packaging of the World', 'https://packagingoftheworld.com', 'free');
INSERT INTO resource_tags (resource_id, tag) VALUES
  (1, 'inspiration'),
  (1, 'swiss-design'),
  (2, 'typography'),
  (2, 'free'),
  (3, 'colour'),
  (3, 'tools'),
  (4, 'photography'),
  (4, 'free'),
  (5, 'inspiration'),
  (5, 'portfolio'),
  (6, 'packaging'),
  (6, 'inspiration');
INSERT INTO resource_projects (resource_id, project_id) VALUES
  (1, 1),
  (2, 1),
  (3, 1),
  (4, 2),
  (5, 5),
  (6, 4),
  (3, 4);

-- ═══════════════════════════════════════════════════
-- NAMED TABLE (project 1 deliverables tracker)
-- ═══════════════════════════════════════════════════
INSERT INTO project_tables (id, project_id, name, column_config, sort_order) VALUES
  (1, 1, 'Deliverables', '[{"id":"col_1","name":"Deliverable","type":"text","width":220},{"id":"col_2","name":"Status","type":"select","width":130,"options":["Todo","In Progress","Done"]},{"id":"col_3","name":"Approved","type":"checkbox","width":90},{"id":"col_4","name":"Notes","type":"text","width":240}]', 0);
INSERT INTO project_table_rows (table_id, data, sort_order) VALUES
  (1, '{"col_1":"Logo files (AI, SVG, PNG)","col_2":"Done","col_3":true,"col_4":"Delivered v2 after review"}', 0),
  (1, '{"col_1":"Colour palette sheet","col_2":"Done","col_3":true,"col_4":"Pantone + CMYK + HEX"}', 1),
  (1, '{"col_1":"Typography specimen","col_2":"In Progress","col_3":false,"col_4":"Waiting on licence confirmation"}', 2),
  (1, '{"col_1":"Brand book PDF","col_2":"Todo","col_3":false,"col_4":"40 pages, print + screen versions"}', 3),
  (1, '{"col_1":"Stationery templates","col_2":"Todo","col_3":false,"col_4":""}', 4);

-- ═══════════════════════════════════════════════════
-- WIKI (project notes; the built-in User Guide is re-seeded by the loader)
-- ═══════════════════════════════════════════════════
INSERT INTO wiki_folders (id, name, sort_order) VALUES
  (1, 'Client Notes', 1);
INSERT INTO wiki_articles (id, folder_id, project_id, title, content, sort_order) VALUES
  (1, 1, 1, 'Atelier Noir — Brand brief', '<h2>Brief</h2><p>Atelier Noir wants a quieter, more editorial identity that still reads as a design studio. Keep the black, lose the heavy geometric mark.</p><h3>Do</h3><ul><li>Generous whitespace, one accent colour</li><li>Typographic logo, no icon</li></ul><h3>Don''t</h3><ul><li>Gradients or 3D effects</li><li>More than two typefaces</li></ul><p>Decisions are taken by Sophie; Marc handles scheduling and invoices.</p>', 0),
  (2, 1, 2, 'Rapport annuel — Notes de production', '<h2>Impression</h2><p>Imprimerie Centrale, papier Munken Lynx 120 g, couverture 300 g. Délai de production : 3 semaines après le bon à tirer.</p><h2>Langues</h2><p>FR et DE en vis-à-vis. Les traductions DE arrivent par lots de 12 pages.</p><h2>Rabais</h2><p>La fondation bénéficie du rabais culturel de 10 %.</p>', 1),
  (3, 1, 4, 'Tea packaging — Dieline and materials', '<h2>Materials</h2><p>Recycled board (FSC), water-based inks, no lamination. Printer sent the dieline for the 6-variant box.</p><h2>Variants</h2><ol><li>Chamomile</li><li>Earl Grey</li><li>Green Tea</li><li>Rooibos</li><li>Mint</li><li>Winter Blend</li></ol>', 2),
  (4, 1, 6, 'Helvetica Studio — Process notes', '<h2>Purchase orders</h2><p>Every invoice must carry the PO number from Thomas. Without it accounting bounces the invoice, which is why the concept-phase invoice is overdue.</p><h2>Approvals</h2><p>Two rounds included; extra rounds are billed hourly.</p>', 3);
INSERT INTO wiki_article_tags (article_id, tag) VALUES
  (1, 'brief'),
  (1, 'branding'),
  (2, 'production'),
  (2, 'print'),
  (3, 'packaging'),
  (3, 'materials'),
  (4, 'process'),
  (4, 'invoicing');

-- ═══════════════════════════════════════════════════
-- REFERENCE RENUMBERING (per calendar year, from each row's own date)
-- ═══════════════════════════════════════════════════
UPDATE invoices SET reference = '' || strftime('%Y', invoice_date) || '-' || printf('%03d', (
  SELECT COUNT(*) FROM invoices i2
  WHERE strftime('%Y', i2.invoice_date) = strftime('%Y', invoices.invoice_date)
    AND (i2.invoice_date < invoices.invoice_date OR (i2.invoice_date = invoices.invoice_date AND i2.id <= invoices.id)) AND i2.reference NOT LIKE 'DRAFT-%'
)) WHERE reference NOT LIKE 'DRAFT-%';
UPDATE quotes SET reference = 'D-' || strftime('%Y', quote_date) || '-' || printf('%03d', (
  SELECT COUNT(*) FROM quotes i2
  WHERE strftime('%Y', i2.quote_date) = strftime('%Y', quotes.quote_date)
    AND (i2.quote_date < quotes.quote_date OR (i2.quote_date = quotes.quote_date AND i2.id <= quotes.id))
));
UPDATE expenses SET reference = 'F-' || substr(strftime('%Y', invoice_date), 3, 2) || '-' || printf('%03d', (
  SELECT COUNT(*) FROM expenses i2
  WHERE strftime('%Y', i2.invoice_date) = strftime('%Y', expenses.invoice_date)
    AND (i2.invoice_date < expenses.invoice_date OR (i2.invoice_date = expenses.invoice_date AND i2.id <= expenses.id))
));
UPDATE income SET reference = 'R-' || substr(strftime('%Y', date), 3, 2) || '-' || printf('%03d', (
  SELECT COUNT(*) FROM income i2
  WHERE strftime('%Y', i2.date) = strftime('%Y', income.date)
    AND (i2.date < income.date OR (i2.date = income.date AND i2.id <= income.id))
));

-- Re-enable FK checks
PRAGMA foreign_keys = ON;
