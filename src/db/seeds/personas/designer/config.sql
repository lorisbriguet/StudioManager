-- Designer persona: business profile and activities. Demo build only (never
-- run by the real app's presentation mode). Fictional data.
PRAGMA foreign_keys = OFF;

UPDATE business_profile SET
  owner_name = 'Lea Morel',
  address = 'Rue de la Louve 8',
  postal_code = '1003',
  city = 'Lausanne',
  country = 'CH',
  email = 'lea@ateliermorel.ch',
  phone = '+41 21 555 12 34',
  ide_number = 'CHE-123.456.789',
  affiliate_number = '111.2222.3333.44',
  bank_name = 'Banque Exemple SA',
  bank_address = 'Place de la Gare 1, 1003 Lausanne',
  iban = 'CH93 0076 2011 6238 5295 7',
  clearing = '700',
  bic_swift = 'EXAMCH22XXX',
  default_activity = 'Graphisme',
  vat_exempt = 1,
  default_payment_terms_days = 30
WHERE id = 1;

DELETE FROM activities;
INSERT INTO activities (name_fr, name_en, sort_order) VALUES
  ('Graphisme', 'Graphic design', 0),
  ('Direction artistique', 'Art direction', 1),
  ('Web', 'Web', 2);

PRAGMA foreign_keys = ON;
