-- Nexgen OS — core: the row an object was imported from.
--
-- An importer that reads another database writes each of its rows once. It
-- records, on the object it wrote, the row it came from as an identifier of
-- this scheme, `<database>:<table>:<id>` (`wesmart_db:participants:<uuid>`),
-- in the same statement that creates the object; a second import finds the
-- object by it and writes nothing again (decision 0036). One value names one
-- object per organisation, as every identifier does.

set search_path = nexgen, extensions;

insert into identifier_schemes (code, name, pattern, description) values
  ('imported_row', 'Imported row', '^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*:.+$',
   'The row of another database an object was imported from, written <database>:<table>:<id>, so that a second import finds the object instead of writing it again.')
on conflict (code) do nothing;
