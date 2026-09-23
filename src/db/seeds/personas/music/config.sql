-- Music persona: business profile and activities. Demo build only. Fictional data.
PRAGMA foreign_keys = OFF;

UPDATE business_profile SET
  owner_name = 'Lea Morel — Aurore',
  address = 'Rue de la Louve 8',
  postal_code = '1003',
  city = 'Lausanne',
  country = 'CH',
  email = 'hello@aurore-musique.ch',
  phone = '+41 21 555 12 34',
  ide_number = 'CHE-987.654.321',
  affiliate_number = '111.2222.3333.44',
  bank_name = 'Banque Exemple SA',
  bank_address = 'Place de la Gare 1, 1003 Lausanne',
  iban = 'CH56 0483 5012 3456 7800 9',
  clearing = '700',
  bic_swift = 'EXAMCH22XXX',
  default_activity = 'Concert',
  vat_exempt = 1,
  default_payment_terms_days = 30
WHERE id = 1;

DELETE FROM activities;
INSERT INTO activities (name_fr, name_en, sort_order) VALUES
  ('Concert', 'Concert', 0),
  ('Composition', 'Composition', 1),
  ('Production', 'Production', 2),
  ('Atelier', 'Workshop', 3);

PRAGMA foreign_keys = ON;
