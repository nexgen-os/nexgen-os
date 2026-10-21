-- Nexgen OS — module `community`: the energy community, on top of the
-- projects and participants of the core.
--
-- A project and the sites taking part in it are the core's (`projects`,
-- `participants`, decision 0042); so is the connection point each
-- participant is behind (`meters`). What an energy community adds is how it
-- shares energy among its participants: the allocation key of the project
-- and what that key reads about each participant, as attributes, and the
-- shares an engine computes, as runs of this module (0002). The schema holds
-- no table today; it is created so that the module has a home of its own,
-- and the row below registers the module (modules/README.md, rule 6).

set search_path = nexgen, public, extensions;

create schema community;
grant usage on schema community to authenticated, service_role;

insert into modules (code, name, version, schema_name, requires_core_min, description)
values ('community', 'Community', '0.1.0', 'community', '0.3.0',
        'The energy community on top of the projects and participants of the core.');
