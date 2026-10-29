-- users for the connected UI test (password for all: "pass", checked by fake-supabase.mjs)
insert into auth.users (id, email, raw_user_meta_data) values
  ('20000000-0000-0000-0000-00000000000a', 'pc@corica.test', '{"full_name":"Project Controls"}'),
  ('20000000-0000-0000-0000-00000000000e', 'coo@corica.test', '{"full_name":"Chief Operating Officer"}'),
  ('20000000-0000-0000-0000-0000000000c1', 'a.camara@corica.test', '{"full_name":"Aboubacar Camara"}'),
  ('20000000-0000-0000-0000-0000000000d1', 'm.diallo@corica.test', '{"full_name":"Mariama Diallo"}'),
  ('20000000-0000-0000-0000-0000000000f1', 'new.pm@corica.test', '{"full_name":"New PM"}');
update profiles set role = 'admin', owner_name = 'Project Controls' where email = 'pc@corica.test';
update profiles set role = 'executive', owner_name = 'COO' where email = 'coo@corica.test';
update profiles set role = 'pm', owner_name = 'A. Camara' where email = 'a.camara@corica.test';
update profiles set role = 'pm', owner_name = 'M. Diallo' where email = 'm.diallo@corica.test';
insert into sites (code, name) values ('KGM – Kouroussa', 'Kouroussa Gold Mine'), ('Siguiri Services', 'Siguiri');
insert into site_members (user_id, site_code) values
  ('20000000-0000-0000-0000-0000000000c1', 'KGM – Kouroussa'),
  ('20000000-0000-0000-0000-0000000000d1', 'Siguiri Services');
