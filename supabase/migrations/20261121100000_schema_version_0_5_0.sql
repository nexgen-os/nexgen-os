-- Nexgen OS — the schema this release defines is 0.5.0.
--
-- `nexgen_schema_version()` is what a package reads to decide whether it can
-- work with this database (docs/releasing.md). Between 0.4.0 and here several
-- series of one quantity add up on a regular step (`aggregate()`), raw
-- values are kept as long as the place decides and the rollups outlive them
-- (`series_retain()`), a document is published and withdrawn as a frozen,
-- digested copy (`document_publications`, `publish()`, `withdraw()`) that the
-- schema `published` shows, and an account is opened by an invitation
-- (`before_user_created()`): a package of 0.5.0 reads them. This migration redefines the function and
-- does nothing else.

set search_path = nexgen, extensions;

create or replace function nexgen_schema_version()
returns text
language sql
immutable
set search_path = nexgen, extensions, pg_temp
as $$
  select '0.5.0'::text;
$$;
