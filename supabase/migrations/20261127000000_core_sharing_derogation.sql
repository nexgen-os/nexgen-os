-- Nexgen OS — core: the distance a derogation may grant to an energy
-- sharing operation.
--
-- Where the rules of a place allow a greater distance between the
-- participants of an operation only on request — a derogation granted by an
-- authority — the greater distance is not the operation's until it is
-- granted. A pack publishes it under its own attribute type,
-- `sharing_max_distance_derogation_m`, beside `sharing_max_distance_m`, the
-- distance that holds without a request. A derogation granted is recorded on
-- the project as its own `sharing_max_distance_m`, with the decision as its
-- source: parameter_of() reads it before the pack, the path every attribute
-- already follows. The distance is written once (decision 0065).

set search_path = nexgen, extensions;

-- An installation made before this release gets the type here; a new one
-- from the core's seed, which runs after the migrations and brings the
-- quantity `length` it is measured in.
insert into attribute_types (code, name, description, datatype, quantity_code, minimum, maximum, published_by)
select 'sharing_max_distance_derogation_m', 'Energy sharing, maximum distance by derogation',
       'The greatest distance between two participants of an energy sharing operation that a derogation may grant on request, where the rules of the place allow one: a pack''s default, never applied by itself. A derogation granted is the project''s own sharing_max_distance_m, with the decision as its source.',
       'number', 'length', 0, null, 'core'
 where exists (select 1 from quantities where code = 'length')
on conflict (code) do nothing;
