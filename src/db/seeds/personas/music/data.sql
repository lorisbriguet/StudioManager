-- StudioManager demo seed: the "music" persona (Aurore, solo music project living on grants).
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
  ('C-001', 'Le Bourg', 'Association Le Bourg', 'Avenue de la Gare 14', '', '1003 Lausanne', 'booking@lebourg.ch', '+41 21 555 21 01', 'FR', 0, 0.00, 'Salle de concert, 250 places. Contact principal : Nadia Roux.'),
  ('C-002', 'Festival Sonar Valais', 'Festival Sonar Valais', 'Route des Iles 3', '', '1950 Sion', 'programmation@sonarvalais.ch', '+41 27 555 22 02', 'FR', 0, 0.00, 'Festival d''ete, scene B. Programmation confirmee chaque annee en janvier.'),
  ('C-003', 'Centre culturel Le Phare', 'Fondation Le Phare', 'Rue de Lausanne 45', '', '1700 Fribourg', 'administration@lephare-fr.ch', '+41 26 555 23 03', 'FR', 1, 0.10, 'Institution culturelle. Rabais partenaire 10% sur les cachets.'),
  ('C-004', 'Northlight Records', 'Northlight Records GmbH', 'Hardstrasse 219', '', '8004 Zurich', 'contracts@northlightrecords.com', '+41 44 555 24 04', 'EN', 0, 0.00, 'Label. Album advance and distribution deal for Aurore.'),
  ('C-005', 'Ecole de musique Riviera', 'Ecole de musique Riviera', 'Rue du Lac 9', '', '1800 Vevey', 'direction@emriviera.ch', '+41 21 555 25 05', 'FR', 0, 0.00, 'Ateliers d''ecriture mensuels pour les eleves avances.'),
  ('C-006', 'Radio Onde', 'Radio Onde SA', 'Rue des Vollandes 8', '', '1204 Geneve', 'production@radioonde.ch', '+41 22 555 26 06', 'FR', 0, 0.00, 'Session live + interview pour l''emission du samedi.');

INSERT INTO client_contacts (client_id, first_name, last_name, email, phone, role) VALUES
  ('C-001', 'Nadia', 'Roux', 'nadia@lebourg.ch', '+41 79 611 21 01', 'Booking manager'),
  ('C-002', 'Julien', 'Fasel', 'julien@sonarvalais.ch', '+41 79 611 22 02', 'Programmateur'),
  ('C-003', 'Isabelle', 'Currat', 'isabelle@lephare-fr.ch', '+41 79 611 23 03', 'Directrice'),
  ('C-004', 'James', 'Carter', 'james.carter@northlightrecords.com', '+41 79 611 24 04', 'A&R Manager'),
  ('C-005', 'Marc', 'Bovay', 'marc@emriviera.ch', '+41 79 611 25 05', 'Directeur'),
  ('C-006', 'Sarah', 'Dupraz', 'sarah@radioonde.ch', '+41 79 611 26 06', 'Journaliste musique');

INSERT INTO client_addresses (client_id, label, billing_name, address_line1, address_line2, postal_city) VALUES
  ('C-001', 'Salle', 'Association Le Bourg', 'Avenue de la Gare 14', '', '1003 Lausanne'),
  ('C-002', 'Bureau du festival', 'Festival Sonar Valais', 'Route des Iles 3', '', '1950 Sion'),
  ('C-003', 'Centre', 'Fondation Le Phare', 'Rue de Lausanne 45', '', '1700 Fribourg'),
  ('C-004', 'Siege', 'Northlight Records GmbH', 'Hardstrasse 219', '', '8004 Zurich'),
  ('C-005', 'Ecole', 'Ecole de musique Riviera', 'Rue du Lac 9', '', '1800 Vevey'),
  ('C-006', 'Studio', 'Radio Onde SA', 'Rue des Vollandes 8', '', '1204 Geneve');

-- ═══════════════════════════════════════════════════
-- PROJECTS (block layouts show the modular project page)
-- ═══════════════════════════════════════════════════
INSERT INTO projects (id, client_id, name, status, start_date, deadline, description, notes, layout_config) VALUES
  (1, 'C-004', 'Album Aurore', 'active', date('now', '-120 days'), date('now', '+90 days'), 'Premier album complet : dix titres, enregistrement, mixage, mastering et sortie digitale + vinyle.', 'Avance versee par Northlight Records a la signature. Sortie prevue au printemps prochain.', '[{"type":"tasks"},{"type":"invoices","width":"half"},{"type":"wiki","width":"half"}]'),
  (2, 'C-002', 'Tournee printemps', 'active', date('now', '-60 days'), date('now', '+75 days'), 'Tournee romande de 6 dates autour de la sortie de l''album, tete d''affiche scene B au Festival Sonar Valais.', 'Booking gere directement avec les salles, pas de tourneur.', '[{"type":"tasks"},{"type":"workload"},{"type":"named_tables","width":"half"},{"type":"wiki","width":"half"}]'),
  (3, 'C-005', 'Ateliers ecriture', 'active', date('now', '-150 days'), date('now', '+180 days'), 'Cycle mensuel d''ateliers d''ecriture de chansons pour les eleves avances de l''Ecole de musique Riviera.', 'Un atelier de 3h par mois, groupe de 8 eleves.', '[{"type":"tasks"},{"type":"resources"}]'),
  (4, 'C-004', 'EP Nuit', 'completed', date('now', '-400 days'), date('now', '-280 days'), 'EP quatre titres, premiere collaboration avec Northlight Records avant le contrat album.', 'Sorti en digital uniquement, bonne reception presse specialisee.', NULL),
  (5, 'C-006', 'Clip Horizon', 'on_hold', date('now', '-30 days'), date('now', '+150 days'), 'Clip pour le titre Horizon (EP Nuit), tourne en exterieur. En pause en attendant le budget promo.', 'Repreise prevue apres confirmation du soutien de la Fondation Suisa.', NULL);

-- ═══════════════════════════════════════════════════
-- TASKS (tracked_minutes = sum of the task's time entries below)
-- ═══════════════════════════════════════════════════
INSERT INTO tasks (id, project_id, title, description, status, priority, due_date, sort_order, planned_minutes, tracked_minutes) VALUES
  (1, 1, 'Ecriture des dix titres', 'Sessions d''ecriture texte et melodie pour l''ensemble de l''album', 'done', 'high', date('now', '-95 days'), 0, 1200, 540),
  (2, 1, 'Pre-production home studio', 'Demos et arrangements avant les sessions studio', 'done', 'medium', date('now', '-80 days'), 1, 480, 315),
  (3, 1, 'Enregistrer les voix (titres 1-4)', '', 'done', 'high', date('now', '-65 days'), 2, 600, 630),
  (4, 1, 'Enregistrer les voix (titres 5-7)', '', 'done', 'high', date('now', '-55 days'), 3, 480, 530),
  (5, 1, 'Enregistrer les voix (titres 8-10)', '', 'done', 'high', date('now', '-45 days'), 4, 480, 310),
  (6, 1, 'Enregistrer les instruments (cordes)', 'Session avec quatuor a cordes invite', 'todo', 'medium', date('now', '+3 days'), 5, 360, 60),
  (7, 1, 'Mixage titre 1', '', 'done', 'medium', date('now', '-30 days'), 6, 300, 360),
  (8, 1, 'Mixage titre 2', '', 'todo', 'medium', date('now', '+14 days'), 7, 300, 90),
  (9, 1, 'Mixage titre 3', '', 'todo', 'medium', date('now', '-10 days'), 8, 300, 135),
  (10, 1, 'Mastering (Studio Nord)', 'Envoi des mixes finaux a Studio Nord', 'todo', 'high', date('now', '+25 days'), 9, 240, 30),
  (11, 1, 'Pochette et livret', 'Shooting photo et direction artistique du visuel', 'todo', 'medium', date('now', '+35 days'), 10, 360, 0),
  (12, 1, 'Depot SUISA des titres', 'Declaration des dix titres avant la sortie', 'todo', 'low', date('now', '+50 days'), 11, 120, 60),
  (13, 1, 'Choix du single', '', 'done', 'medium', date('now', '-20 days'), 12, 120, 60),
  (14, 1, 'Plan de sortie et promo', 'Calendrier de sortie, playlists, presse specialisee', 'todo', 'high', date('now', '+70 days'), 13, 300, 45),
  (15, 2, 'Booking date Sion', '', 'done', 'high', date('now', '-50 days'), 0, 180, 60),
  (16, 2, 'Booking date Fribourg', '', 'done', 'high', date('now', '-45 days'), 1, 180, 45),
  (17, 2, 'Booking date Geneve', '', 'done', 'medium', date('now', '-38 days'), 2, 180, 60),
  (18, 2, 'Feuille de route tournee', 'Trajets, hebergements, horaires techniques pour les 6 dates', 'todo', 'medium', date('now', '+10 days'), 3, 240, 150),
  (19, 2, 'Location camion et materiel', '', 'todo', 'medium', date('now', '+5 days'), 4, 120, 30),
  (20, 2, 'Repetitions generales', '', 'done', 'high', date('now', '-15 days'), 5, 600, 780),
  (21, 2, 'Contrats techniques (riders)', 'Rider technique et hospitalite pour chaque salle', 'todo', 'high', date('now', '-4 days'), 6, 180, 105),
  (22, 2, 'Promotion reseaux sociaux tournee', '', 'todo', 'low', date('now', '+30 days'), 7, 240, 45),
  (23, 2, 'Merch: commande t-shirts et vinyles', '', 'done', 'medium', date('now', '-25 days'), 8, 120, 60),
  (24, 2, 'Debrief post-tournee scene B', 'Bilan financier et retour d''equipe apres le festival', 'todo', 'low', date('now', '+72 days'), 9, 90, 0),
  (25, 3, 'Preparer atelier 1 (structure)', '', 'done', 'medium', date('now', '-140 days'), 0, 120, 60),
  (26, 3, 'Preparer atelier 2 (melodie)', '', 'done', 'medium', date('now', '-110 days'), 1, 120, 60),
  (27, 3, 'Preparer atelier 3 (harmonie)', '', 'done', 'medium', date('now', '-80 days'), 2, 120, 60),
  (28, 3, 'Preparer atelier 4 (rimes)', '', 'todo', 'medium', date('now', '+40 days'), 3, 120, 30),
  (29, 3, 'Preparer atelier 5 (interpretation)', '', 'todo', 'medium', date('now', '-8 days'), 4, 120, 45),
  (30, 3, 'Bilan pedagogique semestriel', '', 'todo', 'low', date('now', '+60 days'), 5, 90, 30),
  (31, 4, 'Composition des quatre titres', '', 'done', 'medium', date('now', '-395 days'), 0, 480, 0),
  (32, 4, 'Enregistrement EP Nuit', '', 'done', 'high', date('now', '-360 days'), 1, 480, 0),
  (33, 4, 'Mixage et mastering EP Nuit', '', 'done', 'high', date('now', '-330 days'), 2, 300, 0),
  (34, 4, 'Sortie digitale EP Nuit', '', 'done', 'medium', date('now', '-285 days'), 3, 90, 0),
  (35, 5, 'Tournage clip: reperages', 'Reperage des lieux de tournage exterieurs', 'done', 'medium', date('now', '-25 days'), 0, 240, 0),
  (36, 5, 'Montage clip Horizon', '', 'todo', 'medium', date('now', '+45 days'), 1, 360, 0);

INSERT INTO subtasks (task_id, title, status, sort_order, due_date) VALUES
  (1, 'Textes titres 1-5', 'done', 0, NULL),
  (1, 'Textes titres 6-10', 'done', 1, NULL),
  (1, 'Relecture parolier', 'done', 2, NULL),
  (3, 'Prise titre 1', 'done', 0, NULL),
  (3, 'Prise titre 2', 'done', 1, NULL),
  (3, 'Prise titre 3', 'done', 2, NULL),
  (3, 'Prise titre 4', 'done', 3, NULL),
  (9, 'Editing pistes', 'done', 0, NULL),
  (9, 'Automation', 'todo', 1, date('now', '-2 days')),
  (9, 'Validation producteur', 'todo', 2, date('now', '-1 days')),
  (11, 'Shooting photo', 'todo', 0, date('now', '+20 days')),
  (11, 'Direction artistique', 'todo', 1, date('now', '+25 days')),
  (11, 'Impression livret', 'todo', 2, date('now', '+33 days')),
  (12, 'Fiches techniques titres 1-5', 'done', 0, NULL),
  (12, 'Fiches techniques titres 6-10', 'todo', 1, date('now', '+45 days')),
  (15, 'Contact salle', 'done', 0, NULL),
  (15, 'Signature contrat', 'done', 1, NULL),
  (18, 'Trajets', 'todo', 0, date('now', '+8 days')),
  (18, 'Hebergements', 'todo', 1, date('now', '+9 days')),
  (18, 'Horaires techniques', 'todo', 2, date('now', '+10 days')),
  (21, 'Rider technique', 'todo', 0, date('now', '-2 days')),
  (21, 'Rider hospitalite', 'todo', 1, date('now', '-1 days')),
  (24, 'Compte-rendu financier', 'todo', 0, date('now', '+75 days')),
  (24, 'Retour equipe', 'todo', 1, date('now', '+78 days'));

INSERT INTO time_entries (project_id, task_id, duration_minutes, date, description, hourly_rate, invoiced) VALUES
  (1, 1, 180, date('now', '-89 days'), 'Composition', 0.00, 1),
  (1, 1, 150, date('now', '-85 days'), 'Composition', 0.00, 1),
  (1, 1, 120, date('now', '-81 days'), 'Ecriture paroles', 0.00, 1),
  (1, 1, 90, date('now', '-77 days'), 'Composition', 0.00, 1),
  (1, 2, 90, date('now', '-78 days'), 'Pre-production', 0.00, 1),
  (1, 2, 120, date('now', '-74 days'), 'Pre-production', 0.00, 1),
  (1, 2, 60, date('now', '-71 days'), 'Pre-production', 0.00, 1),
  (1, 3, 240, date('now', '-63 days'), 'Enregistrement voix', 90.00, 1),
  (1, 3, 210, date('now', '-60 days'), 'Enregistrement voix', 90.00, 1),
  (1, 3, 180, date('now', '-57 days'), 'Enregistrement voix', 90.00, 1),
  (1, 4, 200, date('now', '-53 days'), 'Enregistrement voix', 90.00, 1),
  (1, 4, 180, date('now', '-50 days'), 'Enregistrement voix', 90.00, 1),
  (1, 4, 150, date('now', '-47 days'), 'Enregistrement voix', 90.00, 1),
  (1, 5, 190, date('now', '-43 days'), 'Enregistrement voix', 90.00, 1),
  (1, 5, 120, date('now', '-40 days'), 'Enregistrement voix', 90.00, 0),
  (1, 7, 150, date('now', '-28 days'), 'Mix', 90.00, 1),
  (1, 7, 120, date('now', '-25 days'), 'Mix', 90.00, 0),
  (1, 7, 90, date('now', '-22 days'), 'Mix', 90.00, 0),
  (1, 8, 90, date('now', '-6 days'), 'Mix', 90.00, 0),
  (1, 9, 60, date('now', '-12 days'), 'Mix', 90.00, 0),
  (1, 9, 45, date('now', '-9 days'), 'Mix', 90.00, 0),
  (1, 9, 30, date('now', '-7 days'), 'Mix', 90.00, 0),
  (1, 12, 60, date('now', '-4 days'), 'Depot SUISA', 0.00, 0),
  (1, 13, 60, date('now', '-19 days'), 'Ecoute et selection', 0.00, 1),
  (1, NULL, 90, date('now', '-70 days'), 'Admin subventions', 0.00, 0),
  (1, NULL, 60, date('now', '-15 days'), 'Admin subventions', 0.00, 0),
  (2, 15, 60, date('now', '-52 days'), 'Booking', 0.00, 1),
  (2, 16, 45, date('now', '-47 days'), 'Booking', 0.00, 1),
  (2, 17, 60, date('now', '-40 days'), 'Booking', 0.00, 1),
  (2, 18, 90, date('now', '-8 days'), 'Feuille de route', 0.00, 0),
  (2, 18, 60, date('now', '-5 days'), 'Feuille de route', 0.00, 0),
  (2, 20, 240, date('now', '-18 days'), 'Repetition', 0.00, 1),
  (2, 20, 180, date('now', '-14 days'), 'Repetition', 0.00, 0),
  (2, 20, 150, date('now', '-9 days'), 'Repetition', 0.00, 0),
  (2, 20, 120, date('now', '-6 days'), 'Repetition', 0.00, 0),
  (2, 21, 60, date('now', '-6 days'), 'Contrats techniques', 0.00, 0),
  (2, 21, 45, date('now', '-3 days'), 'Contrats techniques', 0.00, 0),
  (2, 23, 60, date('now', '-27 days'), 'Commande merch', 0.00, 1),
  (2, NULL, 60, date('now', '-35 days'), 'Admin subventions', 0.00, 0),
  (2, NULL, 45, date('now', '-20 days'), 'Admin subventions', 0.00, 0),
  (3, 25, 60, date('now', '-85 days'), 'Preparation atelier', 0.00, 1),
  (3, 26, 60, date('now', '-55 days'), 'Preparation atelier', 0.00, 1),
  (3, 27, 60, date('now', '-25 days'), 'Preparation atelier', 0.00, 0),
  (3, 29, 45, date('now', '-6 days'), 'Preparation atelier', 0.00, 0),
  (3, NULL, 60, date('now', '-2 days'), 'Admin subventions', 0.00, 0),
  (3, NULL, 30, date('now', '-45 days'), 'Admin subventions', 0.00, 1),
  (1, 6, 60, date('now', '-2 days'), 'Repetition cordes', 0.00, 0),
  (1, 10, 30, date('now', '-3 days'), 'Contact Studio Nord', 0.00, 0),
  (1, 14, 45, date('now', '-10 days'), 'Plan promo', 0.00, 0),
  (1, 2, 45, date('now', '-68 days'), 'Pre-production', 0.00, 0),
  (2, 19, 30, date('now', '-4 days'), 'Recherche location camion', 0.00, 0),
  (2, 22, 45, date('now', '-12 days'), 'Promotion reseaux', 0.00, 0),
  (2, 20, 90, date('now', '-3 days'), 'Repetition', 0.00, 0),
  (3, 28, 30, date('now', '-20 days'), 'Preparation atelier', 0.00, 0),
  (3, 30, 30, date('now', '-30 days'), 'Bilan pedagogique', 0.00, 0);

-- ═══════════════════════════════════════════════════
-- INVOICES (12 months of history, VAT exempt, partner discount for C-003)
-- ═══════════════════════════════════════════════════
INSERT INTO invoices (id, reference, client_id, project_id, status, language, activity, activity_id, assignment, invoice_date, due_date, payment_terms_days, subtotal, discount_applied, discount_rate, discount_label, total, paid_date, notes, po_number, currency, exchange_rate, chf_equivalent, reminder_count, last_reminder_date, from_quote_id) VALUES
  (1, '2026-001', 'C-001', NULL, 'paid', 'FR', (SELECT name_fr FROM activities WHERE name_fr = 'Concert'), (SELECT id FROM activities WHERE name_fr = 'Concert'), 'Concert - Le Bourg', date('now', '-11 months'), date('now', '-11 months', '+30 days'), 30, 1200.00, 0, 0.00, NULL, 1200.00, date('now', '-11 months', '+18 days'), '', NULL, 'CHF', 1.00, 1200.00, 0, NULL, NULL),
  (2, '2026-002', 'C-004', 1, 'paid', 'EN', (SELECT name_en FROM activities WHERE name_fr = 'Production'), (SELECT id FROM activities WHERE name_fr = 'Production'), 'Album advance', date('now', '-10 months'), date('now', '-10 months', '+30 days'), 30, 4000.00, 0, 0.00, NULL, 4000.00, date('now', '-10 months', '+15 days'), 'Signing advance for the Aurore album.', NULL, 'CHF', 1.00, 4000.00, 0, NULL, NULL),
  (3, '2026-003', 'C-002', NULL, 'paid', 'FR', (SELECT name_fr FROM activities WHERE name_fr = 'Concert'), (SELECT id FROM activities WHERE name_fr = 'Concert'), 'Concert - salle Sonar', date('now', '-9 months'), date('now', '-9 months', '+30 days'), 30, 1350.00, 0, 0.00, NULL, 1350.00, date('now', '-9 months', '+20 days'), '', NULL, 'CHF', 1.00, 1350.00, 0, NULL, NULL),
  (4, '2026-004', 'C-003', NULL, 'paid', 'FR', (SELECT name_fr FROM activities WHERE name_fr = 'Concert'), (SELECT id FROM activities WHERE name_fr = 'Concert'), 'Concert - Centre culturel Le Phare', date('now', '-7 months'), date('now', '-7 months', '+30 days'), 30, 2000.00, 1, 0.10, 'Rabais partenaire', 1800.00, date('now', '-7 months', '+25 days'), '', NULL, 'CHF', 1.00, 1800.00, 0, NULL, NULL),
  (5, '2026-005', 'C-001', NULL, 'paid', 'FR', (SELECT name_fr FROM activities WHERE name_fr = 'Concert'), (SELECT id FROM activities WHERE name_fr = 'Concert'), 'Concert - Le Bourg', date('now', '-6 months'), date('now', '-6 months', '+30 days'), 30, 900.00, 0, 0.00, NULL, 900.00, date('now', '-6 months', '+12 days'), '', NULL, 'CHF', 1.00, 900.00, 0, NULL, NULL),
  (6, '2026-006', 'C-005', 3, 'paid', 'FR', (SELECT name_fr FROM activities WHERE name_fr = 'Atelier'), (SELECT id FROM activities WHERE name_fr = 'Atelier'), 'Atelier d''ecriture mensuel', date('now', '-4 months'), date('now', '-4 months', '+30 days'), 30, 600.00, 0, 0.00, NULL, 600.00, date('now', '-4 months', '+10 days'), 'Atelier mensuel — Ecole de musique Riviera', NULL, 'CHF', 1.00, 600.00, 0, NULL, NULL),
  (7, '2026-007', 'C-005', 3, 'paid', 'FR', (SELECT name_fr FROM activities WHERE name_fr = 'Atelier'), (SELECT id FROM activities WHERE name_fr = 'Atelier'), 'Atelier d''ecriture mensuel', date('now', '-3 months'), date('now', '-3 months', '+30 days'), 30, 600.00, 0, 0.00, NULL, 600.00, date('now', '-3 months', '+10 days'), 'Atelier mensuel — Ecole de musique Riviera', NULL, 'CHF', 1.00, 600.00, 0, NULL, NULL),
  (8, '2026-008', 'C-003', NULL, 'sent', 'FR', (SELECT name_fr FROM activities WHERE name_fr = 'Concert'), (SELECT id FROM activities WHERE name_fr = 'Concert'), 'Concert - Centre culturel Le Phare', date('now', '-2 months'), date('now', '-2 months', '+30 days'), 30, 1600.00, 1, 0.10, 'Rabais partenaire', 1440.00, NULL, '', NULL, 'CHF', 1.00, 1440.00, 0, NULL, NULL),
  (9, '2026-009', 'C-005', 3, 'paid', 'FR', (SELECT name_fr FROM activities WHERE name_fr = 'Atelier'), (SELECT id FROM activities WHERE name_fr = 'Atelier'), 'Atelier d''ecriture mensuel', date('now', '-2 months', '+18 days'), date('now', '-2 months', '+18 days', '+30 days'), 30, 600.00, 0, 0.00, NULL, 600.00, date('now', '-2 months', '+18 days', '+10 days'), 'Atelier mensuel — Ecole de musique Riviera', NULL, 'CHF', 1.00, 600.00, 0, NULL, NULL),
  (10, '2026-010', 'C-006', NULL, 'overdue', 'FR', (SELECT name_fr FROM activities WHERE name_fr = 'Concert'), (SELECT id FROM activities WHERE name_fr = 'Concert'), 'Session live + interview', date('now', '-50 days'), date('now', '-50 days', '+30 days'), 30, 450.00, 0, 0.00, NULL, 450.00, NULL, '', NULL, 'CHF', 1.00, 450.00, 1, date('now', '-5 days'), NULL),
  (11, '2026-011', 'C-005', 3, 'paid', 'FR', (SELECT name_fr FROM activities WHERE name_fr = 'Atelier'), (SELECT id FROM activities WHERE name_fr = 'Atelier'), 'Atelier d''ecriture mensuel', date('now', '-1 months'), date('now', '-1 months', '+30 days'), 30, 600.00, 0, 0.00, NULL, 600.00, date('now', '-1 months', '+10 days'), 'Atelier mensuel — Ecole de musique Riviera', NULL, 'CHF', 1.00, 600.00, 0, NULL, NULL),
  (12, '2026-012', 'C-002', 2, 'paid', 'FR', (SELECT name_fr FROM activities WHERE name_fr = 'Concert'), (SELECT id FROM activities WHERE name_fr = 'Concert'), 'Tete d''affiche scene B — Festival Sonar Valais', date('now', '-35 days'), date('now', '-35 days', '+30 days'), 30, 1500.00, 0, 0.00, NULL, 1500.00, date('now', '-35 days', '+8 days'), 'Convertie depuis le devis D-2026-001.', NULL, 'CHF', 1.00, 1500.00, 0, NULL, NULL),
  (13, '2026-013', 'C-005', 3, 'sent', 'FR', (SELECT name_fr FROM activities WHERE name_fr = 'Atelier'), (SELECT id FROM activities WHERE name_fr = 'Atelier'), 'Atelier d''ecriture mensuel', date('now', '-6 days'), date('now', '-6 days', '+30 days'), 30, 600.00, 0, 0.00, NULL, 600.00, NULL, 'Atelier mensuel — Ecole de musique Riviera', NULL, 'CHF', 1.00, 600.00, 0, NULL, NULL),
  (14, 'DRAFT-1', 'C-002', NULL, 'draft', 'FR', (SELECT name_fr FROM activities WHERE name_fr = 'Concert'), (SELECT id FROM activities WHERE name_fr = 'Concert'), 'Cachet concert (a confirmer) — prochain festival', date('now', '-2 days'), date('now', '-2 days', '+30 days'), 30, 1500.00, 0, 0.00, NULL, 1500.00, NULL, '', NULL, 'CHF', 1.00, 1500.00, 0, NULL, NULL);
INSERT INTO invoice_line_items (invoice_id, designation, quantity, rate, amount, unit, sort_order) VALUES
  (1, 'Cachet concert', 1, 1200.00, 1200.00, 'flat', 0),
  (2, 'Album advance', 1, 4000.00, 4000.00, 'flat', 0),
  (3, 'Cachet concert', 1, 1350.00, 1350.00, 'flat', 0),
  (4, 'Concert - programmation Le Phare', 1, 1500.00, 1500.00, 'flat', 0),
  (4, 'Frais techniques', 5, 100.00, 500.00, 'hours', 1),
  (5, 'Cachet concert', 1, 900.00, 900.00, 'flat', 0),
  (6, 'Atelier d''ecriture mensuel', 1, 600.00, 600.00, 'flat', 0),
  (7, 'Atelier d''ecriture mensuel', 1, 600.00, 600.00, 'flat', 0),
  (8, 'Concert - programmation Le Phare', 1, 1200.00, 1200.00, 'flat', 0),
  (8, 'Frais techniques', 4, 100.00, 400.00, 'hours', 1),
  (9, 'Atelier d''ecriture mensuel', 1, 600.00, 600.00, 'flat', 0),
  (10, 'Session live', 1, 300.00, 300.00, 'flat', 0),
  (10, 'Interview radio', 1, 150.00, 150.00, 'flat', 1),
  (11, 'Atelier d''ecriture mensuel', 1, 600.00, 600.00, 'flat', 0),
  (12, 'Cachet tete d''affiche', 1, 1200.00, 1200.00, 'flat', 0),
  (12, 'Frais techniques et backline', 4, 75.00, 300.00, 'hours', 1),
  (13, 'Atelier d''ecriture mensuel', 1, 600.00, 600.00, 'flat', 0),
  (14, 'Cachet concert (a confirmer)', 1, 1500.00, 1500.00, 'flat', 0);

-- ═══════════════════════════════════════════════════
-- QUOTES
-- ═══════════════════════════════════════════════════
INSERT INTO quotes (id, reference, client_id, project_id, status, language, activity, activity_id, assignment, quote_date, valid_until, subtotal, discount_applied, discount_rate, total, converted_to_project_id, converted_to_invoice_id, notes) VALUES
  (1, 'D-2026-001', 'C-002', 2, 'accepted', 'FR', (SELECT name_fr FROM activities WHERE name_fr = 'Concert'), (SELECT id FROM activities WHERE name_fr = 'Concert'), 'Tete d''affiche scene B — Festival Sonar Valais', date('now', '-70 days'), date('now', '-40 days'), 1500.00, 0, 0.00, 1500.00, NULL, 12, 'Convertie en facture apres confirmation de la programmation.'),
  (2, 'D-2026-002', 'C-005', NULL, 'accepted', 'FR', (SELECT name_fr FROM activities WHERE name_fr = 'Atelier'), (SELECT id FROM activities WHERE name_fr = 'Atelier'), 'Forfait ateliers ecriture', date('now', '-165 days'), date('now', '-140 days'), 3500.00, 0, 0.00, 3500.00, 3, NULL, ''),
  (3, 'D-2026-003', 'C-004', NULL, 'sent', 'EN', (SELECT name_en FROM activities WHERE name_fr = 'Production'), (SELECT id FROM activities WHERE name_fr = 'Production'), 'Showcase acoustique — soiree corporate', date('now', '-20 days'), date('now', '+10 days'), 2500.00, 0, 0.00, 2500.00, NULL, NULL, ''),
  (4, 'D-2026-004', 'C-001', NULL, 'rejected', 'FR', (SELECT name_fr FROM activities WHERE name_fr = 'Concert'), (SELECT id FROM activities WHERE name_fr = 'Concert'), 'Prestation mariage — salle annexe', date('now', '-100 days'), date('now', '-70 days'), 1800.00, 0, 0.00, 1800.00, NULL, NULL, 'Demande transmise par Nadia (Le Bourg loue aussi sa salle annexe pour des evenements prives). Refuse — date trop proche d''une date de tournee.'),
  (5, 'D-2026-005', 'C-001', NULL, 'draft', 'FR', (SELECT name_fr FROM activities WHERE name_fr = 'Concert'), (SELECT id FROM activities WHERE name_fr = 'Concert'), 'Deuxieme date au Bourg — proposition', date('now', '-5 days'), date('now', '+25 days'), 1000.00, 0, 0.00, 1000.00, NULL, NULL, 'En attente de confirmation de la salle.');
INSERT INTO quote_line_items (quote_id, designation, quantity, rate, amount, unit, sort_order) VALUES
  (1, 'Cachet tete d''affiche', 1, 1200.00, 1200.00, 'flat', 0),
  (1, 'Frais techniques et backline', 4, 75.00, 300.00, 'hours', 1),
  (2, 'Forfait ateliers ecriture (10 sessions)', 10, 350.00, 3500.00, 'hours', 0),
  (3, 'Acoustic showcase performance', 1, 2500.00, 2500.00, 'flat', 0),
  (4, 'Prestation mariage (set acoustique 2h)', 2, 900.00, 1800.00, 'hours', 0),
  (5, 'Cachet concert', 1, 1000.00, 1000.00, 'flat', 0);

-- ═══════════════════════════════════════════════════
-- RECURRING INVOICE TEMPLATE (monthly workshop invoicing)
-- ═══════════════════════════════════════════════════
INSERT INTO recurring_invoice_templates (base_invoice_id, client_id, frequency, next_due, active) VALUES
  (13, 'C-005', 'monthly', date('now', '+12 days'), 1);

-- ═══════════════════════════════════════════════════
-- EXPENSES (12 months; every Swiss tax category represented)
-- ═══════════════════════════════════════════════════
INSERT INTO expenses (reference, supplier, category_code, invoice_date, due_date, amount, paid_date, notes) VALUES
  ('F-26-001', 'Locaux Sevelin', 'LO', date('now', '-11 months', '+2 days'), date('now', '-11 months', '+2 days'), 350.00, date('now', '-11 months', '+2 days', '+2 days'), 'Location salle de repetition'),
  ('F-26-002', 'Locaux Sevelin', 'LO', date('now', '-10 months', '+2 days'), date('now', '-10 months', '+2 days'), 350.00, date('now', '-10 months', '+2 days', '+2 days'), 'Location salle de repetition'),
  ('F-26-003', 'Locaux Sevelin', 'LO', date('now', '-9 months', '+2 days'), date('now', '-9 months', '+2 days'), 350.00, date('now', '-9 months', '+2 days', '+2 days'), 'Location salle de repetition'),
  ('F-26-004', 'Locaux Sevelin', 'LO', date('now', '-8 months', '+2 days'), date('now', '-8 months', '+2 days'), 350.00, date('now', '-8 months', '+2 days', '+2 days'), 'Location salle de repetition'),
  ('F-26-005', 'Locaux Sevelin', 'LO', date('now', '-7 months', '+2 days'), date('now', '-7 months', '+2 days'), 350.00, date('now', '-7 months', '+2 days', '+2 days'), 'Location salle de repetition'),
  ('F-26-006', 'Locaux Sevelin', 'LO', date('now', '-6 months', '+2 days'), date('now', '-6 months', '+2 days'), 350.00, date('now', '-6 months', '+2 days', '+2 days'), 'Location salle de repetition'),
  ('F-26-007', 'Locaux Sevelin', 'LO', date('now', '-5 months', '+2 days'), date('now', '-5 months', '+2 days'), 350.00, date('now', '-5 months', '+2 days', '+2 days'), 'Location salle de repetition'),
  ('F-26-008', 'Locaux Sevelin', 'LO', date('now', '-4 months', '+2 days'), date('now', '-4 months', '+2 days'), 350.00, date('now', '-4 months', '+2 days', '+2 days'), 'Location salle de repetition'),
  ('F-26-009', 'Locaux Sevelin', 'LO', date('now', '-3 months', '+2 days'), date('now', '-3 months', '+2 days'), 350.00, date('now', '-3 months', '+2 days', '+2 days'), 'Location salle de repetition'),
  ('F-26-010', 'Locaux Sevelin', 'LO', date('now', '-2 months', '+2 days'), date('now', '-2 months', '+2 days'), 350.00, date('now', '-2 months', '+2 days', '+2 days'), 'Location salle de repetition'),
  ('F-26-011', 'Locaux Sevelin', 'LO', date('now', '-1 months', '+2 days'), date('now', '-1 months', '+2 days'), 350.00, date('now', '-1 months', '+2 days', '+2 days'), 'Location salle de repetition'),
  ('F-26-012', 'Locaux Sevelin', 'LO', date('now', '-12 days'), date('now', '-12 days', '+18 days'), 350.00, NULL, 'Location salle de repetition (facture en attente)'),
  ('F-26-013', 'Studio Nord', 'AM', date('now', '-63 days'), date('now', '-63 days'), 320.00, date('now', '-63 days', '+3 days'), 'Journee studio — prise de voix'),
  ('F-26-014', 'Studio Nord', 'AM', date('now', '-53 days'), date('now', '-53 days'), 320.00, date('now', '-53 days', '+3 days'), 'Journee studio — prise de voix'),
  ('F-26-015', 'Studio Nord', 'AM', date('now', '-43 days'), date('now', '-43 days'), 280.00, date('now', '-43 days', '+3 days'), 'Journee studio — prise de voix'),
  ('F-26-016', 'Studio Nord', 'AM', date('now', '-30 days'), date('now', '-30 days'), 350.00, date('now', '-30 days', '+3 days'), 'Journee studio — instruments'),
  ('F-26-017', 'Studio Nord', 'AM', date('now', '-20 days'), date('now', '-20 days', '+30 days'), 900.00, NULL, 'Mastering de l''album (10 titres)'),
  ('F-26-018', 'Atelier Lutherie Vaud', 'AM', date('now', '-9 months', '+6 days'), date('now', '-9 months', '+6 days'), 180.00, date('now', '-9 months', '+6 days', '+10 days'), 'Reparation guitare — chevalet'),
  ('F-26-019', 'Atelier Lutherie Vaud', 'AM', date('now', '-3 months', '+9 days'), date('now', '-3 months', '+9 days'), 220.00, date('now', '-3 months', '+9 days', '+10 days'), 'Entretien et reglage guitare'),
  ('F-26-020', 'Sonoshop Lausanne', 'AM', date('now', '-6 months', '+4 days'), date('now', '-6 months', '+4 days'), 45.00, date('now', '-6 months', '+4 days', '+4 days'), 'Jeux de cordes'),
  ('F-26-021', 'Sonoshop Lausanne', 'AM', date('now', '-3 months', '+2 days'), date('now', '-3 months', '+2 days'), 60.00, date('now', '-3 months', '+2 days', '+2 days'), 'Cables et connectique'),
  ('F-26-022', 'Sonoshop Lausanne', 'AM', date('now', '-1 months', '+7 days'), date('now', '-1 months', '+7 days'), 38.00, date('now', '-1 months', '+7 days', '+7 days'), 'Jeux de cordes'),
  ('F-26-023', 'Digitronic Lausanne', 'AM', date('now', '-10 months', '+8 days'), date('now', '-10 months', '+8 days'), 1899.00, date('now', '-10 months', '+8 days', '+20 days'), 'Ordinateur portable pour la production'),
  ('F-26-024', 'Helvetel', 'FA', date('now', '-11 months', '+20 days'), date('now', '-11 months', '+20 days'), 89.00, date('now', '-11 months', '+20 days', '+8 days'), 'Abonnement mobile + internet'),
  ('F-26-025', 'Helvetel', 'FA', date('now', '-10 months', '+20 days'), date('now', '-10 months', '+20 days'), 89.00, date('now', '-10 months', '+20 days', '+8 days'), 'Abonnement mobile + internet'),
  ('F-26-026', 'Helvetel', 'FA', date('now', '-9 months', '+20 days'), date('now', '-9 months', '+20 days'), 89.00, date('now', '-9 months', '+20 days', '+8 days'), 'Abonnement mobile + internet'),
  ('F-26-027', 'Helvetel', 'FA', date('now', '-8 months', '+20 days'), date('now', '-8 months', '+20 days'), 89.00, date('now', '-8 months', '+20 days', '+8 days'), 'Abonnement mobile + internet'),
  ('F-26-028', 'Helvetel', 'FA', date('now', '-7 months', '+20 days'), date('now', '-7 months', '+20 days'), 89.00, date('now', '-7 months', '+20 days', '+8 days'), 'Abonnement mobile + internet'),
  ('F-26-029', 'Helvetel', 'FA', date('now', '-6 months', '+20 days'), date('now', '-6 months', '+20 days'), 89.00, date('now', '-6 months', '+20 days', '+8 days'), 'Abonnement mobile + internet'),
  ('F-26-030', 'Helvetel', 'FA', date('now', '-5 months', '+20 days'), date('now', '-5 months', '+20 days'), 89.00, date('now', '-5 months', '+20 days', '+8 days'), 'Abonnement mobile + internet'),
  ('F-26-031', 'Helvetel', 'FA', date('now', '-4 months', '+20 days'), date('now', '-4 months', '+20 days'), 89.00, date('now', '-4 months', '+20 days', '+8 days'), 'Abonnement mobile + internet'),
  ('F-26-032', 'Helvetel', 'FA', date('now', '-3 months', '+20 days'), date('now', '-3 months', '+20 days'), 89.00, date('now', '-3 months', '+20 days', '+8 days'), 'Abonnement mobile + internet'),
  ('F-26-033', 'Helvetel', 'FA', date('now', '-2 months', '+20 days'), date('now', '-2 months', '+20 days'), 89.00, date('now', '-2 months', '+20 days', '+8 days'), 'Abonnement mobile + internet'),
  ('F-26-034', 'Helvetel', 'FA', date('now', '-1 months', '+20 days'), date('now', '-1 months', '+20 days'), 89.00, date('now', '-1 months', '+20 days', '+8 days'), 'Abonnement mobile + internet'),
  ('F-26-035', 'Helvetel', 'FA', date('now', '-16 days'), date('now', '-16 days', '+14 days'), 89.00, NULL, 'Abonnement mobile + internet'),
  ('F-26-036', 'SUISA', 'FA', date('now', '-11 months', '+10 days'), date('now', '-11 months', '+10 days'), 250.00, date('now', '-11 months', '+10 days', '+10 days'), 'Cotisation annuelle SUISA'),
  ('F-26-037', 'Assurance ProArt SA', 'FA', date('now', '-10 months', '+2 days'), date('now', '-10 months', '+2 days'), 420.00, date('now', '-10 months', '+2 days', '+15 days'), 'Assurance RC professionnelle et instruments'),
  ('F-26-038', 'Imprimerie du Leman', 'FA', date('now', '-55 days'), date('now', '-55 days'), 180.00, date('now', '-55 days', '+15 days'), 'Affiches tournee — impression'),
  ('F-26-039', 'Imprimerie du Leman', 'FA', date('now', '-15 days'), date('now', '-15 days', '+20 days'), 220.00, NULL, 'Affiches festival — impression'),
  ('F-26-040', 'Diffusion Digitale Sarl', 'FA', date('now', '-45 days'), date('now', '-45 days'), 150.00, date('now', '-45 days', '+5 days'), 'Campagne promo tournee'),
  ('F-26-041', 'Diffusion Digitale Sarl', 'FA', date('now', '-10 days'), date('now', '-10 days'), 150.00, date('now', '-10 days', '+5 days'), 'Campagne promo festival'),
  ('F-26-042', 'LocaVan Romandie', 'FD', date('now', '-61 days'), date('now', '-61 days'), 350.00, date('now', '-61 days', '+3 days'), 'Location camionnette — tournee'),
  ('F-26-043', 'LocaVan Romandie', 'FD', date('now', '-38 days'), date('now', '-38 days'), 350.00, date('now', '-38 days', '+3 days'), 'Location camionnette — tournee'),
  ('F-26-044', 'Hotel du Rhone', 'FD', date('now', '-50 days'), date('now', '-50 days'), 130.00, date('now', '-50 days', '+2 days'), 'Nuit avant date Sion'),
  ('F-26-045', 'Hotel du Rhone', 'FD', date('now', '-52 days'), date('now', '-52 days'), 130.00, date('now', '-52 days', '+2 days'), 'Nuit avant date Sion (deuxieme chambre)'),
  ('F-26-046', 'Hotel des Vignes', 'FD', date('now', '-45 days'), date('now', '-45 days'), 110.00, date('now', '-45 days', '+2 days'), 'Nuit avant date Fribourg'),
  ('F-26-047', 'Hotel des Vignes', 'FD', date('now', '-47 days'), date('now', '-47 days'), 110.00, date('now', '-47 days', '+2 days'), 'Nuit avant date Fribourg (deuxieme chambre)'),
  ('F-26-048', 'Auberge du Lac', 'FD', date('now', '-35 days'), date('now', '-35 days'), 140.00, date('now', '-35 days', '+2 days'), 'Nuit avant date Geneve'),
  ('F-26-049', 'Restaurant de la Gare', 'FR', date('now', '-50 days'), date('now', '-50 days'), 32.00, date('now', '-50 days', '+0 days'), 'Repas avant concert Sion'),
  ('F-26-050', 'Boulangerie du Marche', 'FR', date('now', '-45 days'), date('now', '-45 days'), 18.50, date('now', '-45 days', '+0 days'), 'Repas hors domicile — Fribourg'),
  ('F-26-051', 'Cafe des Alpes', 'FR', date('now', '-38 days'), date('now', '-38 days'), 24.00, date('now', '-38 days', '+0 days'), 'Repas hors domicile — Geneve'),
  ('F-26-052', 'Restaurant de la Gare', 'FR', date('now', '-18 days'), date('now', '-18 days'), 29.00, date('now', '-18 days', '+0 days'), 'Repas repetition generale'),
  ('F-26-053', 'Boulangerie du Marche', 'FR', date('now', '-9 days'), date('now', '-9 days'), 15.50, date('now', '-9 days', '+0 days'), 'Repas hors domicile'),
  ('F-26-054', 'Cafe des Alpes', 'FR', date('now', '-4 days'), date('now', '-4 days'), 21.00, date('now', '-4 days', '+0 days'), 'Repas hors domicile'),
  ('F-26-055', 'Caisse AVS Vaud', 'CS', date('now', '-11 months', '+15 days'), date('now', '-11 months', '+15 days'), 640.00, date('now', '-11 months', '+15 days', '+30 days'), 'Acompte cotisations AVS/AI/APG'),
  ('F-26-056', 'Caisse AVS Vaud', 'CS', date('now', '-8 months', '+15 days'), date('now', '-8 months', '+15 days'), 640.00, date('now', '-8 months', '+15 days', '+30 days'), 'Acompte cotisations AVS/AI/APG'),
  ('F-26-057', 'Caisse AVS Vaud', 'CS', date('now', '-5 months', '+15 days'), date('now', '-5 months', '+15 days'), 640.00, date('now', '-5 months', '+15 days', '+30 days'), 'Acompte cotisations AVS/AI/APG'),
  ('F-26-058', 'Caisse AVS Vaud', 'CS', date('now', '-2 months', '+15 days'), date('now', '-2 months', '+15 days'), 640.00, date('now', '-2 months', '+15 days', '+30 days'), 'Acompte cotisations AVS/AI/APG');

-- ═══════════════════════════════════════════════════
-- INCOME (the grants story: public funding, rights, merch)
-- ═══════════════════════════════════════════════════
INSERT INTO income (reference, date, description, amount, category, source, notes) VALUES
  ('R-26-001', date('now', '-11 months'), 'Aide a la creation - album Aurore', 8000.00, 'grant', 'Loterie Romande', 'Soutien a la production de l''album (enregistrement, mixage, mastering). Rapport final du a la sortie.'),
  ('R-26-002', date('now', '-9 months', '+6 days'), 'Bourse de composition', 5000.00, 'grant', 'Fonds cantonal de la culture', 'Bourse pour l''ecriture des dix titres de l''album. Versement unique.'),
  ('R-26-003', date('now', '-7 months', '+2 days'), 'Soutien tournee romande', 3000.00, 'grant', 'Ville de Lausanne', 'Aide au deplacement et a la promotion de la tournee de printemps.'),
  ('R-26-004', date('now', '-6 months', '+15 days'), 'Droits d''auteur semestre', 642.30, 'other', 'SUISA', 'Decompte semestriel, diffusion radio et concerts.'),
  ('R-26-005', date('now', '-4 months', '+9 days'), 'Aide a la promotion - clip', 2500.00, 'grant', 'Fondation Suisa', 'Contribution au tournage du clip Horizon. Justificatifs a fournir.'),
  ('R-26-006', date('now', '-3 months', '+1 days'), 'Merch concert Le Bourg', 380.00, 'side_income', 'Vente directe', 'T-shirts et vinyles EP Nuit vendus au stand.'),
  ('R-26-007', date('now', '-2 months', '+11 days'), 'Remboursement hotel annule', 145.00, 'refund', 'Hotel du Rhone', 'Nuit annulee, date de Sion deplacee.'),
  ('R-26-008', date('now', '-1 months', '+3 days'), 'Merch festival Sonar', 520.00, 'side_income', 'Vente directe', 'Stand merch, scene B.'),
  ('R-26-009', date('now', '-12 days'), 'Droits d''auteur semestre', 718.90, 'other', 'SUISA', 'Decompte semestriel.');

-- ═══════════════════════════════════════════════════
-- RESOURCES
-- ═══════════════════════════════════════════════════
INSERT INTO resources (id, name, url, price) VALUES
  (1, 'GigBooker', 'https://gigbooker.ch', ''),
  (2, 'Studio Nord — mastering', 'https://studionord-mastering.ch', ''),
  (3, 'Fonds cantonal de la culture — portail', 'https://fondsculture-vd.ch', 'free'),
  (4, 'Ville de Lausanne — subventions culture', 'https://lausanne.ch/subventions-culture', 'free');

INSERT INTO resource_tags (resource_id, tag) VALUES
  (1, 'booking'),
  (1, 'tools'),
  (2, 'mastering'),
  (2, 'production'),
  (3, 'grants'),
  (3, 'admin'),
  (4, 'grants'),
  (4, 'admin');

INSERT INTO resource_projects (resource_id, project_id) VALUES
  (1, 2),
  (2, 1),
  (3, 1),
  (4, 2);

-- ═══════════════════════════════════════════════════
-- NAMED TABLE (tour dates tracker)
-- ═══════════════════════════════════════════════════
INSERT INTO project_tables (id, project_id, name, column_config, sort_order) VALUES
  (1, 2, 'Dates de tournee', '[{"id":"col_1","name":"Ville","type":"text","width":140},{"id":"col_2","name":"Salle","type":"text","width":200},{"id":"col_3","name":"Cachet","type":"text","width":100},{"id":"col_4","name":"Statut","type":"select","width":130,"options":["Confirme","En option","Annule"]}]', 0);

INSERT INTO project_table_rows (table_id, data, sort_order) VALUES
  (1, '{"col_1":"Lausanne","col_2":"Le Bourg","col_3":"1''200.-","col_4":"Confirme"}', 0),
  (1, '{"col_1":"Sion","col_2":"Festival Sonar Valais (scene B)","col_3":"1''500.-","col_4":"Confirme"}', 1),
  (1, '{"col_1":"Fribourg","col_2":"Centre culturel Le Phare","col_3":"1''200.-","col_4":"Confirme"}', 2),
  (1, '{"col_1":"Geneve","col_2":"Salle des Musiques","col_3":"900.-","col_4":"Confirme"}', 3),
  (1, '{"col_1":"Neuchatel","col_2":"Le Sous-Sol","col_3":"800.-","col_4":"En option"}', 4),
  (1, '{"col_1":"Yverdon-les-Bains","col_2":"L''Amalgame","col_3":"700.-","col_4":"Annule"}', 5);

-- ═══════════════════════════════════════════════════
-- WIKI (project notes; the built-in User Guide is re-seeded by the loader)
-- ═══════════════════════════════════════════════════
INSERT INTO wiki_folders (id, name, sort_order) VALUES
  (1, 'Tournee', 1),
  (2, 'Dossiers', 2);

INSERT INTO wiki_articles (id, folder_id, project_id, title, content, sort_order) VALUES
  (1, 1, 2, 'Fiche technique', '<h2>Backline demande</h2><p>Batterie complete, deux amplis guitare, DI x6, retours x4. Liste complete envoyee a chaque salle une semaine avant la date.</p><h3>Plan de scene</h3><p>Voir schema partage avec l''ingenieur son. Duree de balance : 45 minutes minimum.</p>', 0),
  (2, 2, 1, 'Dossier de presse', '<h2>Biographie</h2><p>Aurore, projet solo, premier album a paraitre. Textes en francais, univers pop-folk.</p><h2>Photos</h2><p>Pack haute resolution disponible sur demande. Credit photo obligatoire.</p><h2>Contact presse</h2><p>hello@aurore-musique.ch</p>', 1),
  (3, 2, NULL, 'Checklist demande de subvention', '<h2>Avant depot</h2><ul><li>Budget previsionnel detaille</li><li>Calendrier du projet</li><li>Lettres de soutien (salle, label)</li></ul><h2>Apres acceptation</h2><ul><li>Accuser reception par ecrit</li><li>Noter la date du rapport final</li><li>Conserver toutes les factures justificatives</li></ul>', 2),
  (4, 2, 3, 'Programme des ateliers d''ecriture', '<h2>Deroule type</h2><p>3h par session : 45 minutes d''echauffement d''ecriture, 90 minutes de travail en petits groupes, 45 minutes de restitution.</p><h2>Groupe</h2><p>8 eleves avances, niveau fin de cycle. Contact : Marc Bovay.</p>', 3);

INSERT INTO wiki_article_tags (article_id, tag) VALUES
  (1, 'technique'),
  (1, 'tournee'),
  (2, 'presse'),
  (2, 'promo'),
  (3, 'subventions'),
  (3, 'admin'),
  (4, 'ateliers'),
  (4, 'pedagogie');

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
