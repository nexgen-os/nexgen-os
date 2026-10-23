-- Nexgen OS — module `solar`: the system loss is a parameter (decision 0055).
--
-- PVGIS and PVWatts take one aggregate loss for everything their model
-- leaves out: wiring, mismatch, soiling, availability, the inverter. Two
-- owners of the same modules under the same sky rightly choose two
-- values — one who measured its installations sets 2.5 %, one who
-- follows PVGIS's convention keeps 14 % — so the value is a parameter of
-- the place, never a number of the profile. The two profiles that carry
-- it name the loss without a value, and a yield estimate reads it through
-- `parameter_of()` on the PV system: the device's own, its participant's,
-- its project's, its organisation's, its country's, then the generic level
-- this module publishes, PVGIS PVcalc's 14 %.

set search_path = nexgen, extensions;

insert into attribute_types (code, name, description, datatype, quantity_code, minimum, maximum, applies_to, published_by) values
  ('system_loss', 'System loss',
   'The one aggregate loss of a PV system that a yield profile folding its losses into one (PVGIS''s, PVWatts''s) applies, as a fraction (0.14 for 14 %): wiring, mismatch, soiling, availability, the inverter. Set on the PV system, its participant, its project or its organisation; a meter or a series has no PV system.',
   'number', 'ratio', 0, 1, '{device,participant,project,organisation}', 'solar');

-- The generic level, below every place (decision 0053): the default loss
-- of PVGIS's PV calculator, a convention rather than a measurement.
insert into defaults (attribute_type, country, region, condition, value, valid_from, source_code, reference, quality, published_by) values
  ('system_loss', null, null, '{}', '0.14', null, 'pvgis',
   'PVGIS 5.3 user manual, PV calculator: "system loss", 14 % by default', 'assumed', 'solar');

update solar.yield_profiles
   set losses = '[{"code": "system", "pct": null}]',
       description = replace(description, 'one aggregate system loss, 14 % by default;', 'one aggregate system loss, the system_loss of the place (parameter_of(), 14 % at the generic level as PVGIS PVcalc);')
 where code = 'pvgis_like';

update solar.yield_profiles
   set losses = '[{"code": "system", "pct": null}]',
       description = replace(description, 'one aggregate system loss, 14 % as in the PVWatts API example (the API has no default);', 'one aggregate system loss, the system_loss of the place (parameter_of(); the PVWatts API has no default);')
 where code = 'pvwatts';
