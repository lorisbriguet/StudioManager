-- StudioManager Presentation Mode Seed Data
-- Realistic demo data for showcasing the application

-- Disable FK checks during seed to avoid ordering issues
PRAGMA foreign_keys = OFF;

-- Clear existing data (presentation DB is a copy of prod, so clear first)
-- Order: children before parents to respect FK relationships
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
DELETE FROM project_table_rows;
DELETE FROM project_tables;

-- ═══════════════════════════════════════════════════
-- CLIENTS
-- ═══════════════════════════════════════════════════

INSERT INTO clients (id, name, email, phone, address_line1, address_line2, notes) VALUES
  ('C-001', 'Atelier Noir', 'hello@ateliernoir.ch', '+41 21 555 01 01', 'Rue du Marche 12', '1003 Lausanne, CH', 'Design agency, main contact: Sophie Duval. Retainer client since 2024.'),
  ('C-002', 'Fondation Artvis', 'contact@artvis.ch', '+41 22 555 02 02', 'Quai du Mont-Blanc 7', '1201 Geneve, CH', 'Cultural foundation. Annual report + event materials.'),
  ('C-003', 'PixelFlow', 'team@pixelflow.io', '+41 44 555 03 03', 'Limmatstrasse 55', '8005 Zurich, CH', 'Tech startup. Fast-paced, iterative. Prefers Slack.'),
  ('C-004', 'Marie Laurent Photography', 'marie@laurentphoto.ch', '+41 79 555 04 04', 'Chemin des Alpes 3', '1820 Montreux, CH', 'Solo photographer. Brand identity + portfolio site.'),
  ('C-005', 'Helvetica Studio AG', 'projects@helveticastudio.ch', '+41 31 555 05 05', 'Bundesplatz 1', '3011 Bern, CH', 'Corporate. Formal process, PO numbers required.');

INSERT INTO client_contacts (client_id, first_name, last_name, email, phone, role) VALUES
  ('C-001', 'Sophie', 'Duval', 'sophie@ateliernoir.ch', '+41 79 111 22 33', 'Creative Director'),
  ('C-001', 'Marc', 'Renaud', 'marc@ateliernoir.ch', '+41 79 111 22 34', 'Project Manager'),
  ('C-002', 'Claire', 'Bonvin', 'claire@artvis.ch', '+41 79 222 33 44', 'Director'),
  ('C-003', 'Alex', 'Kim', 'alex@pixelflow.io', '+41 79 333 44 55', 'CEO'),
  ('C-003', 'Lea', 'Weber', 'lea@pixelflow.io', '+41 79 333 44 56', 'Product Manager'),
  ('C-004', 'Marie', 'Laurent', 'marie@laurentphoto.ch', '+41 79 555 04 04', 'Owner'),
  ('C-005', 'Thomas', 'Muller', 'thomas@helveticastudio.ch', '+41 79 555 66 77', 'Head of Marketing');

INSERT INTO client_addresses (client_id, label, billing_name, address_line1, address_line2, postal_city) VALUES
  ('C-001', 'Main', 'Atelier Noir Sarl', 'Rue du Marche 12', '', '1003 Lausanne'),
  ('C-002', 'Foundation', 'Fondation Artvis', 'Quai du Mont-Blanc 7', '', '1201 Geneve'),
  ('C-003', 'Office', 'PixelFlow GmbH', 'Limmatstrasse 55', '3rd Floor', '8005 Zurich'),
  ('C-005', 'HQ', 'Helvetica Studio AG', 'Bundesplatz 1', '', '3011 Bern'),
  ('C-005', 'Branch', 'Helvetica Studio AG', 'Bahnhofstrasse 42', '', '8001 Zurich');

-- ═══════════════════════════════════════════════════
-- PROJECTS
-- ═══════════════════════════════════════════════════

INSERT INTO projects (id, client_id, name, status, deadline, notes) VALUES
  (1, 'C-001', 'Brand Identity Refresh', 'active', '2026-04-30', 'Complete rebrand including logo, colour palette, typography, and brand guidelines.'),
  (2, 'C-002', 'Annual Report 2026', 'active', '2026-06-15', 'Annual report design. 48 pages, bilingual FR/DE.'),
  (3, 'C-003', 'E-commerce Redesign', 'completed', '2026-02-28', 'Full redesign of the PixelFlow web shop. Shipped on time.'),
  (4, 'C-001', 'Packaging — Tea Collection', 'active', '2026-05-20', 'Packaging design for 6 tea variants. Eco-friendly materials.'),
  (5, 'C-004', 'Portfolio Website', 'on_hold', '2026-07-01', 'Photography portfolio site. On hold pending content.'),
  (6, 'C-005', 'Marketing Collateral Q2', 'active', '2026-04-15', 'Brochures, business cards, letterhead refresh.'),
  (7, 'C-003', 'Mobile App UI Kit', 'active', '2026-08-01', 'Design system and UI kit for the PixelFlow mobile app.'),
  (8, 'C-002', 'Exhibition Signage', 'completed', '2026-01-20', 'Signage and wayfinding for the January exhibition.');

-- ═══════════════════════════════════════════════════
-- TASKS (with subtasks + workload data)
-- ═══════════════════════════════════════════════════

INSERT INTO tasks (id, project_id, title, description, status, priority, due_date, sort_order, planned_minutes, tracked_minutes) VALUES
  -- Project 1: Brand Identity Refresh
  (1, 1, 'Research & Moodboard', 'Competitive analysis and visual direction', 'done', 'high', '2026-03-15', 0, 480, 510),
  (2, 1, 'Logo Concepts', 'Design 3 logo directions', 'done', 'high', '2026-03-22', 1, 720, 680),
  (3, 1, 'Colour Palette', 'Define primary and secondary colours', 'in_progress', 'medium', '2026-03-28', 2, 240, 120),
  (4, 1, 'Typography Selection', 'Choose typefaces for headings and body', 'todo', 'medium', '2026-04-05', 3, 180, 0),
  (5, 1, 'Brand Guidelines Document', '40-page brand book', 'todo', 'high', '2026-04-25', 4, 960, 0),
  -- Project 2: Annual Report
  (6, 2, 'Content Structure', 'Work with client on content outline', 'done', 'high', '2026-03-01', 0, 360, 380),
  (7, 2, 'Cover Design', 'Design 2 cover options', 'done', 'high', '2026-03-10', 1, 480, 450),
  (8, 2, 'Interior Layout', 'Design spreads for all 48 pages', 'in_progress', 'high', '2026-04-15', 2, 1440, 600),
  (9, 2, 'Infographics', 'Create 8 data visualizations', 'todo', 'medium', '2026-05-01', 3, 720, 0),
  (10, 2, 'Print Proofing', 'Review print proofs with client', 'todo', 'low', '2026-06-01', 4, 180, 0),
  -- Project 3: E-commerce (completed)
  (11, 3, 'Wireframes', '', 'done', 'high', '2026-01-20', 0, 480, 520),
  (12, 3, 'Visual Design', '', 'done', 'high', '2026-02-05', 1, 960, 900),
  (13, 3, 'Responsive Adaption', '', 'done', 'medium', '2026-02-15', 2, 360, 340),
  (14, 3, 'Developer Handoff', '', 'done', 'medium', '2026-02-25', 3, 240, 280),
  -- Project 4: Packaging
  (15, 4, 'Material Research', 'Eco-friendly packaging options', 'done', 'medium', '2026-03-20', 0, 240, 200),
  (16, 4, 'Design Concept', 'Initial packaging concepts x3', 'in_progress', 'high', '2026-04-05', 1, 600, 320),
  (17, 4, 'Print Files', 'Production-ready files for 6 variants', 'todo', 'high', '2026-05-10', 2, 480, 0),
  -- Project 6: Marketing Collateral
  (18, 6, 'Business Cards', 'New design with updated branding', 'done', 'medium', '2026-03-20', 0, 180, 160),
  (19, 6, 'Brochure Design', '12-page company brochure', 'in_progress', 'high', '2026-04-01', 1, 720, 400),
  (20, 6, 'Letterhead & Templates', 'Word and InDesign templates', 'todo', 'low', '2026-04-10', 2, 360, 0),
  -- Project 8: Exhibition (completed)
  (21, 8, 'Signage Design', '', 'done', 'high', '2026-01-10', 0, 480, 500),
  (22, 8, 'Wayfinding System', '', 'done', 'medium', '2026-01-15', 1, 360, 340),
  (23, 8, 'Print Production', '', 'done', 'high', '2026-01-18', 2, 240, 220);

INSERT INTO subtasks (task_id, title, status, sort_order) VALUES
  (1, 'Competitor audit', 'done', 0),
  (1, 'Visual moodboard', 'done', 1),
  (1, 'Client presentation', 'done', 2),
  (2, 'Direction A: Geometric', 'done', 0),
  (2, 'Direction B: Organic', 'done', 1),
  (2, 'Direction C: Typographic', 'done', 2),
  (5, 'Logo usage rules', 'todo', 0),
  (5, 'Colour specifications', 'todo', 1),
  (5, 'Typography guidelines', 'todo', 2),
  (5, 'Stationery templates', 'todo', 3),
  (8, 'Financial pages', 'done', 0),
  (8, 'Impact stories', 'todo', 1),
  (8, 'Photo editing', 'todo', 2),
  (9, 'Revenue chart', 'todo', 0),
  (9, 'Visitor statistics', 'todo', 1),
  (9, 'Geographic distribution', 'todo', 2),
  (16, 'Chamomile variant', 'done', 0),
  (16, 'Earl Grey variant', 'todo', 1),
  (16, 'Green Tea variant', 'todo', 2),
  (19, 'Cover design', 'done', 0),
  (19, 'Interior layout', 'todo', 1),
  (19, 'Photo selection', 'todo', 2);

-- ═══════════════════════════════════════════════════
-- INVOICES
-- ═══════════════════════════════════════════════════

INSERT INTO invoices (id, client_id, reference, invoice_date, due_date, status, currency, total, subtotal, activity, notes, reminder_count) VALUES
  (1, 'C-001', 'F-26-001', '2026-01-15', '2026-02-14', 'paid', 'CHF', 8640.00, 8000.00, 'Graphic Design', 'Brand identity refresh — Phase 1', 0),
  (2, 'C-002', 'F-26-002', '2026-01-20', '2026-02-19', 'paid', 'CHF', 5400.00, 5000.00, 'Graphic Design', 'Exhibition signage', 0),
  (3, 'C-003', 'F-26-003', '2026-02-28', '2026-03-30', 'paid', 'CHF', 16200.00, 15000.00, 'Web Design', 'E-commerce redesign — Final', 0),
  (4, 'C-001', 'F-26-004', '2026-03-15', '2026-04-14', 'sent', 'CHF', 5400.00, 5000.00, 'Graphic Design', 'Packaging tea collection — Concept phase', 0),
  (5, 'C-005', 'F-26-005', '2026-02-01', '2026-03-03', 'overdue', 'CHF', 3240.00, 3000.00, 'Graphic Design', 'Marketing collateral Q1', 2),
  (6, 'C-002', 'DRAFT', '2026-03-25', '2026-04-24', 'draft', 'CHF', 10800.00, 10000.00, 'Graphic Design', 'Annual report 2026 — Progress billing', 0);

INSERT INTO invoice_line_items (invoice_id, designation, quantity, rate, amount, unit, sort_order) VALUES
  (1, 'Research & Moodboard', 8, 120.00, 960.00, 'h', 0),
  (1, 'Logo Concepts (3 directions)', 12, 120.00, 1440.00, 'h', 1),
  (1, 'Client Presentations', 4, 120.00, 480.00, 'h', 2),
  (1, 'Revisions', 6, 120.00, 720.00, 'h', 3),
  (1, 'Brand Colour Palette', 1, 2400.00, 2400.00, 'flat', 4),
  (1, 'Project Management', 1, 2000.00, 2000.00, 'flat', 5),
  (2, 'Signage Design', 8, 120.00, 960.00, 'h', 0),
  (2, 'Wayfinding System', 6, 120.00, 720.00, 'h', 1),
  (2, 'Print Production Supervision', 4, 120.00, 480.00, 'h', 2),
  (2, 'Materials & Printing', 1, 2840.00, 2840.00, 'flat', 3),
  (3, 'UX Wireframes', 16, 130.00, 2080.00, 'h', 0),
  (3, 'Visual Design', 32, 130.00, 4160.00, 'h', 1),
  (3, 'Responsive Adaptation', 12, 130.00, 1560.00, 'h', 2),
  (3, 'Developer Handoff', 8, 130.00, 1040.00, 'h', 3),
  (3, 'Project Management', 1, 6160.00, 6160.00, 'flat', 4),
  (4, 'Material Research', 4, 120.00, 480.00, 'h', 0),
  (4, 'Design Concepts (3 options)', 10, 120.00, 1200.00, 'h', 1),
  (4, 'Client Revisions', 6, 120.00, 720.00, 'h', 2),
  (4, 'Production-Ready Files', 1, 2600.00, 2600.00, 'flat', 3),
  (5, 'Business Card Design', 3, 120.00, 360.00, 'h', 0),
  (5, 'Brochure Layout', 10, 120.00, 1200.00, 'h', 1),
  (5, 'Print Coordination', 1, 1440.00, 1440.00, 'flat', 2),
  (6, 'Cover Design', 8, 120.00, 960.00, 'h', 0),
  (6, 'Interior Layout (24 pages)', 40, 120.00, 4800.00, 'h', 1),
  (6, 'Infographics', 12, 120.00, 1440.00, 'h', 2),
  (6, 'Photo Editing', 8, 100.00, 800.00, 'h', 3),
  (6, 'Project Management', 1, 2000.00, 2000.00, 'flat', 4);

-- ═══════════════════════════════════════════════════
-- QUOTES
-- ═══════════════════════════════════════════════════

INSERT INTO quotes (id, client_id, reference, quote_date, valid_until, status, total, subtotal, activity, notes) VALUES
  (1, 'C-004', 'D-26-001', '2026-02-10', '2026-03-10', 'accepted', 7560.00, 7000.00, 'Web Design', 'Portfolio website — Full design and development'),
  (2, 'C-003', 'D-26-002', '2026-03-01', '2026-04-01', 'sent', 21600.00, 20000.00, 'UI/UX Design', 'Mobile app UI kit'),
  (3, 'C-005', 'D-26-003', '2026-01-05', '2026-02-05', 'rejected', 4320.00, 4000.00, 'Graphic Design', 'Annual calendar design — rejected, budget too tight'),
  (4, 'C-001', 'D-26-004', '2026-03-20', '2026-04-20', 'draft', 12960.00, 12000.00, 'Graphic Design', 'Brand guidelines extension — Social media templates');

INSERT INTO quote_line_items (quote_id, designation, quantity, rate, amount, unit, sort_order) VALUES
  (1, 'UX Research & Wireframes', 8, 130.00, 1040.00, 'h', 0),
  (1, 'Visual Design', 16, 130.00, 2080.00, 'h', 1),
  (1, 'Responsive Development', 20, 130.00, 2600.00, 'h', 2),
  (1, 'Content Migration', 4, 100.00, 400.00, 'h', 3),
  (1, 'Testing & Launch', 1, 880.00, 880.00, 'flat', 4),
  (2, 'Design System Foundations', 20, 140.00, 2800.00, 'h', 0),
  (2, 'Component Library', 40, 140.00, 5600.00, 'h', 1),
  (2, 'Screen Designs (20 screens)', 60, 140.00, 8400.00, 'h', 2),
  (2, 'Documentation', 8, 120.00, 960.00, 'h', 3),
  (2, 'Developer Handoff', 1, 2240.00, 2240.00, 'flat', 4),
  (3, 'Calendar Concept', 6, 120.00, 720.00, 'h', 0),
  (3, 'Monthly Illustrations', 12, 200.00, 2400.00, 'pcs', 1),
  (3, 'Print Preparation', 1, 880.00, 880.00, 'flat', 2),
  (4, 'Social Media Templates (Instagram)', 8, 120.00, 960.00, 'h', 0),
  (4, 'Social Media Templates (LinkedIn)', 6, 120.00, 720.00, 'h', 1),
  (4, 'Animation Guidelines', 10, 140.00, 1400.00, 'h', 2),
  (4, 'Brand Guidelines Update', 16, 120.00, 1920.00, 'h', 3),
  (4, 'Project Management', 1, 7000.00, 7000.00, 'flat', 4);

-- ═══════════════════════════════════════════════════
-- EXPENSES
-- ═══════════════════════════════════════════════════

INSERT INTO expenses (id, reference, supplier, category_code, invoice_date, due_date, amount, paid_date, notes) VALUES
  (1, 'F-26-001', 'Adobe Inc.', 'LO', '2026-01-05', '2026-01-05', 71.99, '2026-01-05', 'Creative Cloud monthly'),
  (2, 'F-26-002', 'Apple Inc.', 'AM', '2026-01-10', '2026-01-10', 49.00, '2026-01-10', 'iCloud+ Storage 2TB'),
  (3, 'F-26-003', 'Figma', 'LO', '2026-01-15', '2026-01-15', 15.00, '2026-01-15', 'Figma Professional monthly'),
  (4, 'F-26-004', 'Swisscom', 'FR', '2026-01-20', '2026-02-20', 89.00, '2026-02-15', 'Mobile + Internet bundle'),
  (5, 'F-26-005', 'Papeterie Brachard', 'FA', '2026-02-01', '2026-03-01', 156.80, '2026-02-28', 'Printing supplies, paper stocks'),
  (6, 'F-26-006', 'Adobe Inc.', 'LO', '2026-02-05', '2026-02-05', 71.99, '2026-02-05', 'Creative Cloud monthly'),
  (7, 'F-26-007', 'WeTransfer', 'LO', '2026-02-10', '2026-02-10', 12.00, '2026-02-10', 'WeTransfer Pro monthly'),
  (8, 'F-26-008', 'IKEA', 'FA', '2026-02-15', NULL, 349.00, NULL, 'Desk lamp and storage'),
  (9, 'F-26-009', 'Imprimerie Centrale', 'CS', '2026-03-01', '2026-04-01', 1280.00, NULL, 'Print run: Atelier Noir packaging samples'),
  (10, 'F-26-010', 'Adobe Inc.', 'LO', '2026-03-05', '2026-03-05', 71.99, '2026-03-05', 'Creative Cloud monthly');

-- ═══════════════════════════════════════════════════
-- INCOME
-- ═══════════════════════════════════════════════════

INSERT INTO income (id, reference, description, category, amount, date, notes) VALUES
  (1, 'R-26-001', 'Pro Helvetia Grant', 'grant', 5000.00, '2026-01-20', 'Cultural design grant for exhibition project'),
  (2, 'R-26-002', 'Typography Workshop', 'workshop', 1200.00, '2026-02-15', 'Half-day workshop at HEAD Geneve'),
  (3, 'R-26-003', 'Stock Photo Royalties', 'royalty', 340.50, '2026-03-01', 'Q1 royalties from Adobe Stock');

-- ═══════════════════════════════════════════════════
-- RESOURCES
-- ═══════════════════════════════════════════════════

INSERT INTO resources (id, name, url, price) VALUES
  (1, 'Swiss Design Awards Archive', 'https://swissdesignawards.ch', ''),
  (2, 'Fontshare by Indian Type Foundry', 'https://fontshare.com', 'free'),
  (3, 'Coolors Palette Generator', 'https://coolors.co', 'free'),
  (4, 'Unsplash', 'https://unsplash.com', 'free'),
  (5, 'Dribbble', 'https://dribbble.com', '');

INSERT INTO resource_tags (resource_id, tag) VALUES
  (1, 'inspiration'), (1, 'swiss-design'),
  (2, 'typography'), (2, 'free'),
  (3, 'colour'), (3, 'tools'),
  (4, 'photography'), (4, 'free'),
  (5, 'inspiration'), (5, 'portfolio');

INSERT INTO resource_projects (resource_id, project_id) VALUES
  (1, 1), (2, 1), (3, 1),
  (4, 2), (5, 5);

-- ═══════════════════════════════════════════════════
-- RECURRING TEMPLATE
-- ═══════════════════════════════════════════════════

INSERT INTO recurring_invoice_templates (base_invoice_id, client_id, frequency, next_due, active) VALUES
  (1, 'C-001', 'monthly', '2026-04-15', 1);

-- Re-enable FK checks
PRAGMA foreign_keys = ON;
