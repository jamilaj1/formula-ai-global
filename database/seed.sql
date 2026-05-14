-- ============================================================
-- Formula AI Global — minimal seed data
-- Subscription plans (4 tiers) + 12 industries + a few common chemicals.
-- ============================================================

INSERT INTO subscription_plans (slug, name, description, price_monthly, price_yearly, formulas_per_month, api_calls_per_day, has_api_access, has_advanced_search, has_export, has_no_ads, has_white_label, sort_order)
VALUES
  ('starter',      'Starter',      'Free forever, with ads',                0.00,    0.00,   10,    0,      false, false, true,  false, false, 1),
  ('professional', 'Professional', '100 formulas/month, no ads',           49.00,  468.00,  100, 1000,      true,  true,  true,  true,  false, 2),
  ('business',     'Business',     'Unlimited formulas + book uploads',   299.00, 2988.00, 9999, 50000,     true,  true,  true,  true,  false, 3),
  ('enterprise',   'Enterprise',   'On-premise + white label + 195 countries', 999.00, 9588.00, 99999, 9999999, true, true, true, true, true, 4)
ON CONFLICT (slug) DO NOTHING;

-- ----- Industry categories ---------------------------------
INSERT INTO industry_categories (code, name_en, name_ar, icon, priority) VALUES
  ('DET',  'Detergents',           'المنظفات',            '🧴', 1),
  ('COS',  'Cosmetics',            'مستحضرات تجميل',     '💄', 2),
  ('PER',  'Personal Care',        'العناية الشخصية',     '🧼', 3),
  ('DIS',  'Disinfectants',        'المطهرات',            '🦠', 4),
  ('PHA',  'Pharmaceuticals',      'الصيدلانيات',          '💊', 5),
  ('AGR',  'Agriculture',          'الزراعة',              '🌿', 6),
  ('IND',  'Industrial Chemicals', 'الكيماويات الصناعية',  '🏭', 7),
  ('FOO',  'Food Additives',       'إضافات الأغذية',       '🍔', 8),
  ('AUT',  'Automotive Products',  'منتجات السيارات',      '🚗', 9),
  ('PNT',  'Paints & Coatings',    'الدهانات والطلاءات',   '🎨', 10),
  ('CON',  'Construction',         'مواد البناء',          '🏗️', 11),
  ('POL',  'Polymers',             'البوليمرات',           '⚗️', 12)
ON CONFLICT (code) DO NOTHING;

-- ----- Common chemicals (minimal seed for CAS lookup) ------
INSERT INTO chemicals_database (name, name_en, cas_number, molecular_formula, category, is_eco_friendly, source) VALUES
  ('Water',                 'Water',                          '7732-18-5',   'H2O',     'solvent',     true,  'core'),
  ('Sodium Laureth Sulfate','Sodium Laureth Sulfate',         '68585-34-2',  'C26H53NaO9S','surfactant',false, 'core'),
  ('Sodium Lauryl Sulfate', 'Sodium Lauryl Sulfate',          '151-21-3',    'C12H25NaO4S','surfactant',false, 'core'),
  ('Cocamidopropyl Betaine','Cocamidopropyl Betaine',         '61789-40-0',  '',          'co-surfactant',true,'core'),
  ('Glycerin',              'Glycerin',                        '56-81-5',     'C3H8O3',  'humectant',  true,  'core'),
  ('Citric Acid',           'Citric Acid',                     '77-92-9',     'C6H8O7',  'pH adjuster', true,  'core'),
  ('Sodium Chloride',       'Sodium Chloride',                 '7647-14-5',   'NaCl',    'thickener',  true,  'core'),
  ('Sodium Benzoate',       'Sodium Benzoate',                 '532-32-1',    'C7H5NaO2','preservative', true, 'core'),
  ('Phenoxyethanol',        'Phenoxyethanol',                  '122-99-6',    'C8H10O2', 'preservative', true, 'core'),
  ('Panthenol',             'Panthenol (Pro-Vitamin B5)',      '81-13-0',     'C9H19NO4','conditioning',true, 'core')
ON CONFLICT DO NOTHING;
