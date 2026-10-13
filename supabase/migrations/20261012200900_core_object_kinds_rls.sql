-- Nexgen OS — row level security on `object_kinds`.
--
-- `object_kinds` is a vocabulary: one row per kind of object, written by
-- `declare_object()` in migrations. It was created without row level
-- security, which `nexgen-os doctor` reports for any table of the schema.
-- Like every vocabulary, it is read by everyone signed in and written by
-- migrations only.

set search_path = nexgen, public, extensions;

alter table object_kinds enable row level security;
create policy object_kinds_read on object_kinds for select to authenticated using (true);
grant select on object_kinds to authenticated, service_role;
