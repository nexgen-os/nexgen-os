-- Nexgen OS — module `solar`: the loss chain says its quality (decision 0057).
--
-- A loss of the chain of a yield says what kind of value it is in the words
-- of the core, now the domain `value_quality` under the name `quality`: the
-- usual starting value of a yield profile is assumed (formerly `default`),
-- a place's soiling keeps the word its attribute or its pack row has.
--
-- On an installation of 0.3.0 the column was `status`, a foreign key to
-- the core's `value_statuses`, which the core's migration of 0.4.0 dropped
-- with its table; a fresh installation creates it on the domain.

set search_path = nexgen, extensions;

alter table solar.estimate_losses drop constraint if exists estimate_losses_status_fkey;
alter table solar.estimate_losses rename column status to quality;
alter table solar.estimate_losses alter column quality type value_quality
  using (case quality::text when 'default' then 'assumed' else quality::text end);

comment on column solar.estimate_losses.quality is
  'What kind of value the loss is (value_quality): assumed for the usual starting value of a yield profile, the quality of the place''s value for a soiling read from it.';
