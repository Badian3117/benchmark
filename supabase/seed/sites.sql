-- BenchMark – CORICA sites (from the CORICA site map). Run once in the Supabase SQL Editor
-- after the migration. Safe to re-run: existing sites are updated, nothing is deleted.
--   code   = the site name shown in BenchMark filters and stored on every record
--   name   = client / mine operator
--   active = false hides a site from new entries but keeps its history
-- To retire a site later, set active = false (never delete: records reference the code).
insert into sites (code, name, active) values
  -- Senegal
  ('GCO, Sénégal',                 'Eramet',                  true),
  ('Mako, Sénégal',                'Resolute',                true),
  -- Guinée
  ('Kouroussa, Guinée',            'Hummingbird Resources',   true),
  -- Mali
  ('Sadiola, Mali',                'Allied Gold Corp',        true),
  ('Gounkoto, Mali',               'Barrick',                 true),
  ('Goulamina, Mali',              'Leo Lithium Limited',     true),
  ('Syama Open Pit, Mali',         'Resolute',                true),
  -- Côte d'Ivoire
  ('Sissingué, Côte d''Ivoire',    'Perseus Mining',          true),
  ('Fimbiasso, Côte d''Ivoire',    'Perseus Mining',          true),
  ('Ity, Côte d''Ivoire',          'Endeavour Mining',        true),
  ('Bonikro, Côte d''Ivoire',      'Allied Gold',             true),
  ('Tongon, Côte d''Ivoire',       'Barrick Gold',            true),
  -- Burkina Faso
  ('Wahgnion, Burkina Faso',       'Teranga Resources',       true),
  ('Houndé, Burkina Faso',         'Endeavour',               true),
  ('Karma, Burkina Faso',          'Endeavour',               true),
  ('Somita, Burkina Faso',         'North Gold',              true),
  ('Essakane, Burkina Faso',       'IAMGOLD',                 true),
  ('Boungou, Burkina Faso',        'Endeavour',               true)
on conflict (code) do update set name = excluded.name, active = excluded.active;

-- check: select code, name, active from sites order by code;
